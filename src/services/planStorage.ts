import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  db,
  handleFirestoreError,
  inspectFirestoreError,
  OperationType,
} from '../firebase';
import { AccountSession, CustomerContact, VoucherBudget } from '../types';
import {
  apiDeleteWorkspaceCustomer,
  apiUpsertWorkspaceCustomer,
  apiUpsertWorkspaceVoucherBudget,
  CloudRelayError,
} from './cloudApiClient';
import { sanitizeSafeId } from './invoiceStorage';

export const DEFAULT_MONTHLY_VOUCHER_BUDGET = 5_000_000;
export const MONTH_KEY_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

const MAX_MONEY = 10_000_000_000;
const MAX_CUSTOMER_NAME_LEN = 120;
const MAX_CUSTOMER_PHONE_LEN = 30;
const MAX_CUSTOMER_DATE_LEN = 30;
const MAX_NOTE_LEN = 500;

function wsKeyPrefix(workspaceId: string): string {
  return `atdcolor_ws_${workspaceId.slice(0, 27)}`;
}

export function getWorkspaceVoucherBudgetsStorageKey(
  workspaceId: string
): string {
  return `${wsKeyPrefix(workspaceId)}_voucher_budgets`;
}

export function getWorkspaceCustomersStorageKey(workspaceId: string): string {
  return `${wsKeyPrefix(workspaceId)}_customers`;
}

function getWorkspaceDeletedCustomerIdsKey(workspaceId: string): string {
  return `${wsKeyPrefix(workspaceId)}_deleted_customers`;
}

function clampMoney(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.min(MAX_MONEY, Math.max(0, Math.round(val))) + 0;
}

function timestampToISO(val: unknown, fallbackISO: string): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string' && val.trim()) {
    return val;
  }
  return fallbackISO;
}

export function getCurrentLocalMonthKey(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

export function getInvoiceMonthKey(isoString: string): string {
  const raw = String(isoString || '').trim();
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return getCurrentLocalMonthKey(parsed);
    }
    const prefix = raw.slice(0, 7);
    if (MONTH_KEY_PATTERN.test(prefix)) {
      return prefix;
    }
  }
  return getCurrentLocalMonthKey();
}

export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return getCurrentLocalMonthKey();
  }
  const year = Number(match[1]);
  const monthIdx = Number(match[2]) - 1;
  const target = new Date(year, monthIdx + deltaMonths, 1);
  return getCurrentLocalMonthKey(target);
}

export function formatMonthKeyVN(monthKey: string): string {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthKey;
  return `Tháng ${Number(match[2])}/${match[1]}`;
}

export function normalizePhoneDigits(phone: string): string {
  return String(phone || '')
    .replace(/[^\d]/g, '')
    .slice(0, 24);
}

export function buildPhoneCustomerId(phone: string): string {
  const digits = normalizePhoneDigits(phone);
  if (digits.length >= 6) {
    return sanitizeSafeId(`cust_ph_${digits}`, 'cust');
  }
  return sanitizeSafeId(
    `cust_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    'cust'
  );
}

export function normalizeVoucherBudget(
  raw: Partial<VoucherBudget>,
  fallbackMonthKey?: string
): VoucherBudget | null {
  const mk = String(raw.monthKey || fallbackMonthKey || '').trim();
  if (!MONTH_KEY_PATTERN.test(mk)) return null;
  return {
    monthKey: mk,
    budgetAmount: clampMoney(
      typeof raw.budgetAmount === 'number'
        ? raw.budgetAmount
        : DEFAULT_MONTHLY_VOUCHER_BUDGET
    ),
    note: String(raw.note || '').trim().slice(0, MAX_NOTE_LEN),
    updatedAt:
      typeof raw.updatedAt === 'string' && raw.updatedAt.trim()
        ? raw.updatedAt.trim()
        : new Date().toISOString(),
  };
}

export function normalizeCustomerContact(
  raw: Partial<CustomerContact>
): CustomerContact | null {
  const name = String(raw.name || '')
    .trim()
    .slice(0, MAX_CUSTOMER_NAME_LEN);
  const phone = String(raw.phone || '')
    .trim()
    .slice(0, MAX_CUSTOMER_PHONE_LEN);
  if (!name || !phone) return null;

  const nowISO = new Date().toISOString();
  const id = sanitizeSafeId(
    String(raw.id || buildPhoneCustomerId(phone)),
    'cust'
  );
  const createdAt =
    typeof raw.createdAt === 'string' && raw.createdAt.trim()
      ? raw.createdAt.trim()
      : nowISO;
  const updatedAt =
    typeof raw.updatedAt === 'string' && raw.updatedAt.trim()
      ? raw.updatedAt.trim()
      : createdAt;

  return {
    id,
    name,
    phone,
    customerDate: String(raw.customerDate || '')
      .trim()
      .slice(0, MAX_CUSTOMER_DATE_LEN),
    note: String(raw.note || '')
      .trim()
      .slice(0, MAX_NOTE_LEN),
    createdAt,
    updatedAt,
  };
}

export function loadLocalVoucherBudgets(workspaceId: string): VoucherBudget[] {
  try {
    const raw = localStorage.getItem(
      getWorkspaceVoucherBudgetsStorageKey(workspaceId)
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const byMonth = new Map<string, VoucherBudget>();
    for (const item of parsed) {
      const norm = normalizeVoucherBudget(item);
      if (norm) {
        byMonth.set(norm.monthKey, norm);
      }
    }
    return Array.from(byMonth.values()).sort((a, b) =>
      b.monthKey.localeCompare(a.monthKey)
    );
  } catch {
    return [];
  }
}

export function saveLocalVoucherBudgets(
  workspaceId: string,
  budgets: VoucherBudget[]
): void {
  try {
    localStorage.setItem(
      getWorkspaceVoucherBudgetsStorageKey(workspaceId),
      JSON.stringify(budgets)
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function loadDeletedCustomerIds(workspaceId: string): Set<string> {
  try {
    const raw = localStorage.getItem(
      getWorkspaceDeletedCustomerIdsKey(workspaceId)
    );
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.map((v) => String(v)));
    }
  } catch {
    // Ignore malformed JSON
  }
  return new Set();
}

export function markCustomerDeletedLocally(
  workspaceId: string,
  customerId: string
): void {
  try {
    const existing = loadDeletedCustomerIds(workspaceId);
    existing.add(customerId);
    localStorage.setItem(
      getWorkspaceDeletedCustomerIdsKey(workspaceId),
      JSON.stringify(Array.from(existing).slice(-300))
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function clearCustomerDeletedTombstone(
  workspaceId: string,
  customerId: string
): void {
  try {
    const existing = loadDeletedCustomerIds(workspaceId);
    if (existing.delete(customerId)) {
      localStorage.setItem(
        getWorkspaceDeletedCustomerIdsKey(workspaceId),
        JSON.stringify(Array.from(existing))
      );
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function loadLocalCustomers(workspaceId: string): CustomerContact[] {
  try {
    const deleted = loadDeletedCustomerIds(workspaceId);
    const raw = localStorage.getItem(
      getWorkspaceCustomersStorageKey(workspaceId)
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const byId = new Map<string, CustomerContact>();
    for (const item of parsed) {
      const norm = normalizeCustomerContact(item);
      if (norm && !deleted.has(norm.id)) {
        byId.set(norm.id, norm);
      }
    }
    return Array.from(byId.values()).sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch {
    return [];
  }
}

export function saveLocalCustomers(
  workspaceId: string,
  customers: CustomerContact[]
): void {
  try {
    localStorage.setItem(
      getWorkspaceCustomersStorageKey(workspaceId),
      JSON.stringify(customers)
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function mergeVoucherBudgets(
  localList: VoucherBudget[],
  remoteList: VoucherBudget[]
): VoucherBudget[] {
  const byMonth = new Map<string, VoucherBudget>();
  for (const loc of localList) {
    const norm = normalizeVoucherBudget(loc);
    if (norm) byMonth.set(norm.monthKey, norm);
  }
  for (const rem of remoteList) {
    const norm = normalizeVoucherBudget(rem);
    if (!norm) continue;
    const prev = byMonth.get(norm.monthKey);
    if (
      !prev ||
      new Date(norm.updatedAt).getTime() >= new Date(prev.updatedAt).getTime()
    ) {
      byMonth.set(norm.monthKey, norm);
    }
  }
  return Array.from(byMonth.values()).sort((a, b) =>
    b.monthKey.localeCompare(a.monthKey)
  );
}

export function mergeCustomerContacts(
  workspaceId: string,
  localList: CustomerContact[],
  remoteList: CustomerContact[]
): CustomerContact[] {
  const deleted = loadDeletedCustomerIds(workspaceId);
  const byId = new Map<string, CustomerContact>();
  for (const loc of localList) {
    const norm = normalizeCustomerContact(loc);
    if (norm && !deleted.has(norm.id)) {
      byId.set(norm.id, norm);
    }
  }
  for (const rem of remoteList) {
    const norm = normalizeCustomerContact(rem);
    if (!norm || deleted.has(norm.id)) continue;
    const prev = byId.get(norm.id);
    if (
      !prev ||
      new Date(norm.updatedAt).getTime() >= new Date(prev.updatedAt).getTime()
    ) {
      byId.set(norm.id, norm);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function upsertVoucherBudgetToCloud(
  session: AccountSession,
  budget: VoucherBudget
): Promise<void> {
  const normalized = normalizeVoucherBudget(budget);
  if (!normalized) return;

  // 1. Primary Path: Same-origin server relay
  try {
    await apiUpsertWorkspaceVoucherBudget(session, normalized);
    return;
  } catch (err) {
    if (err instanceof CloudRelayError) {
      if (err.code === 'QUOTA_DAILY_READS' || err.code === 'QUOTA_EXCEEDED') {
        return;
      }
      if (
        err.code !== 'NETWORK_UNREACHABLE' &&
        err.code !== 'RELAY_NOT_JSON' &&
        err.code !== 'FIRESTORE_UNAVAILABLE'
      ) {
        return;
      }
    }
  }

  // 2. Fallback Path: Direct Client Firestore
  const docPath = `workspaces/${session.workspaceId}/voucherBudgets/${normalized.monthKey}`;
  const docRef = doc(
    db,
    'workspaces',
    session.workspaceId,
    'voucherBudgets',
    normalized.monthKey
  );

  let existsOnServer = false;
  try {
    const snap = await getDoc(docRef);
    existsOnServer = snap.exists();
  } catch (error) {
    const info = inspectFirestoreError(error);
    if (info.isQuotaExceeded || info.isOfflineOrNetwork) {
      return;
    }
    handleFirestoreError(error, OperationType.GET, docPath);
  }

  try {
    if (!existsOnServer) {
      await setDoc(docRef, {
        workspaceId: session.workspaceId,
        accountUsername: session.usernameKey,
        monthKey: normalized.monthKey,
        budgetAmount: normalized.budgetAmount,
        note: normalized.note,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(docRef, {
        budgetAmount: normalized.budgetAmount,
        note: normalized.note,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    const info = inspectFirestoreError(error);
    if (info.isQuotaExceeded || info.isOfflineOrNetwork) {
      return;
    }
    handleFirestoreError(
      error,
      existsOnServer ? OperationType.UPDATE : OperationType.CREATE,
      docPath
    );
  }
}

export function subscribeToVoucherBudgets(
  session: AccountSession,
  onReceive: (budgets: VoucherBudget[]) => void
): () => void {
  const colPath = `workspaces/${session.workspaceId}/voucherBudgets`;
  const q = query(
    collection(db, 'workspaces', session.workspaceId, 'voucherBudgets'),
    where('workspaceId', '==', session.workspaceId)
  );

  return onSnapshot(
    q,
    (snap) => {
      const fallbackNow = new Date().toISOString();
      const received: VoucherBudget[] = [];
      for (const d of snap.docs) {
        const data = d.data();
        const norm = normalizeVoucherBudget(
          {
            monthKey: String(data.monthKey || d.id),
            budgetAmount: Number(data.budgetAmount) || 0,
            note: String(data.note || ''),
            updatedAt: timestampToISO(data.updatedAt, fallbackNow),
          },
          d.id
        );
        if (norm) received.push(norm);
      }
      onReceive(received);
    },
    (error) => {
      const info = inspectFirestoreError(error);
      if (info.isQuotaExceeded || info.isOfflineOrNetwork) {
        return;
      }
      handleFirestoreError(error, OperationType.LIST, colPath);
    }
  );
}

export async function upsertCustomerToCloud(
  session: AccountSession,
  customer: CustomerContact
): Promise<void> {
  const normalized = normalizeCustomerContact(customer);
  if (!normalized) return;

  // 1. Primary Path: Same-origin server relay
  try {
    await apiUpsertWorkspaceCustomer(session, normalized);
    return;
  } catch (err) {
    if (err instanceof CloudRelayError) {
      if (err.code === 'QUOTA_DAILY_READS' || err.code === 'QUOTA_EXCEEDED') {
        return;
      }
      if (
        err.code !== 'NETWORK_UNREACHABLE' &&
        err.code !== 'RELAY_NOT_JSON' &&
        err.code !== 'FIRESTORE_UNAVAILABLE'
      ) {
        return;
      }
    }
  }

  // 2. Fallback Path: Direct Client Firestore
  const docPath = `workspaces/${session.workspaceId}/customers/${normalized.id}`;
  const docRef = doc(
    db,
    'workspaces',
    session.workspaceId,
    'customers',
    normalized.id
  );

  let existsOnServer = false;
  try {
    const snap = await getDoc(docRef);
    existsOnServer = snap.exists();
  } catch (error) {
    const info = inspectFirestoreError(error);
    if (info.isQuotaExceeded || info.isOfflineOrNetwork) {
      return;
    }
    handleFirestoreError(error, OperationType.GET, docPath);
  }

  try {
    if (!existsOnServer) {
      await setDoc(docRef, {
        workspaceId: session.workspaceId,
        accountUsername: session.usernameKey,
        name: normalized.name,
        phone: normalized.phone,
        customerDate: normalized.customerDate,
        note: normalized.note,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(docRef, {
        name: normalized.name,
        phone: normalized.phone,
        customerDate: normalized.customerDate,
        note: normalized.note,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    const info = inspectFirestoreError(error);
    if (info.isQuotaExceeded || info.isOfflineOrNetwork) {
      return;
    }
    handleFirestoreError(
      error,
      existsOnServer ? OperationType.UPDATE : OperationType.CREATE,
      docPath
    );
  }
}

export async function deleteCustomerFromCloud(
  session: AccountSession,
  customerId: string
): Promise<void> {
  const safeId = sanitizeSafeId(customerId, 'cust');

  // 1. Primary Path: Same-origin server relay
  try {
    await apiDeleteWorkspaceCustomer(session, safeId);
    return;
  } catch (err) {
    if (err instanceof CloudRelayError) {
      if (err.code === 'QUOTA_DAILY_READS' || err.code === 'QUOTA_EXCEEDED') {
        return;
      }
      if (
        err.code !== 'NETWORK_UNREACHABLE' &&
        err.code !== 'RELAY_NOT_JSON' &&
        err.code !== 'FIRESTORE_UNAVAILABLE'
      ) {
        return;
      }
    }
  }

  // 2. Fallback Path: Direct Client Firestore
  const docPath = `workspaces/${session.workspaceId}/customers/${safeId}`;
  const docRef = doc(db, 'workspaces', session.workspaceId, 'customers', safeId);

  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      await deleteDoc(docRef);
    }
  } catch (error) {
    const info = inspectFirestoreError(error);
    if (info.isQuotaExceeded || info.isOfflineOrNetwork) {
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export function subscribeToCustomers(
  session: AccountSession,
  onReceive: (customers: CustomerContact[]) => void
): () => void {
  const colPath = `workspaces/${session.workspaceId}/customers`;
  const q = query(
    collection(db, 'workspaces', session.workspaceId, 'customers'),
    where('workspaceId', '==', session.workspaceId)
  );

  return onSnapshot(
    q,
    (snap) => {
      const fallbackNow = new Date().toISOString();
      const deleted = loadDeletedCustomerIds(session.workspaceId);
      const received: CustomerContact[] = [];
      for (const d of snap.docs) {
        if (deleted.has(d.id)) continue;
        const data = d.data();
        const norm = normalizeCustomerContact({
          id: d.id,
          name: String(data.name || ''),
          phone: String(data.phone || ''),
          customerDate: String(data.customerDate || ''),
          note: String(data.note || ''),
          createdAt: timestampToISO(data.createdAt, fallbackNow),
          updatedAt: timestampToISO(data.updatedAt, fallbackNow),
        });
        if (norm) received.push(norm);
      }
      onReceive(received);
    },
    (error) => {
      const info = inspectFirestoreError(error);
      if (info.isQuotaExceeded || info.isOfflineOrNetwork) {
        return;
      }
      handleFirestoreError(error, OperationType.LIST, colPath);
    }
  );
}

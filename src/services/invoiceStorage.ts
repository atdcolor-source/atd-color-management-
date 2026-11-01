import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { DEFAULT_DESIGN_ILLUSTRATION } from '../components/DesignIllustrationSelector';
import { sanitizeReportStage } from '../constants/reportStages';
import {
  db,
  handleFirestoreError,
  inspectFirestoreError,
  OperationType,
} from '../firebase';
import { AccountSession, QuoteItem, SavedInvoice } from '../types';
import { calculateQuoteTotals } from '../utils/formatters';
import {
  apiDeleteWorkspaceInvoice,
  apiFetchLegacyInvoices,
  apiUpdateWorkspaceInvoiceStage,
  apiUpsertWorkspaceInvoice,
  CloudRelayError,
} from './cloudApiClient';

// Legacy pre-account storage keys (retained strictly for optional 1-click migration)
const LEGACY_LOCAL_SAVED_KEY = 'atdcolor_saved_invoices_v1';
const LEGACY_LOCAL_BACKUP_KEY = 'atdcolor_saved_invoices_backup_v1';

const IDB_NAME = 'atdcolor_archive_db';
const IDB_VERSION = 2;
const LEGACY_IDB_STORE = 'saved_invoices';
const WORKSPACE_IDB_STORE = 'workspace_saved_invoices';

interface WorkspaceIdbRecord {
  compositeKey: string;
  workspaceId: string;
  invoice: SavedInvoice;
}

// Exact schema boundaries synchronized with firebase-blueprint.json & firestore.rules
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_ID_LEN = 128;
const MAX_CODE_LEN = 40;
const MAX_INVOICE_DATE_LEN = 40;
const MAX_DEMO_DATE_LEN = 20;
const MAX_CUSTOMER_NAME_LEN = 120;
const MAX_CUSTOMER_CODE_LEN = 30;
const MAX_CUSTOMER_PHONE_LEN = 30;
const MAX_DESIGN_ILLUSTRATION_LEN = 200;
const MAX_NOTE_LEN = 3000;
const MAX_SUMMARY_LEN = 300;
const MAX_ITEM_NAME_LEN = 200;
const MAX_ITEM_UNIT_LEN = 40;
const MAX_ITEM_NOTE_LEN = 1000;
const MAX_ITEMS_PER_INVOICE = 100;
const MAX_QTY = 100_000;
const MAX_MONEY = 10_000_000_000;
const SAFE_BATCH_CHUNK = 8;

if (
  typeof navigator !== 'undefined' &&
  navigator.storage &&
  typeof navigator.storage.persist === 'function'
) {
  void navigator.storage.persist().catch(() => {
    // Ignore unsupported environments
  });
}

export function getWorkspaceSavedStorageKey(workspaceId: string): string {
  return `atdcolor_ws_${workspaceId.slice(0, 27)}_saved_v1`;
}

function getWorkspaceBackupStorageKey(workspaceId: string): string {
  return `atdcolor_ws_${workspaceId.slice(0, 27)}_backup_v1`;
}

function getWorkspaceDeletedIdsKey(workspaceId: string): string {
  return `atdcolor_ws_${workspaceId.slice(0, 27)}_deleted_v1`;
}

function getWorkspacePendingDeletesKey(workspaceId: string): string {
  return `atdcolor_ws_${workspaceId.slice(0, 27)}_pending_del_v1`;
}

function getWorkspaceLegacyHandledKey(workspaceId: string): string {
  return `atdcolor_ws_${workspaceId.slice(0, 27)}_legacy_handled_v1`;
}

export function sanitizeSafeId(raw: string, fallbackPrefix = 'inv'): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, MAX_ID_LEN);
  if (cleaned.length >= 1 && ID_PATTERN.test(cleaned)) {
    return cleaned;
  }
  return `${fallbackPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function clampInt(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  const clamped = Math.min(max, Math.max(min, Math.trunc(val)));
  return clamped + 0;
}

function clampMoney(val: number): number {
  if (!Number.isFinite(val)) return 0;
  const clamped = Math.min(MAX_MONEY, Math.max(0, Math.round(val)));
  return clamped + 0;
}

const VALID_ORDER_DATE_RE =
  /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

function sanitizeRemainingPaidAt(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const m = trimmed.match(VALID_ORDER_DATE_RE);
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const maxDay = new Date(year, month, 0).getDate();
  const safeDay = String(Math.min(day, maxDay)).padStart(2, '0');
  return `${m[1]}-${m[2]}-${safeDay}`;
}

export function buildItemSummary(items: QuoteItem[]): string {
  if (items.length === 0) return 'Hóa đơn tham khảo';
  const joined = items
    .map((item) => `${item.name.trim() || 'Sản phẩm'} (x${item.quantity})`)
    .join(', ');
  const sliced = joined.slice(0, MAX_SUMMARY_LEN).trim();
  return sliced || 'Hóa đơn tham khảo';
}

export function generateInvoiceCode(existingInvoices: SavedInvoice[]): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `HD-${dd}${mm}-`;
  const usedCodes = new Set(existingInvoices.map((inv) => inv.code));
  let seq = existingInvoices.length + 1;
  let candidate = `${prefix}${String(seq).padStart(3, '0')}`;
  while (usedCodes.has(candidate)) {
    seq += 1;
    candidate = `${prefix}${String(seq).padStart(3, '0')}`;
  }
  return candidate.slice(0, MAX_CODE_LEN);
}

export function normalizeSavedInvoice(
  raw: Partial<SavedInvoice>,
  expectedSyncTag?: string
): SavedInvoice {
  const items: QuoteItem[] = Array.isArray(raw.items)
    ? raw.items.map((item, idx) => ({
        id: sanitizeSafeId(String(item.id || `item-${idx}`), `item-${idx}`),
        productId:
          typeof item.productId === 'string' && item.productId
            ? item.productId
            : undefined,
        name: String(item.name || 'Sản phẩm'),
        unit: String(item.unit || 'Tờ'),
        quantity: clampInt(Math.round(Number(item.quantity) || 1), 1, MAX_QTY),
        unitPrice: clampMoney(Number(item.unitPrice) || 0),
        note: String(item.note || ''),
      }))
    : [];
  const discountAmount = clampMoney(Number(raw.discountAmount) || 0);
  const shippingFee = clampMoney(Number(raw.shippingFee) || 0);
  const depositAmount = clampMoney(Number(raw.depositAmount) || 0);
  const totals = calculateQuoteTotals(
    items,
    discountAmount,
    shippingFee,
    depositAmount
  );
  const nowISO = new Date().toISOString();
  const syncedOwnerUid =
    typeof raw.syncedOwnerUid === 'string' && raw.syncedOwnerUid.trim()
      ? raw.syncedOwnerUid.trim()
      : undefined;

  return {
    id: sanitizeSafeId(String(raw.id || `inv-${Date.now()}`), 'inv'),
    code: String(raw.code || 'HD-001'),
    createdAt: String(raw.createdAt || nowISO),
    updatedAt: String(raw.updatedAt || raw.createdAt || nowISO),
    expectedDemoDate: String(raw.expectedDemoDate || ''),
    customer: {
      name: String(raw.customer?.name || ''),
      code: String(raw.customer?.code || ''),
      phone: String(raw.customer?.phone || ''),
    },
    items,
    discountAmount,
    shippingFee,
    depositAmount,
    designIllustration:
      typeof raw.designIllustration === 'string'
        ? raw.designIllustration
        : DEFAULT_DESIGN_ILLUSTRATION,
    invoiceNote: String(raw.invoiceNote || ''),
    reportStage: sanitizeReportStage(raw.reportStage),
    remainingPaid:
      typeof raw.remainingPaid === 'boolean' ? raw.remainingPaid : undefined,
    remainingPaidAt: sanitizeRemainingPaidAt(raw.remainingPaidAt) || undefined,
    totals,
    syncedToCloud: expectedSyncTag
      ? Boolean(raw.syncedToCloud && syncedOwnerUid === expectedSyncTag)
      : Boolean(raw.syncedToCloud),
    syncedOwnerUid,
  };
}

// --- Explicit Deletion Tombstones & Pending Cloud Deletes (Per Workspace) ---

function readIdSet(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function writeIdSet(storageKey: string, ids: Set<string>): void {
  try {
    const bounded = Array.from(ids).slice(-1000);
    localStorage.setItem(storageKey, JSON.stringify(bounded));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadExplicitlyDeletedIds(workspaceId: string): Set<string> {
  return readIdSet(getWorkspaceDeletedIdsKey(workspaceId));
}

export function clearDeletedTombstone(workspaceId: string, id: string): void {
  const delKey = getWorkspaceDeletedIdsKey(workspaceId);
  const deleted = readIdSet(delKey);
  if (deleted.delete(id)) {
    writeIdSet(delKey, deleted);
  }
  const pendKey = getWorkspacePendingDeletesKey(workspaceId);
  const pending = readIdSet(pendKey);
  if (pending.delete(id)) {
    writeIdSet(pendKey, pending);
  }
}

export function loadPendingCloudDeleteIds(workspaceId: string): string[] {
  return Array.from(readIdSet(getWorkspacePendingDeletesKey(workspaceId)));
}

export function clearPendingCloudDeleteId(
  workspaceId: string,
  id: string
): void {
  const pendKey = getWorkspacePendingDeletesKey(workspaceId);
  const pending = readIdSet(pendKey);
  if (pending.delete(id)) {
    writeIdSet(pendKey, pending);
  }
}

// --- IndexedDB Per-Workspace Archive ---

function openArchiveDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(LEGACY_IDB_STORE)) {
          database.createObjectStore(LEGACY_IDB_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(WORKSPACE_IDB_STORE)) {
          const wsStore = database.createObjectStore(WORKSPACE_IDB_STORE, {
            keyPath: 'compositeKey',
          });
          wsStore.createIndex('by_workspace', 'workspaceId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPutWorkspaceInvoices(
  workspaceId: string,
  invoices: SavedInvoice[]
): Promise<void> {
  if (invoices.length === 0) return;
  const database = await openArchiveDb();
  if (!database) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = database.transaction(WORKSPACE_IDB_STORE, 'readwrite');
      const store = tx.objectStore(WORKSPACE_IDB_STORE);
      for (const inv of invoices) {
        if (inv.items.length > 0) {
          const rec: WorkspaceIdbRecord = {
            compositeKey: `${workspaceId}::${inv.id}`,
            workspaceId,
            invoice: inv,
          };
          store.put(rec);
        }
      }
      tx.oncomplete = () => {
        database.close();
        resolve();
      };
      tx.onerror = () => {
        database.close();
        resolve();
      };
    } catch {
      database.close();
      resolve();
    }
  });
}

async function idbDeleteWorkspaceInvoice(
  workspaceId: string,
  id: string
): Promise<void> {
  const database = await openArchiveDb();
  if (!database) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = database.transaction(WORKSPACE_IDB_STORE, 'readwrite');
      tx.objectStore(WORKSPACE_IDB_STORE).delete(`${workspaceId}::${id}`);
      tx.oncomplete = () => {
        database.close();
        resolve();
      };
      tx.onerror = () => {
        database.close();
        resolve();
      };
    } catch {
      database.close();
      resolve();
    }
  });
}

async function idbGetWorkspaceInvoices(
  workspaceId: string
): Promise<SavedInvoice[]> {
  const database = await openArchiveDb();
  if (!database) return [];
  return new Promise<SavedInvoice[]>((resolve) => {
    try {
      const tx = database.transaction(WORKSPACE_IDB_STORE, 'readonly');
      const store = tx.objectStore(WORKSPACE_IDB_STORE);
      const index = store.index('by_workspace');
      const req = index.getAll(IDBKeyRange.only(workspaceId));
      req.onsuccess = () => {
        const rawList = Array.isArray(req.result)
          ? (req.result as WorkspaceIdbRecord[])
          : [];
        database.close();
        resolve(
          rawList.map((entry) =>
            normalizeSavedInvoice(entry.invoice, workspaceId)
          )
        );
      };
      req.onerror = () => {
        database.close();
        resolve([]);
      };
    } catch {
      database.close();
      resolve([]);
    }
  });
}

// --- Local Storage Read / Write (Scoped by workspaceId) ---

function parseStoredList(
  key: string,
  expectedSyncTag?: string
): SavedInvoice[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => normalizeSavedInvoice(entry, expectedSyncTag))
      .filter((inv) => inv.items.length > 0);
  } catch {
    return [];
  }
}

export function loadLocalSavedInvoices(workspaceId: string): SavedInvoice[] {
  const deletedIds = loadExplicitlyDeletedIds(workspaceId);
  const primary = parseStoredList(
    getWorkspaceSavedStorageKey(workspaceId),
    workspaceId
  );
  const backup = parseStoredList(
    getWorkspaceBackupStorageKey(workspaceId),
    workspaceId
  );
  const byId = new Map<string, SavedInvoice>();

  for (const inv of [...backup, ...primary]) {
    if (deletedIds.has(inv.id)) continue;
    const prev = byId.get(inv.id);
    if (
      !prev ||
      new Date(inv.updatedAt).getTime() >= new Date(prev.updatedAt).getTime()
    ) {
      byId.set(inv.id, inv);
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function saveLocalSavedInvoices(
  workspaceId: string,
  invoices: SavedInvoice[]
): void {
  const valid = invoices.filter((inv) => inv.items.length > 0);
  try {
    const serialized = JSON.stringify(valid);
    localStorage.setItem(getWorkspaceSavedStorageKey(workspaceId), serialized);
    if (valid.length > 0) {
      localStorage.setItem(
        getWorkspaceBackupStorageKey(workspaceId),
        serialized
      );
    }
  } catch {
    // Ignore local storage quota errors; IndexedDB still persists records
  }
  void idbPutWorkspaceInvoices(workspaceId, valid);
}

export async function saveLocalSavedInvoicesAsync(
  workspaceId: string,
  invoices: SavedInvoice[]
): Promise<void> {
  const valid = invoices.filter((inv) => inv.items.length > 0);
  try {
    const serialized = JSON.stringify(valid);
    localStorage.setItem(getWorkspaceSavedStorageKey(workspaceId), serialized);
    if (valid.length > 0) {
      localStorage.setItem(
        getWorkspaceBackupStorageKey(workspaceId),
        serialized
      );
    }
  } catch {
    // Ignore local storage quota errors
  }
  await idbPutWorkspaceInvoices(workspaceId, valid);
}

export async function hydrateAllLocalSavedInvoices(
  workspaceId: string
): Promise<SavedInvoice[]> {
  const deletedIds = loadExplicitlyDeletedIds(workspaceId);
  const syncList = loadLocalSavedInvoices(workspaceId);
  const idbList = await idbGetWorkspaceInvoices(workspaceId);

  const byId = new Map<string, SavedInvoice>();
  for (const inv of [...idbList, ...syncList]) {
    if (deletedIds.has(inv.id) || inv.items.length === 0) continue;
    const existing = byId.get(inv.id);
    if (
      !existing ||
      new Date(inv.updatedAt).getTime() >=
        new Date(existing.updatedAt).getTime()
    ) {
      byId.set(inv.id, inv);
    }
  }

  const merged = Array.from(byId.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  if (merged.length > 0) {
    saveLocalSavedInvoices(workspaceId, merged);
  }
  return merged;
}

export async function explicitlyDeleteLocalInvoice(
  workspaceId: string,
  rawId: string
): Promise<void> {
  const safeId = sanitizeSafeId(rawId, 'inv');
  const delKey = getWorkspaceDeletedIdsKey(workspaceId);
  const deleted = loadExplicitlyDeletedIds(workspaceId);
  deleted.add(rawId);
  deleted.add(safeId);
  writeIdSet(delKey, deleted);

  const pendKey = getWorkspacePendingDeletesKey(workspaceId);
  const pending = readIdSet(pendKey);
  pending.add(safeId);
  writeIdSet(pendKey, pending);

  const remaining = loadLocalSavedInvoices(workspaceId).filter(
    (inv) => inv.id !== rawId && inv.id !== safeId
  );
  try {
    const serialized = JSON.stringify(remaining);
    localStorage.setItem(getWorkspaceSavedStorageKey(workspaceId), serialized);
    localStorage.setItem(getWorkspaceBackupStorageKey(workspaceId), serialized);
  } catch {
    // Ignore quota errors
  }

  await idbDeleteWorkspaceInvoice(workspaceId, rawId);
  if (safeId !== rawId) {
    await idbDeleteWorkspaceInvoice(workspaceId, safeId);
  }
}

export async function removeConfirmedCloudDeletedInvoices(
  workspaceId: string,
  removedIds: string[],
  remainingInvoices: SavedInvoice[]
): Promise<void> {
  if (removedIds.length === 0) return;
  try {
    const serialized = JSON.stringify(remainingInvoices);
    localStorage.setItem(getWorkspaceSavedStorageKey(workspaceId), serialized);
    localStorage.setItem(getWorkspaceBackupStorageKey(workspaceId), serialized);
  } catch {
    // Ignore quota errors
  }
  for (const id of removedIds) {
    await idbDeleteWorkspaceInvoice(workspaceId, id);
  }
}

// --- Shared-Account Firestore Cloud Sync (/workspaces/{workspaceId}/invoices/{invoiceId}) ---

function timestampToISO(val: unknown, fallbackISO: string): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string' && val.trim()) {
    return val;
  }
  return fallbackISO;
}

export async function upsertCloudInvoice(
  session: AccountSession,
  invoice: SavedInvoice
): Promise<void> {
  // 1. Primary Path: Fast same-origin server relay (/api/cloud/workspaces/.../invoices)
  try {
    await apiUpsertWorkspaceInvoice(session, invoice);
    return;
  } catch (err) {
    if (err instanceof CloudRelayError) {
      if (err.code === 'QUOTA_DAILY_READS' || err.code === 'QUOTA_EXCEEDED') {
        throw new Error('Quota exceeded.');
      }
      if (
        err.code !== 'NETWORK_UNREACHABLE' &&
        err.code !== 'RELAY_NOT_JSON' &&
        err.code !== 'FIRESTORE_UNAVAILABLE'
      ) {
        throw err;
      }
    }
  }

  // 2. Fallback Path: Direct Client Firestore with safe <= 8-item batch chunking
  const { workspaceId, usernameKey } = session;
  const invoiceId = sanitizeSafeId(invoice.id, 'inv');
  const safeCode = sanitizeSafeId(invoice.code, 'HD').slice(0, MAX_CODE_LEN);

  const usedItemIds = new Set<string>();
  const boundedItems = invoice.items
    .slice(0, MAX_ITEMS_PER_INVOICE)
    .map((item, idx) => {
      let candidateId = sanitizeSafeId(
        item.id || `item-${idx}`,
        `item-${idx}`
      );
      if (usedItemIds.has(candidateId)) {
        candidateId = sanitizeSafeId(`${candidateId}-${idx}`, `item-${idx}`);
      }
      usedItemIds.add(candidateId);

      return {
        id: candidateId,
        productId: (item.productId || '').trim().slice(0, MAX_ID_LEN),
        name: (item.name.trim() || 'Sản phẩm').slice(0, MAX_ITEM_NAME_LEN),
        unit: (item.unit.trim() || 'Tờ').slice(0, MAX_ITEM_UNIT_LEN),
        quantity: clampInt(item.quantity, 1, MAX_QTY),
        unitPrice: clampMoney(item.unitPrice),
        note: (item.note || '').trim().slice(0, MAX_ITEM_NOTE_LEN),
        sortIndex: clampInt(idx, 0, MAX_ITEMS_PER_INVOICE),
      };
    });

  if (boundedItems.length === 0) return;

  const totals = calculateQuoteTotals(
    boundedItems,
    clampMoney(invoice.discountAmount),
    clampMoney(invoice.shippingFee),
    clampMoney(invoice.depositAmount)
  );

  const mutableFields = {
    invoiceDate: (invoice.createdAt || new Date().toISOString()).slice(
      0,
      MAX_INVOICE_DATE_LEN
    ),
    expectedDemoDate: (invoice.expectedDemoDate || '')
      .trim()
      .slice(0, MAX_DEMO_DATE_LEN),
    customerName: (invoice.customer.name || '')
      .trim()
      .slice(0, MAX_CUSTOMER_NAME_LEN),
    customerCode: (invoice.customer.code || '')
      .trim()
      .slice(0, MAX_CUSTOMER_CODE_LEN),
    customerPhone: (invoice.customer.phone || '')
      .trim()
      .slice(0, MAX_CUSTOMER_PHONE_LEN),
    designIllustration: (invoice.designIllustration || '')
      .trim()
      .slice(0, MAX_DESIGN_ILLUSTRATION_LEN),
    invoiceNote: (invoice.invoiceNote || '').slice(0, MAX_NOTE_LEN),
    reportStage: sanitizeReportStage(invoice.reportStage),
    remainingPaid: Boolean(invoice.remainingPaid),
    remainingPaidAt: invoice.remainingPaid
      ? sanitizeRemainingPaidAt(invoice.remainingPaidAt)
      : '',
    itemSummary: buildItemSummary(boundedItems),
    itemCount: clampInt(boundedItems.length, 1, MAX_ITEMS_PER_INVOICE),
    totalQuantity: clampInt(totals.totalQuantity, 1, MAX_QTY),
    subtotal: clampMoney(totals.subtotal),
    discountAmount: clampMoney(totals.discountAmount),
    shippingFee: clampMoney(totals.shippingFee),
    depositAmount: clampMoney(totals.depositAmount),
    remainingAmount: clampMoney(totals.remainingAmount),
  };

  const invoicePath = `workspaces/${workspaceId}/invoices/${invoiceId}`;
  const itemsPath = `workspaces/${workspaceId}/invoices/${invoiceId}/items`;
  const invoiceRef = doc(db, 'workspaces', workspaceId, 'invoices', invoiceId);

  let existsOnServer = false;
  try {
    const existingInvSnap = await getDoc(invoiceRef);
    existsOnServer = existingInvSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, invoicePath);
  }

  const existingItemIds = new Set<string>();
  if (existsOnServer) {
    try {
      const existingSnap = await getDocs(
        query(
          collection(
            db,
            'workspaces',
            workspaceId,
            'invoices',
            invoiceId,
            'items'
          ),
          where('invoiceId', '==', invoiceId)
        )
      );
      for (const d of existingSnap.docs) {
        existingItemIds.add(d.id);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, itemsPath);
    }
  }

  const incomingIds = new Set(boundedItems.map((i) => i.id));
  const obsoleteIds = Array.from(existingItemIds).filter(
    (oldId) => !incomingIds.has(oldId)
  );

  try {
    const firstChunk = boundedItems.slice(0, SAFE_BATCH_CHUNK);
    const batch1 = writeBatch(db);

    if (!existsOnServer) {
      batch1.set(invoiceRef, {
        workspaceId,
        accountUsername: usernameKey,
        code: safeCode,
        ...mutableFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch1.update(invoiceRef, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
    }

    for (const item of firstChunk) {
      const itemRef = doc(
        db,
        'workspaces',
        workspaceId,
        'invoices',
        invoiceId,
        'items',
        item.id
      );
      if (existsOnServer && existingItemIds.has(item.id)) {
        batch1.update(itemRef, {
          productId: item.productId,
          name: item.name,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          note: item.note,
          sortIndex: item.sortIndex,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch1.set(itemRef, {
          workspaceId,
          invoiceId,
          productId: item.productId,
          name: item.name,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          note: item.note,
          sortIndex: item.sortIndex,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    await batch1.commit();

    for (
      let offset = SAFE_BATCH_CHUNK;
      offset < boundedItems.length;
      offset += SAFE_BATCH_CHUNK
    ) {
      const slice = boundedItems.slice(offset, offset + SAFE_BATCH_CHUNK);
      const extraBatch = writeBatch(db);
      for (const item of slice) {
        const itemRef = doc(
          db,
          'workspaces',
          workspaceId,
          'invoices',
          invoiceId,
          'items',
          item.id
        );
        if (existsOnServer && existingItemIds.has(item.id)) {
          extraBatch.update(itemRef, {
            productId: item.productId,
            name: item.name,
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            note: item.note,
            sortIndex: item.sortIndex,
            updatedAt: serverTimestamp(),
          });
        } else {
          extraBatch.set(itemRef, {
            workspaceId,
            invoiceId,
            productId: item.productId,
            name: item.name,
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            note: item.note,
            sortIndex: item.sortIndex,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await extraBatch.commit();
    }

    for (let offset = 0; offset < obsoleteIds.length; offset += SAFE_BATCH_CHUNK) {
      const delSlice = obsoleteIds.slice(offset, offset + SAFE_BATCH_CHUNK);
      const delBatch = writeBatch(db);
      for (const oldId of delSlice) {
        delBatch.delete(
          doc(
            db,
            'workspaces',
            workspaceId,
            'invoices',
            invoiceId,
            'items',
            oldId
          )
        );
      }
      await delBatch.commit();
    }
  } catch (error) {
    handleFirestoreError(
      error,
      existsOnServer ? OperationType.UPDATE : OperationType.CREATE,
      invoicePath
    );
  }
}

export async function updateCloudInvoiceStage(
  session: AccountSession,
  invoice: SavedInvoice
): Promise<void> {
  const safeStage = sanitizeReportStage(invoice.reportStage);
  const safeRemainingPaid = Boolean(invoice.remainingPaid);
  const safeRemainingPaidAt = safeRemainingPaid
    ? sanitizeRemainingPaidAt(invoice.remainingPaidAt)
    : '';
  const invoiceId = sanitizeSafeId(invoice.id, 'inv');

  // 1. Primary Path: Fast single-document PATCH on same-origin relay
  try {
    const res = await apiUpdateWorkspaceInvoiceStage(
      session,
      invoiceId,
      safeStage,
      {
        remainingPaid: safeRemainingPaid,
        remainingPaidAt: safeRemainingPaidAt,
      }
    );
    if (res.found) {
      return;
    }
    // Invoice not yet in cloud -> create full document + items
    await upsertCloudInvoice(session, invoice);
    return;
  } catch (err) {
    if (err instanceof CloudRelayError) {
      if (err.code === 'QUOTA_DAILY_READS' || err.code === 'QUOTA_EXCEEDED') {
        throw new Error('Quota exceeded.');
      }
      if (
        err.code !== 'NETWORK_UNREACHABLE' &&
        err.code !== 'RELAY_NOT_JSON' &&
        err.code !== 'FIRESTORE_UNAVAILABLE'
      ) {
        throw err;
      }
    }
  }

  // 2. Fallback Path: Direct Client Firestore single-doc update (or full upsert if missing)
  const { workspaceId } = session;
  const invoicePath = `workspaces/${workspaceId}/invoices/${invoiceId}`;
  const invoiceRef = doc(db, 'workspaces', workspaceId, 'invoices', invoiceId);

  let existsOnServer = false;
  try {
    const snap = await getDoc(invoiceRef);
    existsOnServer = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, invoicePath);
  }

  if (!existsOnServer) {
    await upsertCloudInvoice(session, invoice);
    return;
  }

  try {
    await updateDoc(invoiceRef, {
      reportStage: safeStage,
      remainingPaid: safeRemainingPaid,
      remainingPaidAt: safeRemainingPaidAt,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, invoicePath);
  }
}

export async function deleteCloudInvoice(
  session: AccountSession,
  rawInvoiceId: string
): Promise<void> {
  const { workspaceId } = session;
  const invoiceId = sanitizeSafeId(rawInvoiceId, 'inv');

  // 1. Primary Path: Same-origin server relay
  try {
    await apiDeleteWorkspaceInvoice(session, invoiceId);
    clearPendingCloudDeleteId(workspaceId, invoiceId);
    return;
  } catch (err) {
    if (err instanceof CloudRelayError) {
      if (err.code === 'QUOTA_DAILY_READS' || err.code === 'QUOTA_EXCEEDED') {
        throw new Error('Quota exceeded.');
      }
      if (
        err.code !== 'NETWORK_UNREACHABLE' &&
        err.code !== 'RELAY_NOT_JSON' &&
        err.code !== 'FIRESTORE_UNAVAILABLE'
      ) {
        throw err;
      }
    }
  }

  // 2. Fallback Path: Direct Client Firestore with safe <= 8-item batch chunking
  const invoicePath = `workspaces/${workspaceId}/invoices/${invoiceId}`;
  const itemsPath = `workspaces/${workspaceId}/invoices/${invoiceId}/items`;
  const invoiceRef = doc(db, 'workspaces', workspaceId, 'invoices', invoiceId);

  let invExists = false;
  try {
    const invSnap = await getDoc(invoiceRef);
    invExists = invSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, invoicePath);
  }

  if (!invExists) {
    clearPendingCloudDeleteId(workspaceId, invoiceId);
    return;
  }

  let itemIds: string[] = [];
  try {
    const itemsSnap = await getDocs(
      query(
        collection(
          db,
          'workspaces',
          workspaceId,
          'invoices',
          invoiceId,
          'items'
        ),
        where('invoiceId', '==', invoiceId)
      )
    );
    itemIds = itemsSnap.docs.map((d) => d.id);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, itemsPath);
  }

  try {
    while (itemIds.length > SAFE_BATCH_CHUNK) {
      const chunk = itemIds.splice(0, SAFE_BATCH_CHUNK);
      const chunkBatch = writeBatch(db);
      for (const id of chunk) {
        chunkBatch.delete(
          doc(
            db,
            'workspaces',
            workspaceId,
            'invoices',
            invoiceId,
            'items',
            id
          )
        );
      }
      await chunkBatch.commit();
    }

    const finalBatch = writeBatch(db);
    for (const id of itemIds) {
      finalBatch.delete(
        doc(db, 'workspaces', workspaceId, 'invoices', invoiceId, 'items', id)
      );
    }
    finalBatch.delete(invoiceRef);
    await finalBatch.commit();
    clearPendingCloudDeleteId(workspaceId, invoiceId);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, invoicePath);
  }
}

export function subscribeToCloudInvoices(
  session: AccountSession,
  onReceive: (
    invoices: SavedInvoice[],
    cloudIds: Set<string>,
    removedDocIds: Set<string>,
    snapshotFromCache: boolean
  ) => void,
  onErrorMsg?: (message: string) => void
): () => void {
  const { workspaceId } = session;
  const invoicesListPath = `workspaces/${workspaceId}/invoices`;
  const invoicesQuery = query(
    collection(db, 'workspaces', workspaceId, 'invoices'),
    where('workspaceId', '==', workspaceId)
  );

  const itemsCache = new Map<
    string,
    { cacheKey: string; items: QuoteItem[] }
  >();
  let latestSeq = 0;

  return onSnapshot(
    invoicesQuery,
    async (snapshot) => {
      const currentSeq = ++latestSeq;
      try {
        const snapshotFromCache =
          snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites;
        const cloudIds = new Set<string>();
        const removedDocIds = new Set<string>();

        for (const change of snapshot.docChanges()) {
          if (change.type === 'removed') {
            removedDocIds.add(change.doc.id);
          }
        }

        const results: SavedInvoice[] = await Promise.all(
          snapshot.docs.map(async (invDoc) => {
            const invId = invDoc.id;
            cloudIds.add(invId);
            const data = invDoc.data();
            const fallbackNow = new Date().toISOString();
            const updatedAtISO = timestampToISO(data.updatedAt, fallbackNow);
            const cacheKey = `${updatedAtISO}_${String(data.itemCount ?? '')}_${String(data.subtotal ?? '')}_${String(data.itemSummary ?? '')}`;

            const cached = itemsCache.get(invId);
            let items: QuoteItem[] = [];

            if (
              cached &&
              cached.cacheKey === cacheKey &&
              cached.items.length > 0 &&
              !invDoc.metadata.hasPendingWrites
            ) {
              items = cached.items;
            } else {
              const itemsPath = `workspaces/${workspaceId}/invoices/${invId}/items`;
              try {
                const itemsSnap = await getDocs(
                  query(
                    collection(
                      db,
                      'workspaces',
                      workspaceId,
                      'invoices',
                      invId,
                      'items'
                    ),
                    where('invoiceId', '==', invId)
                  )
                );
                const rawItems = itemsSnap.docs
                  .map((d) => {
                    const idata = d.data();
                    return {
                      id: d.id,
                      productId:
                        typeof idata.productId === 'string' && idata.productId
                          ? idata.productId
                          : undefined,
                      name: String(idata.name || 'Sản phẩm'),
                      unit: String(idata.unit || 'Tờ'),
                      quantity: Number(idata.quantity) || 1,
                      unitPrice: Number(idata.unitPrice) || 0,
                      note: String(idata.note || ''),
                      sortIndex: Number(idata.sortIndex) || 0,
                    };
                  })
                  .sort((a, b) => a.sortIndex - b.sortIndex);

                items = rawItems.map(({ sortIndex: _s, ...rest }) => rest);
                if (items.length > 0) {
                  itemsCache.set(invId, { cacheKey, items });
                }
              } catch (itemErr) {
                handleFirestoreError(itemErr, OperationType.LIST, itemsPath);
              }
            }

            const discountAmount = Number(data.discountAmount) || 0;
            const shippingFee = Number(data.shippingFee) || 0;
            const depositAmount = Number(data.depositAmount) || 0;
            const totals = calculateQuoteTotals(
              items,
              discountAmount,
              shippingFee,
              depositAmount
            );

            return {
              id: invId,
              code: String(data.code || invId),
              createdAt: String(
                data.invoiceDate || timestampToISO(data.createdAt, fallbackNow)
              ),
              updatedAt: updatedAtISO,
              expectedDemoDate: String(data.expectedDemoDate || ''),
              customer: {
                name: String(data.customerName || ''),
                code: String(data.customerCode || ''),
                phone: String(data.customerPhone || ''),
              },
              items,
              discountAmount,
              shippingFee,
              depositAmount,
              designIllustration:
                typeof data.designIllustration === 'string'
                  ? data.designIllustration
                  : DEFAULT_DESIGN_ILLUSTRATION,
              invoiceNote: String(data.invoiceNote || ''),
              reportStage: sanitizeReportStage(data.reportStage),
              remainingPaid:
                typeof data.remainingPaid === 'boolean'
                  ? data.remainingPaid
                  : undefined,
              remainingPaidAt:
                sanitizeRemainingPaidAt(data.remainingPaidAt) || undefined,
              totals,
              syncedToCloud: true,
              syncedOwnerUid: workspaceId,
            };
          })
        );

        if (currentSeq !== latestSeq) return;

        const validResults = results.filter((inv) => inv.items.length > 0);
        validResults.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        onReceive(validResults, cloudIds, removedDocIds, snapshotFromCache);
      } catch (err) {
        if (currentSeq !== latestSeq) return;
        const info = inspectFirestoreError(err);
        if (onErrorMsg && info.isQuotaExceeded) {
          onErrorMsg(
            'Đã chạm giới hạn đọc/ghi miễn phí trong ngày của Firestore. Hạn mức sẽ tự động làm mới vào ngày mai.'
          );
        }
      }
    },
    (error) => {
      const info = inspectFirestoreError(error);
      if (info.isQuotaExceeded) {
        onErrorMsg?.(
          'Đã chạm giới hạn đọc/ghi miễn phí trong ngày của Firestore. Hạn mức sẽ tự động làm mới vào ngày mai.'
        );
        return;
      }
      if (info.isOfflineOrNetwork) {
        // Server relay polling continues keeping data in sync when browser WebChannel is blocked
        return;
      }
      handleFirestoreError(error, OperationType.LIST, invoicesListPath);
    }
  );
}

// --- Optional One-Click Migration of Pre-Account Legacy Quotes ---

export function isLegacyImportHandled(workspaceId: string): boolean {
  try {
    return (
      localStorage.getItem(getWorkspaceLegacyHandledKey(workspaceId)) === '1'
    );
  } catch {
    return false;
  }
}

export function markLegacyImportHandled(workspaceId: string): void {
  try {
    localStorage.setItem(getWorkspaceLegacyHandledKey(workspaceId), '1');
  } catch {
    // Ignore storage errors
  }
}

export async function discoverLegacyPreAccountInvoices(
  workspaceId: string
): Promise<SavedInvoice[]> {
  if (isLegacyImportHandled(workspaceId)) return [];

  const byId = new Map<string, SavedInvoice>();

  // 1. Local pre-account invoices on this device
  const localPrimary = parseStoredList(LEGACY_LOCAL_SAVED_KEY);
  const localBackup = parseStoredList(LEGACY_LOCAL_BACKUP_KEY);
  for (const inv of [...localBackup, ...localPrimary]) {
    if (inv.items.length > 0) {
      byId.set(inv.id, {
        ...inv,
        syncedToCloud: false,
        syncedOwnerUid: undefined,
      });
    }
  }

  // 2. Legacy IndexedDB store on this device
  const database = await openArchiveDb();
  if (database) {
    const legacyIdbList = await new Promise<SavedInvoice[]>((resolve) => {
      try {
        if (!database.objectStoreNames.contains(LEGACY_IDB_STORE)) {
          database.close();
          resolve([]);
          return;
        }
        const tx = database.transaction(LEGACY_IDB_STORE, 'readonly');
        const req = tx.objectStore(LEGACY_IDB_STORE).getAll();
        req.onsuccess = () => {
          const rawList = Array.isArray(req.result) ? req.result : [];
          database.close();
          resolve(rawList.map((e) => normalizeSavedInvoice(e)));
        };
        req.onerror = () => {
          database.close();
          resolve([]);
        };
      } catch {
        database.close();
        resolve([]);
      }
    });
    for (const inv of legacyIdbList) {
      if (inv.items.length > 0) {
        byId.set(inv.id, {
          ...inv,
          syncedToCloud: false,
          syncedOwnerUid: undefined,
        });
      }
    }
  }

  // 3. Server Relay first for Legacy Firestore /invoices
  let fetchedViaRelay = false;
  try {
    const remoteLegacy = await apiFetchLegacyInvoices();
    fetchedViaRelay = true;
    for (const inv of remoteLegacy) {
      if (!byId.has(inv.id) && inv.items.length > 0) {
        byId.set(inv.id, {
          ...normalizeSavedInvoice(inv),
          syncedToCloud: false,
          syncedOwnerUid: undefined,
        });
      }
    }
  } catch {
    fetchedViaRelay = false;
  }

  // 4. Fallback to direct client Firestore /invoices
  if (!fetchedViaRelay) {
    try {
      const legacySnap = await getDocs(
        query(collection(db, 'invoices'), where('itemCount', '>=', 1))
      );
      for (const invDoc of legacySnap.docs) {
        if (byId.has(invDoc.id)) continue;
        const data = invDoc.data();
        const itemsPath = `invoices/${invDoc.id}/items`;
        let items: QuoteItem[] = [];
        try {
          const itemsSnap = await getDocs(
            query(
              collection(db, 'invoices', invDoc.id, 'items'),
              where('invoiceId', '==', invDoc.id)
            )
          );
          items = itemsSnap.docs
            .map((d) => {
              const idata = d.data();
              return {
                id: d.id,
                productId:
                  typeof idata.productId === 'string' && idata.productId
                    ? idata.productId
                    : undefined,
                name: String(idata.name || 'Sản phẩm'),
                unit: String(idata.unit || 'Tờ'),
                quantity: Number(idata.quantity) || 1,
                unitPrice: Number(idata.unitPrice) || 0,
                note: String(idata.note || ''),
                sortIndex: Number(idata.sortIndex) || 0,
              };
            })
            .sort((a, b) => a.sortIndex - b.sortIndex)
            .map(({ sortIndex: _s, ...rest }) => rest);
        } catch (itemErr) {
          handleFirestoreError(itemErr, OperationType.LIST, itemsPath);
        }

        if (items.length === 0) continue;
        const fallbackNow = new Date().toISOString();
        const discountAmount = Number(data.discountAmount) || 0;
        const shippingFee = Number(data.shippingFee) || 0;
        const depositAmount = Number(data.depositAmount) || 0;
        const totals = calculateQuoteTotals(
          items,
          discountAmount,
          shippingFee,
          depositAmount
        );

        byId.set(invDoc.id, {
          id: invDoc.id,
          code: String(data.code || invDoc.id),
          createdAt: String(
            data.invoiceDate || timestampToISO(data.createdAt, fallbackNow)
          ),
          updatedAt: timestampToISO(data.updatedAt, fallbackNow),
          expectedDemoDate: String(data.expectedDemoDate || ''),
          customer: {
            name: String(data.customerName || ''),
            code: String(data.customerCode || ''),
            phone: String(data.customerPhone || ''),
          },
          items,
          discountAmount,
          shippingFee,
          depositAmount,
          designIllustration:
            typeof data.designIllustration === 'string'
              ? data.designIllustration
              : DEFAULT_DESIGN_ILLUSTRATION,
          invoiceNote: String(data.invoiceNote || ''),
          totals,
          syncedToCloud: false,
          syncedOwnerUid: undefined,
        });
      }
    } catch (error) {
      const info = inspectFirestoreError(error);
      if (!info.isQuotaExceeded && !info.isOfflineOrNetwork) {
        handleFirestoreError(error, OperationType.LIST, 'invoices');
      }
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

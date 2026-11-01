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
import {
  AccountSession,
  Product,
  RevenueEntry,
  SavedInvoice,
} from '../types';
import {
  buildRemainingRevenueEntryIdForInvoice,
  buildRevenueEntryIdForInvoice,
  buildStageRevenueEntriesFromInvoice,
  clampRevenuePart,
  isInvoiceRemainingSettled,
  isRemainingStageRevenueEntry,
  isSuccessfulOrderForRevenue,
  normalizeOrderDateString,
} from '../utils/revenueSplit';
import {
  apiDeleteWorkspaceRevenueEntry,
  apiUpsertWorkspaceRevenueEntry,
  CloudRelayError,
} from './cloudApiClient';
import { sanitizeSafeId } from './invoiceStorage';

const SAFE_INVOICE_ID_RE = /^[a-zA-Z0-9_-]*$/;

function wsKeyPrefix(workspaceId: string): string {
  return `atdcolor_ws_${workspaceId.slice(0, 27)}`;
}

export function getWorkspaceRevenueEntriesStorageKey(
  workspaceId: string
): string {
  return `${wsKeyPrefix(workspaceId)}_revenue_entries`;
}

function getWorkspaceDeletedManualRevenueIdsKey(workspaceId: string): string {
  return `${wsKeyPrefix(workspaceId)}_deleted_revenue_entries`;
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

function sanitizeOptionalInvoiceId(raw: unknown): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const cleaned = trimmed
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 128);
  return SAFE_INVOICE_ID_RE.test(cleaned) ? cleaned : '';
}

export function normalizeRevenueEntry(
  raw: Partial<RevenueEntry>
): RevenueEntry | null {
  const id = sanitizeSafeId(String(raw.id || ''), 'rev');
  if (!id) return null;

  const nowISO = new Date().toISOString();
  const orderDate = normalizeOrderDateString(raw.orderDate);
  const monthKey = orderDate.slice(0, 7);

  const designAmount = clampRevenuePart(
    typeof raw.designAmount === 'number' ? raw.designAmount : 0
  );
  const printAmount = clampRevenuePart(
    typeof raw.printAmount === 'number' ? raw.printAmount : 0
  );
  const totalRevenue = designAmount + printAmount;

  const customerName =
    String(raw.customerName || '')
      .trim()
      .slice(0, 120) || 'Khách lẻ';

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
    invoiceId: sanitizeOptionalInvoiceId(raw.invoiceId),
    invoiceCode: String(raw.invoiceCode || '')
      .trim()
      .slice(0, 40),
    orderDate,
    monthKey,
    customerName,
    customerPhone: String(raw.customerPhone || '')
      .trim()
      .slice(0, 30),
    customerCode: String(raw.customerCode || '')
      .trim()
      .slice(0, 30),
    designAmount,
    printAmount,
    totalRevenue,
    isManualOverride: Boolean(raw.isManualOverride),
    isDeleted: Boolean(raw.isDeleted),
    note: String(raw.note || '').slice(0, 500),
    createdAt,
    updatedAt,
  };
}

export function loadDeletedManualRevenueIds(workspaceId: string): Set<string> {
  try {
    const raw = localStorage.getItem(
      getWorkspaceDeletedManualRevenueIdsKey(workspaceId)
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

export function markManualRevenueDeletedLocally(
  workspaceId: string,
  entryId: string
): void {
  try {
    const existing = loadDeletedManualRevenueIds(workspaceId);
    existing.add(entryId);
    localStorage.setItem(
      getWorkspaceDeletedManualRevenueIdsKey(workspaceId),
      JSON.stringify(Array.from(existing).slice(-500))
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function clearManualRevenueDeletedTombstone(
  workspaceId: string,
  entryId: string
): void {
  try {
    const existing = loadDeletedManualRevenueIds(workspaceId);
    if (existing.delete(entryId)) {
      localStorage.setItem(
        getWorkspaceDeletedManualRevenueIdsKey(workspaceId),
        JSON.stringify(Array.from(existing))
      );
    }
  } catch {
    // Ignore storage quota errors
  }
}

function sortRevenueEntries(list: RevenueEntry[]): RevenueEntry[] {
  return [...list].sort((a, b) => {
    const dateCmp = b.orderDate.localeCompare(a.orderDate);
    if (dateCmp !== 0) return dateCmp;
    return (
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  });
}

export function loadLocalRevenueEntries(workspaceId: string): RevenueEntry[] {
  try {
    const deletedManualIds = loadDeletedManualRevenueIds(workspaceId);
    const raw = localStorage.getItem(
      getWorkspaceRevenueEntriesStorageKey(workspaceId)
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const list: RevenueEntry[] = [];
    for (const item of parsed) {
      const norm = normalizeRevenueEntry(item);
      if (norm && !deletedManualIds.has(norm.id)) {
        list.push(norm);
      }
    }
    return sortRevenueEntries(list);
  } catch {
    return [];
  }
}

export function saveLocalRevenueEntries(
  workspaceId: string,
  entries: RevenueEntry[]
): void {
  try {
    localStorage.setItem(
      getWorkspaceRevenueEntriesStorageKey(workspaceId),
      JSON.stringify(entries)
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function mergeRevenueEntries(
  workspaceId: string,
  localList: RevenueEntry[],
  remoteList: RevenueEntry[]
): RevenueEntry[] {
  const deletedManualIds = loadDeletedManualRevenueIds(workspaceId);
  const byId = new Map<string, RevenueEntry>();

  for (const loc of localList) {
    const norm = normalizeRevenueEntry(loc);
    if (norm && !deletedManualIds.has(norm.id)) {
      byId.set(norm.id, norm);
    }
  }

  for (const rem of remoteList) {
    const norm = normalizeRevenueEntry(rem);
    if (!norm || deletedManualIds.has(norm.id)) continue;
    const prev = byId.get(norm.id);
    if (
      !prev ||
      new Date(norm.updatedAt).getTime() >= new Date(prev.updatedAt).getTime()
    ) {
      byId.set(norm.id, norm);
    }
  }

  return sortRevenueEntries(Array.from(byId.values()));
}

function hasEntryDiff(
  existing: RevenueEntry | undefined,
  candidate: RevenueEntry
): boolean {
  return (
    !existing ||
    existing.invoiceCode !== candidate.invoiceCode ||
    existing.orderDate !== candidate.orderDate ||
    existing.monthKey !== candidate.monthKey ||
    existing.customerName !== candidate.customerName ||
    existing.customerPhone !== candidate.customerPhone ||
    existing.customerCode !== candidate.customerCode ||
    existing.designAmount !== candidate.designAmount ||
    existing.printAmount !== candidate.printAmount ||
    existing.totalRevenue !== candidate.totalRevenue ||
    existing.isDeleted !== candidate.isDeleted ||
    existing.note !== candidate.note
  );
}

/**
 * Permanently reconciles successful orders into monthly revenue entries across 2 payment stages:
 * - Stage 1 (rev_{invoiceId}): Deposit collected on invoice creation date (or full amount on settlement date if 0 deposit).
 * - Stage 2 (rev_rem_{invoiceId}): Remaining balance collected on remainingPaidAt / Hoàn thành date.
 * CRITICAL INVARIANT: Never auto-deletes historical Stage 1 revenue entries if a quote is removed from SavedInvoices.
 */
export function reconcileInvoicesIntoRevenueEntries(
  invoices: SavedInvoice[],
  catalogProducts: Product[],
  existingEntries: RevenueEntry[],
  storeFooterNote?: string
): {
  nextEntries: RevenueEntry[];
  changedEntries: RevenueEntry[];
} {
  const byId = new Map<string, RevenueEntry>();
  const stage1ByInvoiceId = new Map<string, RevenueEntry>();
  const stage2ByInvoiceId = new Map<string, RevenueEntry>();

  for (const entry of existingEntries) {
    const norm = normalizeRevenueEntry(entry);
    if (!norm) continue;
    byId.set(norm.id, norm);
    if (norm.invoiceId) {
      if (isRemainingStageRevenueEntry(norm)) {
        stage2ByInvoiceId.set(norm.invoiceId, norm);
      } else {
        stage1ByInvoiceId.set(norm.invoiceId, norm);
      }
    }
  }

  const changedEntries: RevenueEntry[] = [];

  for (const inv of invoices) {
    const safeInvId = sanitizeSafeId(inv.id, 'inv');
    const existingStage1 =
      stage1ByInvoiceId.get(safeInvId) ||
      byId.get(buildRevenueEntryIdForInvoice(inv.id));
    const existingStage2 =
      stage2ByInvoiceId.get(safeInvId) ||
      byId.get(buildRemainingRevenueEntryIdForInvoice(inv.id));

    if (!isSuccessfulOrderForRevenue(inv, storeFooterNote)) {
      // Never auto-delete Stage 1 historical revenue records!
      // However, if Stage 2 (remaining balance) was previously booked and staff reverted settlement, hide Stage 2.
      if (
        existingStage2 &&
        !existingStage2.isDeleted &&
        !existingStage2.isManualOverride &&
        !isInvoiceRemainingSettled(inv)
      ) {
        const hiddenStage2: RevenueEntry = {
          ...existingStage2,
          isDeleted: true,
          updatedAt: new Date(
            Math.max(
              Date.now(),
              new Date(existingStage2.updatedAt).getTime() + 1000
            )
          ).toISOString(),
        };
        byId.set(hiddenStage2.id, hiddenStage2);
        stage2ByInvoiceId.set(safeInvId, hiddenStage2);
        changedEntries.push(hiddenStage2);
      }
      continue;
    }

    const invUpdatedMs = new Date(inv.updatedAt).getTime();
    const shouldRestoreStage1 = Boolean(
      existingStage1?.isDeleted &&
        !existingStage1.isManualOverride &&
        Number.isFinite(invUpdatedMs) &&
        invUpdatedMs >= new Date(existingStage1.updatedAt).getTime()
    );
    const shouldRestoreStage2 = Boolean(
      existingStage2?.isDeleted &&
        !existingStage2.isManualOverride &&
        Number.isFinite(invUpdatedMs) &&
        invUpdatedMs >= new Date(existingStage2.updatedAt).getTime()
    );

    const { stage1Candidate, stage2Candidate } =
      buildStageRevenueEntriesFromInvoice(
        inv,
        catalogProducts,
        existingStage1,
        existingStage2,
        {
          forceRestoreStage1: shouldRestoreStage1,
          forceRestoreStage2: shouldRestoreStage2,
        }
      );

    // 1. Reconcile Stage 1 (Deposit or 0-deposit full settlement)
    if (stage1Candidate) {
      const skipStage1 =
        (existingStage1?.isDeleted && !shouldRestoreStage1) ||
        Boolean(existingStage1?.isManualOverride);
      if (!skipStage1 && hasEntryDiff(existingStage1, stage1Candidate)) {
        byId.set(stage1Candidate.id, stage1Candidate);
        stage1ByInvoiceId.set(safeInvId, stage1Candidate);
        changedEntries.push(stage1Candidate);
      }
    } else if (
      existingStage1 &&
      !existingStage1.isDeleted &&
      !existingStage1.isManualOverride
    ) {
      const hiddenStage1: RevenueEntry = {
        ...existingStage1,
        isDeleted: true,
        updatedAt: new Date(
          Math.max(
            Date.now(),
            new Date(existingStage1.updatedAt).getTime() + 1000
          )
        ).toISOString(),
      };
      byId.set(hiddenStage1.id, hiddenStage1);
      stage1ByInvoiceId.set(safeInvId, hiddenStage1);
      changedEntries.push(hiddenStage1);
    }

    // 2. Reconcile Stage 2 (Remaining balance when settled)
    if (stage2Candidate) {
      const skipStage2 =
        (existingStage2?.isDeleted && !shouldRestoreStage2) ||
        Boolean(existingStage2?.isManualOverride);
      if (!skipStage2 && hasEntryDiff(existingStage2, stage2Candidate)) {
        byId.set(stage2Candidate.id, stage2Candidate);
        stage2ByInvoiceId.set(safeInvId, stage2Candidate);
        changedEntries.push(stage2Candidate);
      }
    } else if (
      existingStage2 &&
      !existingStage2.isDeleted &&
      !existingStage2.isManualOverride
    ) {
      const hiddenStage2: RevenueEntry = {
        ...existingStage2,
        isDeleted: true,
        updatedAt: new Date(
          Math.max(
            Date.now(),
            new Date(existingStage2.updatedAt).getTime() + 1000
          )
        ).toISOString(),
      };
      byId.set(hiddenStage2.id, hiddenStage2);
      stage2ByInvoiceId.set(safeInvId, hiddenStage2);
      changedEntries.push(hiddenStage2);
    }
  }

  if (changedEntries.length === 0) {
    return { nextEntries: existingEntries, changedEntries: [] };
  }

  return {
    nextEntries: sortRevenueEntries(Array.from(byId.values())),
    changedEntries,
  };
}

export async function upsertRevenueEntryToCloud(
  session: AccountSession,
  entry: RevenueEntry
): Promise<void> {
  const normalized = normalizeRevenueEntry(entry);
  if (!normalized) return;

  // 1. Primary Path: Same-origin server relay
  try {
    await apiUpsertWorkspaceRevenueEntry(session, normalized);
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
  const docPath = `workspaces/${session.workspaceId}/revenueEntries/${normalized.id}`;
  const docRef = doc(
    db,
    'workspaces',
    session.workspaceId,
    'revenueEntries',
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

  const mutableFields = {
    invoiceCode: normalized.invoiceCode,
    orderDate: normalized.orderDate,
    monthKey: normalized.monthKey,
    customerName: normalized.customerName,
    customerPhone: normalized.customerPhone,
    customerCode: normalized.customerCode,
    designAmount: normalized.designAmount,
    printAmount: normalized.printAmount,
    totalRevenue: normalized.totalRevenue,
    isManualOverride: normalized.isManualOverride,
    isDeleted: normalized.isDeleted,
    note: normalized.note,
  };

  try {
    if (!existsOnServer) {
      await setDoc(docRef, {
        workspaceId: session.workspaceId,
        accountUsername: session.usernameKey,
        invoiceId: normalized.invoiceId,
        ...mutableFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(docRef, {
        ...mutableFields,
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

export async function deleteRevenueEntryFromCloud(
  session: AccountSession,
  entryId: string
): Promise<void> {
  const safeId = sanitizeSafeId(entryId, 'rev');

  // 1. Primary Path: Same-origin server relay
  try {
    await apiDeleteWorkspaceRevenueEntry(session, safeId);
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
  const docPath = `workspaces/${session.workspaceId}/revenueEntries/${safeId}`;
  const docRef = doc(
    db,
    'workspaces',
    session.workspaceId,
    'revenueEntries',
    safeId
  );

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

export function subscribeToRevenueEntries(
  session: AccountSession,
  onReceive: (entries: RevenueEntry[]) => void
): () => void {
  const colPath = `workspaces/${session.workspaceId}/revenueEntries`;
  const q = query(
    collection(db, 'workspaces', session.workspaceId, 'revenueEntries'),
    where('workspaceId', '==', session.workspaceId)
  );

  return onSnapshot(
    q,
    (snap) => {
      const fallbackNow = new Date().toISOString();
      const deletedManual = loadDeletedManualRevenueIds(session.workspaceId);
      const received: RevenueEntry[] = [];
      snap.docs.forEach((d) => {
        if (deletedManual.has(d.id)) return;
        const data = d.data();
        const norm = normalizeRevenueEntry({
          id: d.id,
          invoiceId: String(data.invoiceId || ''),
          invoiceCode: String(data.invoiceCode || ''),
          orderDate: String(data.orderDate || ''),
          monthKey: String(data.monthKey || ''),
          customerName: String(data.customerName || 'Khách lẻ'),
          customerPhone: String(data.customerPhone || ''),
          customerCode: String(data.customerCode || ''),
          designAmount: Number(data.designAmount) || 0,
          printAmount: Number(data.printAmount) || 0,
          totalRevenue: Number(data.totalRevenue) || 0,
          isManualOverride: Boolean(data.isManualOverride),
          isDeleted: Boolean(data.isDeleted),
          note: String(data.note || ''),
          createdAt: timestampToISO(data.createdAt, fallbackNow),
          updatedAt: timestampToISO(data.updatedAt, fallbackNow),
        });
        if (norm) received.push(norm);
      });
      onReceive(sortRevenueEntries(received));
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

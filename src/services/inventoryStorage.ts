import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  INITIAL_INVENTORY_ITEMS,
  LEGACY_V1_INVENTORY_IDS,
} from '../data/initialData';
import {
  db,
  handleFirestoreError,
  inspectFirestoreError,
  OperationType,
} from '../firebase';
import { AccountSession, InventoryAlert, InventoryItem } from '../types';
import {
  apiDeleteWorkspaceInventoryItem,
  apiSyncWorkspaceInventory,
  apiUpsertWorkspaceInventoryItem,
  CloudRelayError,
} from './cloudApiClient';
import { sanitizeSafeId } from './invoiceStorage';

const MAX_INVENTORY_ITEMS = 500;
const MAX_STOCK_QTY = 1_000_000;
const MAX_PACK_SIZE = 100_000;
const MAX_NAME_LEN = 160;
const MAX_UNIT_LEN = 40;
const MAX_PACK_LABEL_LEN = 120;
const SAFE_BATCH_CHUNK = 8;
const LEGACY_V1_SET = new Set<string>(LEGACY_V1_INVENTORY_IDS);

function wsKeyPrefix(workspaceId: string): string {
  return `atdcolor_ws_${workspaceId.slice(0, 27)}`;
}

export function getWorkspaceInventoryStorageKey(workspaceId: string): string {
  return `${wsKeyPrefix(workspaceId)}_inventory`;
}

function getWorkspaceDeletedInventoryIdsKey(workspaceId: string): string {
  return `${wsKeyPrefix(workspaceId)}_deleted_inventory`;
}

function getWorkspaceInventoryCatalogV2Key(workspaceId: string): string {
  return `${wsKeyPrefix(workspaceId)}_inv_catalog_v2`;
}

export function isOtherMaterialItem(
  item: Pick<InventoryItem, 'id' | 'packLabel'>
): boolean {
  return (
    item.id.startsWith('inv-v2-other-') ||
    /^vật liệu khác/i.test(item.packLabel.trim())
  );
}

export function isTapeMaterialName(name: string): boolean {
  return /băng\s*keo/iu.test(name);
}

export function getCleanPackLabel(packLabel: string): string {
  return packLabel.replace(/^vật liệu khác\s*[·:-]?\s*/i, '').trim();
}

function clampStock(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.min(MAX_STOCK_QTY, Math.max(0, Math.round(val))) + 0;
}

function clampPackSize(val: number): number {
  if (!Number.isFinite(val)) return 1;
  return Math.min(MAX_PACK_SIZE, Math.max(1, Math.round(val))) + 0;
}

function clampSortIndex(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.min(MAX_INVENTORY_ITEMS, Math.max(0, Math.trunc(val))) + 0;
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

export function normalizeInventoryItem(
  raw: Partial<InventoryItem>,
  fallbackIndex = 0
): InventoryItem | null {
  const name = String(raw.name || '')
    .trim()
    .slice(0, MAX_NAME_LEN);
  if (!name) return null;

  const rawUnit = (String(raw.unit || '').trim() || 'Tấm').slice(
    0,
    MAX_UNIT_LEN
  );
  const isTape = isTapeMaterialName(name);
  const unit =
    isTape && /^cuộn$/iu.test(rawUnit)
      ? 'Cây'
      : isTape && !raw.unit
        ? 'Cây'
        : rawUnit;
  const rawPackLabel = String(raw.packLabel || '')
    .trim()
    .slice(0, MAX_PACK_LABEL_LEN);
  const packLabel = isTape
    ? rawPackLabel.replace(/(^|[\s\d])cuộn(?=$|\s|[.,;)])/giu, '$1cây')
    : rawPackLabel;

  const nowISO = new Date().toISOString();
  const id = sanitizeSafeId(
    String(raw.id || `inv-${fallbackIndex}`),
    `inv-${fallbackIndex}`
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
    unit,
    quantity: clampStock(typeof raw.quantity === 'number' ? raw.quantity : 0),
    minThreshold: clampStock(
      typeof raw.minThreshold === 'number' ? raw.minThreshold : 0
    ),
    packSize: clampPackSize(
      typeof raw.packSize === 'number' ? raw.packSize : 1
    ),
    packLabel,
    sortIndex: clampSortIndex(
      typeof raw.sortIndex === 'number' ? raw.sortIndex : fallbackIndex
    ),
    createdAt,
    updatedAt,
  };
}

export function loadDeletedInventoryIds(workspaceId: string): Set<string> {
  try {
    const raw = localStorage.getItem(
      getWorkspaceDeletedInventoryIdsKey(workspaceId)
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

export function markInventoryItemDeletedLocally(
  workspaceId: string,
  itemId: string
): void {
  try {
    const existing = loadDeletedInventoryIds(workspaceId);
    existing.add(itemId);
    localStorage.setItem(
      getWorkspaceDeletedInventoryIdsKey(workspaceId),
      JSON.stringify(Array.from(existing).slice(-300))
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function clearInventoryDeletedTombstone(
  workspaceId: string,
  itemId: string
): void {
  try {
    const existing = loadDeletedInventoryIds(workspaceId);
    if (existing.delete(itemId)) {
      localStorage.setItem(
        getWorkspaceDeletedInventoryIdsKey(workspaceId),
        JSON.stringify(Array.from(existing))
      );
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function clearAllInventoryDeletedTombstones(workspaceId: string): void {
  try {
    localStorage.removeItem(getWorkspaceDeletedInventoryIdsKey(workspaceId));
  } catch {
    // Ignore storage quota errors
  }
}

export function saveLocalInventory(
  workspaceId: string,
  items: InventoryItem[]
): void {
  try {
    localStorage.setItem(
      getWorkspaceInventoryStorageKey(workspaceId),
      JSON.stringify(items)
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function markInventoryCatalogV2Ready(workspaceId: string): void {
  try {
    localStorage.setItem(getWorkspaceInventoryCatalogV2Key(workspaceId), '1');
  } catch {
    // Ignore storage quota errors
  }
  for (const legacyId of LEGACY_V1_INVENTORY_IDS) {
    markInventoryItemDeletedLocally(workspaceId, legacyId);
  }
}

export function upgradeInventoryCatalogIfNeeded(
  workspaceId: string,
  list: InventoryItem[]
): { items: InventoryItem[]; needsCloudSync: boolean } {
  let v2Ready = false;
  try {
    v2Ready =
      localStorage.getItem(getWorkspaceInventoryCatalogV2Key(workspaceId)) ===
      '1';
  } catch {
    v2Ready = false;
  }

  const hasV2 = list.some((i) => i.id.startsWith('inv-v2-'));
  const hasLegacy = list.some((i) => LEGACY_V1_SET.has(i.id));

  if (!v2Ready) {
    markInventoryCatalogV2Ready(workspaceId);
    const customItems = list.filter(
      (i) => !LEGACY_V1_SET.has(i.id) && !i.id.startsWith('inv-v2-')
    );
    const baseV2 = hasV2
      ? list.filter((i) => i.id.startsWith('inv-v2-'))
      : INITIAL_INVENTORY_ITEMS.map((i) => ({ ...i }));
    const upgraded = [...baseV2, ...customItems].map((it, idx) => ({
      ...it,
      sortIndex: idx,
    }));
    saveLocalInventory(workspaceId, upgraded);
    return { items: upgraded, needsCloudSync: !hasV2 || hasLegacy };
  }

  if (hasLegacy) {
    for (const legacyId of LEGACY_V1_INVENTORY_IDS) {
      markInventoryItemDeletedLocally(workspaceId, legacyId);
    }
    let filtered = list.filter((i) => !LEGACY_V1_SET.has(i.id));
    if (filtered.length === 0 && !hasV2) {
      filtered = INITIAL_INVENTORY_ITEMS.map((i) => ({ ...i }));
    }
    const upgraded = filtered.map((it, idx) => ({
      ...it,
      sortIndex: idx,
    }));
    saveLocalInventory(workspaceId, upgraded);
    return { items: upgraded, needsCloudSync: true };
  }

  return { items: list, needsCloudSync: false };
}

export function loadLocalInventory(workspaceId: string): InventoryItem[] {
  try {
    const deleted = loadDeletedInventoryIds(workspaceId);
    const raw = localStorage.getItem(
      getWorkspaceInventoryStorageKey(workspaceId)
    );
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const list: InventoryItem[] = [];
        parsed.forEach((entry, idx) => {
          const norm = normalizeInventoryItem(entry, idx);
          if (norm && !deleted.has(norm.id)) {
            list.push(norm);
          }
        });
        if (list.length > 0 || parsed.length === 0) {
          const sorted = list.sort((a, b) => a.sortIndex - b.sortIndex);
          return upgradeInventoryCatalogIfNeeded(workspaceId, sorted).items;
        }
      }
    }
  } catch {
    // Ignore malformed JSON
  }
  markInventoryCatalogV2Ready(workspaceId);
  const seed = INITIAL_INVENTORY_ITEMS.map((item) => ({ ...item }));
  saveLocalInventory(workspaceId, seed);
  return seed;
}

export function mergeInventoryItems(
  workspaceId: string,
  localList: InventoryItem[],
  remoteList: InventoryItem[]
): InventoryItem[] {
  const deleted = loadDeletedInventoryIds(workspaceId);
  const byId = new Map<string, InventoryItem>();

  localList.forEach((loc, idx) => {
    const norm = normalizeInventoryItem(loc, idx);
    if (norm && !deleted.has(norm.id)) {
      byId.set(norm.id, norm);
    }
  });

  remoteList.forEach((rem, idx) => {
    const norm = normalizeInventoryItem(rem, idx);
    if (!norm || deleted.has(norm.id)) return;
    const prev = byId.get(norm.id);
    if (
      !prev ||
      new Date(norm.updatedAt).getTime() >= new Date(prev.updatedAt).getTime()
    ) {
      byId.set(norm.id, norm);
    }
  });

  const merged = Array.from(byId.values()).sort(
    (a, b) => a.sortIndex - b.sortIndex
  );
  return upgradeInventoryCatalogIfNeeded(workspaceId, merged).items;
}

export function getInventoryAlerts(items: InventoryItem[]): InventoryAlert[] {
  return items
    .filter((item) => item.quantity <= item.minThreshold)
    .map((item) => {
      const isOutOfStock = item.quantity <= 0;
      const safePack = Math.max(1, item.packSize);
      const targetStock =
        item.minThreshold >= safePack
          ? Math.ceil((item.minThreshold + 1) / safePack) * safePack
          : safePack;
      const missingQuantity = Math.max(1, targetStock - item.quantity);
      const orderQuantity = Math.max(1, Math.ceil(missingQuantity / safePack));
      const cleanPackLabel = getCleanPackLabel(item.packLabel);
      const isOtherMaterial = isOtherMaterialItem(item);

      const isTape = isTapeMaterialName(item.name);
      const packWordMatch = cleanPackLabel.match(
        /(?:^|\s)(xấp|sấp|cây|cuộn|kiện|hộp|thùng|lốc|bó)(?=\s|$|[.,;)])/i
      );
      const orderUnitLabel = isTape
        ? 'cây'
        : packWordMatch
          ? packWordMatch[1].toLowerCase() === 'sấp'
            ? 'xấp'
            : packWordMatch[1].toLowerCase()
          : safePack > 1
            ? 'xấp'
            : item.unit.toLowerCase();

      const unitLower = isTape ? 'cây' : item.unit.toLowerCase();
      const packInfo = cleanPackLabel ? ` (${cleanPackLabel})` : '';
      const orderSummaryLine = `${item.name}: Đặt ${orderQuantity} ${orderUnitLabel} (thiếu ${missingQuantity} ${unitLower}${cleanPackLabel ? ` · ${cleanPackLabel}` : ''})`;
      const message = isOutOfStock
        ? `Đã hết ${item.name} (kho còn 0 ${unitLower}, thiếu ${missingQuantity} ${unitLower}) → Cần đặt: ${orderQuantity} ${orderUnitLabel}${packInfo}.`
        : `Sắp hết ${item.name} (còn ${item.quantity} ${unitLower}, thiếu ${missingQuantity} ${unitLower}) → Cần đặt: ${orderQuantity} ${orderUnitLabel}${packInfo}.`;

      return {
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        quantity: item.quantity,
        minThreshold: item.minThreshold,
        packSize: item.packSize,
        packLabel: item.packLabel,
        cleanPackLabel,
        missingQuantity,
        orderQuantity,
        orderUnitLabel,
        orderSummaryLine,
        isOtherMaterial,
        isOutOfStock,
        message,
        updatedAt: item.updatedAt,
      };
    })
    .sort((a, b) => {
      if (a.isOutOfStock !== b.isOutOfStock) {
        return a.isOutOfStock ? -1 : 1;
      }
      return a.quantity - b.quantity;
    });
}

export async function upsertInventoryItemToCloud(
  session: AccountSession,
  item: InventoryItem
): Promise<void> {
  const normalized = normalizeInventoryItem(item, item.sortIndex);
  if (!normalized) return;

  // 1. Primary Path: Same-origin server relay
  try {
    await apiUpsertWorkspaceInventoryItem(session, normalized);
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
  const docPath = `workspaces/${session.workspaceId}/inventory/${normalized.id}`;
  const docRef = doc(
    db,
    'workspaces',
    session.workspaceId,
    'inventory',
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
    name: normalized.name,
    unit: normalized.unit,
    quantity: normalized.quantity,
    minThreshold: normalized.minThreshold,
    packSize: normalized.packSize,
    packLabel: normalized.packLabel,
    sortIndex: normalized.sortIndex,
  };

  try {
    if (!existsOnServer) {
      await setDoc(docRef, {
        workspaceId: session.workspaceId,
        accountUsername: session.usernameKey,
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

export async function deleteInventoryItemFromCloud(
  session: AccountSession,
  itemId: string
): Promise<void> {
  const safeId = sanitizeSafeId(itemId, 'inv');

  // 1. Primary Path: Same-origin server relay
  try {
    await apiDeleteWorkspaceInventoryItem(session, safeId);
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
  const docPath = `workspaces/${session.workspaceId}/inventory/${safeId}`;
  const docRef = doc(db, 'workspaces', session.workspaceId, 'inventory', safeId);

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

export async function syncFullInventoryToCloud(
  session: AccountSession,
  items: InventoryItem[]
): Promise<void> {
  const normalizedList: InventoryItem[] = [];
  items.slice(0, MAX_INVENTORY_ITEMS).forEach((entry, idx) => {
    const norm = normalizeInventoryItem({ ...entry, sortIndex: idx }, idx);
    if (norm) normalizedList.push(norm);
  });

  // 1. Primary Path: Same-origin server relay
  try {
    await apiSyncWorkspaceInventory(session, normalizedList);
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

  // 2. Fallback Path: Direct Client Firestore chunked batches
  const colPath = `workspaces/${session.workspaceId}/inventory`;
  const invCol = collection(db, 'workspaces', session.workspaceId, 'inventory');

  let existingIds = new Set<string>();
  try {
    const existingSnap = await getDocs(
      query(invCol, where('workspaceId', '==', session.workspaceId))
    );
    existingIds = new Set(existingSnap.docs.map((d) => d.id));
  } catch (error) {
    const info = inspectFirestoreError(error);
    if (info.isQuotaExceeded || info.isOfflineOrNetwork) {
      return;
    }
    handleFirestoreError(error, OperationType.LIST, colPath);
  }

  const incomingIds = new Set<string>(normalizedList.map((i) => i.id));

  try {
    for (
      let offset = 0;
      offset < normalizedList.length;
      offset += SAFE_BATCH_CHUNK
    ) {
      const chunk = normalizedList.slice(offset, offset + SAFE_BATCH_CHUNK);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const itemRef = doc(
          db,
          'workspaces',
          session.workspaceId,
          'inventory',
          item.id
        );
        const mutableFields = {
          name: item.name,
          unit: item.unit,
          quantity: item.quantity,
          minThreshold: item.minThreshold,
          packSize: item.packSize,
          packLabel: item.packLabel,
          sortIndex: item.sortIndex,
        };
        if (existingIds.has(item.id)) {
          batch.update(itemRef, {
            ...mutableFields,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(itemRef, {
            workspaceId: session.workspaceId,
            accountUsername: session.usernameKey,
            ...mutableFields,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();
    }

    const obsoleteIds = Array.from(existingIds).filter(
      (oldId) => !incomingIds.has(oldId)
    );
    for (
      let offset = 0;
      offset < obsoleteIds.length;
      offset += SAFE_BATCH_CHUNK
    ) {
      const chunk = obsoleteIds.slice(offset, offset + SAFE_BATCH_CHUNK);
      const delBatch = writeBatch(db);
      for (const oldId of chunk) {
        delBatch.delete(
          doc(db, 'workspaces', session.workspaceId, 'inventory', oldId)
        );
      }
      await delBatch.commit();
    }
  } catch (error) {
    const info = inspectFirestoreError(error);
    if (info.isQuotaExceeded || info.isOfflineOrNetwork) {
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, colPath);
  }
}

export function subscribeToInventory(
  session: AccountSession,
  onReceive: (items: InventoryItem[]) => void
): () => void {
  const colPath = `workspaces/${session.workspaceId}/inventory`;
  const q = query(
    collection(db, 'workspaces', session.workspaceId, 'inventory'),
    where('workspaceId', '==', session.workspaceId)
  );
  let seededInitial = false;
  let migratedCloudV2 = false;

  return onSnapshot(
    q,
    (snap) => {
      if (!snap.empty) {
        const fallbackNow = new Date().toISOString();
        const rawHasLegacy = snap.docs.some((d) => LEGACY_V1_SET.has(d.id));
        const deleted = loadDeletedInventoryIds(session.workspaceId);
        const received: InventoryItem[] = [];
        snap.docs.forEach((d, idx) => {
          if (deleted.has(d.id) || LEGACY_V1_SET.has(d.id)) return;
          const data = d.data();
          const norm = normalizeInventoryItem(
            {
              id: d.id,
              name: String(data.name || ''),
              unit: String(data.unit || 'Tấm'),
              quantity: Number(data.quantity) || 0,
              minThreshold: Number(data.minThreshold) || 0,
              packSize: Number(data.packSize) || 1,
              packLabel: String(data.packLabel || ''),
              sortIndex: Number(data.sortIndex ?? idx),
              createdAt: timestampToISO(data.createdAt, fallbackNow),
              updatedAt: timestampToISO(data.updatedAt, fallbackNow),
            },
            idx
          );
          if (norm) received.push(norm);
        });
        const sorted = received.sort((a, b) => a.sortIndex - b.sortIndex);
        if (rawHasLegacy) {
          const localItems = loadLocalInventory(session.workspaceId);
          const merged = mergeInventoryItems(
            session.workspaceId,
            localItems,
            sorted
          );
          if (!migratedCloudV2) {
            migratedCloudV2 = true;
            void syncFullInventoryToCloud(session, merged);
          }
          onReceive(merged);
          return;
        }
        const upg = upgradeInventoryCatalogIfNeeded(
          session.workspaceId,
          sorted
        );
        if (upg.needsCloudSync && !migratedCloudV2) {
          migratedCloudV2 = true;
          void syncFullInventoryToCloud(session, upg.items);
        }
        onReceive(upg.items);
      } else if (!snap.metadata.fromCache && !seededInitial) {
        seededInitial = true;
        const initial = loadLocalInventory(session.workspaceId);
        void syncFullInventoryToCloud(session, initial);
      }
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

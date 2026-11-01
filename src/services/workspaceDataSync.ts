import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  DEFAULT_FOOTER_NOTE,
  INITIAL_PRODUCTS,
  INITIAL_STORE_SETTINGS,
  LEGACY_FOOTER_NOTE,
  PREVIOUS_FOOTER_NOTE,
} from '../data/initialData';
import {
  db,
  handleFirestoreError,
  inspectFirestoreError,
  OperationType,
} from '../firebase';
import { AccountSession, Product, StoreSettings } from '../types';
import {
  apiSyncWorkspaceProducts,
  apiUpsertWorkspaceSettings,
  CloudRelayError,
} from './cloudApiClient';
import { sanitizeSafeId } from './invoiceStorage';

const MAX_MONEY = 10_000_000_000;
const MAX_PRODUCTS = 500;
const SAFE_BATCH_CHUNK = 8;

function wsKeyPrefix(workspaceId: string): string {
  return `atdcolor_ws_${workspaceId.slice(0, 27)}`;
}

export function getWorkspaceSettingsStorageKey(workspaceId: string): string {
  return `${wsKeyPrefix(workspaceId)}_settings`;
}

export function areStoreSettingsEqual(
  a: StoreSettings,
  b: StoreSettings
): boolean {
  return (
    a.companyName === b.companyName &&
    a.address === b.address &&
    a.phone === b.phone &&
    a.email === b.email &&
    a.tiktok === b.tiktok &&
    a.preparerName === b.preparerName &&
    a.invoiceTitle === b.invoiceTitle &&
    a.footerNote === b.footerNote &&
    a.showCalculator === b.showCalculator &&
    a.showAiChat === b.showAiChat &&
    a.logoVersion === b.logoVersion &&
    a.signatureVersion === b.signatureVersion
  );
}

function clampMoney(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.min(MAX_MONEY, Math.max(0, Math.round(val))) + 0;
}

function clampInt(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, Math.trunc(val))) + 0;
}

export function normalizeStoreSettings(
  raw?: Partial<StoreSettings>
): StoreSettings {
  const base = { ...INITIAL_STORE_SETTINGS, ...(raw || {}) };
  const nextTitle =
    !base.invoiceTitle || base.invoiceTitle.trim() === 'HÓA ĐƠN THAM KHẢO'
      ? 'PHIẾU ĐẶT HÀNG'
      : base.invoiceTitle.trim();

  const normalizedStoredNote = (base.footerNote || '')
    .replace(/\r\n/g, '\n')
    .trim();
  const shouldMigrateFooterNote =
    !normalizedStoredNote ||
    normalizedStoredNote === LEGACY_FOOTER_NOTE ||
    normalizedStoredNote === PREVIOUS_FOOTER_NOTE.trim() ||
    normalizedStoredNote.startsWith(LEGACY_FOOTER_NOTE);

  const nextFooterNote = shouldMigrateFooterNote
    ? DEFAULT_FOOTER_NOTE
    : base.footerNote;

  const rawLogoVersion =
    typeof base.logoVersion === 'string' ? base.logoVersion.trim() : '';
  const safeLogoVersion = /^[a-zA-Z0-9_-]*$/.test(rawLogoVersion)
    ? rawLogoVersion.slice(0, 40)
    : '';

  const rawSignatureVersion =
    typeof base.signatureVersion === 'string'
      ? base.signatureVersion.trim()
      : '';
  const safeSignatureVersion = /^[a-zA-Z0-9_-]*$/.test(rawSignatureVersion)
    ? rawSignatureVersion.slice(0, 40)
    : '';

  return {
    companyName: (base.companyName?.trim() || 'ATD Color').slice(0, 120),
    address: (base.address || '').trim().slice(0, 250),
    phone: (base.phone || '').trim().slice(0, 40),
    email: (base.email || '').trim().slice(0, 120),
    tiktok: (base.tiktok || '').trim().slice(0, 80),
    preparerName: (base.preparerName || '').trim().slice(0, 120),
    invoiceTitle: (nextTitle || 'PHIẾU ĐẶT HÀNG').slice(0, 120),
    footerNote: (nextFooterNote || '').slice(0, 3000),
    showCalculator:
      typeof base.showCalculator === 'boolean' ? base.showCalculator : true,
    showAiChat:
      typeof base.showAiChat === 'boolean' ? base.showAiChat : true,
    logoVersion: safeLogoVersion,
    signatureVersion: safeSignatureVersion,
  };
}

export function loadLocalWorkspaceSettings(workspaceId: string): StoreSettings {
  try {
    const raw = localStorage.getItem(
      getWorkspaceSettingsStorageKey(workspaceId)
    );
    if (raw) {
      return normalizeStoreSettings(JSON.parse(raw) as Partial<StoreSettings>);
    }
  } catch {
    // Ignore malformed JSON
  }
  return normalizeStoreSettings(INITIAL_STORE_SETTINGS);
}

export function saveLocalWorkspaceSettings(
  workspaceId: string,
  settings: StoreSettings
): void {
  try {
    localStorage.setItem(
      getWorkspaceSettingsStorageKey(workspaceId),
      JSON.stringify(normalizeStoreSettings(settings))
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function loadLocalWorkspaceProducts(workspaceId: string): Product[] {
  try {
    const raw = localStorage.getItem(`${wsKeyPrefix(workspaceId)}_products`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((p, idx) => ({
          id: sanitizeSafeId(String(p.id || `prod-${idx}`), `prod-${idx}`),
          code: String(p.code || `SP-${idx + 1}`).slice(0, 40),
          name: String(p.name || 'Sản phẩm').slice(0, 200),
          category: String(p.category || 'Khác').slice(0, 120),
          sides:
            typeof p.sides === 'string' && p.sides
              ? p.sides.slice(0, 40)
              : undefined,
          size:
            typeof p.size === 'string' && p.size
              ? p.size.slice(0, 60)
              : undefined,
          unit: String(p.unit || 'Tờ').slice(0, 40),
          price: clampMoney(Number(p.price) || 0),
        }));
      }
    }
  } catch {
    // Ignore malformed JSON
  }
  return INITIAL_PRODUCTS;
}

export function saveLocalWorkspaceProducts(
  workspaceId: string,
  products: Product[]
): void {
  try {
    localStorage.setItem(
      `${wsKeyPrefix(workspaceId)}_products`,
      JSON.stringify(products)
    );
  } catch {
    // Ignore storage quota errors
  }
}

export async function upsertWorkspaceSettingsToCloud(
  session: AccountSession,
  settings: StoreSettings
): Promise<void> {
  const normalized = normalizeStoreSettings(settings);

  // 1. Primary Path: Same-origin server relay
  try {
    await apiUpsertWorkspaceSettings(session, normalized);
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
  const settingsPath = `workspaces/${session.workspaceId}/settings/store`;
  const settingsRef = doc(
    db,
    'workspaces',
    session.workspaceId,
    'settings',
    'store'
  );

  let existsOnServer = false;
  try {
    const snap = await getDoc(settingsRef);
    existsOnServer = snap.exists();
  } catch (error) {
    const info = inspectFirestoreError(error);
    if (info.isQuotaExceeded || info.isOfflineOrNetwork) {
      return;
    }
    handleFirestoreError(error, OperationType.GET, settingsPath);
  }

  const mutablePayload = {
    companyName: normalized.companyName,
    address: normalized.address,
    phone: normalized.phone,
    email: normalized.email,
    tiktok: normalized.tiktok,
    preparerName: normalized.preparerName,
    invoiceTitle: normalized.invoiceTitle,
    footerNote: normalized.footerNote,
    showCalculator: normalized.showCalculator,
    showAiChat: normalized.showAiChat,
    logoVersion: normalized.logoVersion,
    signatureVersion: normalized.signatureVersion,
  };

  try {
    if (!existsOnServer) {
      await setDoc(settingsRef, {
        workspaceId: session.workspaceId,
        accountUsername: session.usernameKey,
        ...mutablePayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(settingsRef, {
        ...mutablePayload,
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
      settingsPath
    );
  }
}

export function subscribeToWorkspaceSettings(
  session: AccountSession,
  onReceive: (settings: StoreSettings) => void
): () => void {
  const settingsPath = `workspaces/${session.workspaceId}/settings/store`;
  const settingsRef = doc(
    db,
    'workspaces',
    session.workspaceId,
    'settings',
    'store'
  );
  let seededInitial = false;

  return onSnapshot(
    settingsRef,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const received = normalizeStoreSettings({
          companyName: String(data.companyName || 'ATD Color'),
          address: String(data.address || ''),
          phone: String(data.phone || ''),
          email: String(data.email || ''),
          tiktok: String(data.tiktok || ''),
          preparerName: String(data.preparerName || ''),
          invoiceTitle: String(data.invoiceTitle || 'PHIẾU ĐẶT HÀNG'),
          footerNote: String(data.footerNote || DEFAULT_FOOTER_NOTE),
          showCalculator:
            typeof data.showCalculator === 'boolean'
              ? data.showCalculator
              : true,
          showAiChat:
            typeof data.showAiChat === 'boolean' ? data.showAiChat : true,
          logoVersion:
            typeof data.logoVersion === 'string' ? data.logoVersion : '',
          signatureVersion:
            typeof data.signatureVersion === 'string'
              ? data.signatureVersion
              : '',
        });
        saveLocalWorkspaceSettings(session.workspaceId, received);
        onReceive(received);
      } else if (!snap.metadata.fromCache && !seededInitial) {
        seededInitial = true;
        const initial = loadLocalWorkspaceSettings(session.workspaceId);
        void upsertWorkspaceSettingsToCloud(session, initial);
      }
    },
    (error) => {
      const info = inspectFirestoreError(error);
      if (info.isQuotaExceeded || info.isOfflineOrNetwork) {
        return;
      }
      handleFirestoreError(error, OperationType.GET, settingsPath);
    }
  );
}

export async function syncFullWorkspaceCatalogToCloud(
  session: AccountSession,
  products: Product[]
): Promise<void> {
  // 1. Primary Path: Same-origin server relay
  try {
    await apiSyncWorkspaceProducts(session, products);
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

  // 2. Fallback Path: Direct Client Firestore with safe <= 8-product batch chunking
  const productsColPath = `workspaces/${session.workspaceId}/products`;
  const productsCol = collection(
    db,
    'workspaces',
    session.workspaceId,
    'products'
  );

  let existingIds = new Set<string>();
  try {
    const existingSnap = await getDocs(
      query(productsCol, where('workspaceId', '==', session.workspaceId))
    );
    existingIds = new Set(existingSnap.docs.map((d) => d.id));
  } catch (error) {
    const info = inspectFirestoreError(error);
    if (info.isQuotaExceeded || info.isOfflineOrNetwork) {
      return;
    }
    handleFirestoreError(error, OperationType.LIST, productsColPath);
  }

  const bounded = products.slice(0, MAX_PRODUCTS);
  const incomingIds = new Set<string>();

  try {
    const ops = bounded.map((prod, idx) => {
      const safeId = sanitizeSafeId(prod.id, `prod-${idx}`);
      incomingIds.add(safeId);
      return {
        safeId,
        mutableFields: {
          code: (prod.code.trim() || `SP-${idx + 1}`).slice(0, 40),
          name: (prod.name.trim() || 'Sản phẩm').slice(0, 200),
          category: (prod.category.trim() || 'Khác').slice(0, 120),
          sides: (prod.sides || '').trim().slice(0, 40),
          size: (prod.size || '').trim().slice(0, 60),
          unit: (prod.unit.trim() || 'Tờ').slice(0, 40),
          price: clampMoney(prod.price),
          sortIndex: clampInt(idx, 0, MAX_PRODUCTS),
        },
      };
    });

    for (let offset = 0; offset < ops.length; offset += SAFE_BATCH_CHUNK) {
      const chunk = ops.slice(offset, offset + SAFE_BATCH_CHUNK);
      const batch = writeBatch(db);
      for (const op of chunk) {
        const prodRef = doc(
          db,
          'workspaces',
          session.workspaceId,
          'products',
          op.safeId
        );
        if (existingIds.has(op.safeId)) {
          batch.update(prodRef, {
            ...op.mutableFields,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(prodRef, {
            workspaceId: session.workspaceId,
            accountUsername: session.usernameKey,
            ...op.mutableFields,
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
          doc(db, 'workspaces', session.workspaceId, 'products', oldId)
        );
      }
      await delBatch.commit();
    }
  } catch (error) {
    const info = inspectFirestoreError(error);
    if (info.isQuotaExceeded || info.isOfflineOrNetwork) {
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, productsColPath);
  }
}

export function subscribeToWorkspaceProducts(
  session: AccountSession,
  onReceive: (products: Product[]) => void
): () => void {
  const productsColPath = `workspaces/${session.workspaceId}/products`;
  const productsQuery = query(
    collection(db, 'workspaces', session.workspaceId, 'products'),
    where('workspaceId', '==', session.workspaceId)
  );
  let seededInitial = false;

  return onSnapshot(
    productsQuery,
    (snap) => {
      if (!snap.empty) {
        const rawList = snap.docs
          .map((d) => {
            const data = d.data();
            const sidesStr = String(data.sides || '').trim();
            const sizeStr = String(data.size || '').trim();
            return {
              id: d.id,
              code: String(data.code || d.id),
              name: String(data.name || 'Sản phẩm'),
              category: String(data.category || 'Khác'),
              sides: sidesStr || undefined,
              size: sizeStr || undefined,
              unit: String(data.unit || 'Tờ'),
              price: Number(data.price) || 0,
              sortIndex: Number(data.sortIndex) || 0,
            };
          })
          .sort((a, b) => a.sortIndex - b.sortIndex);

        const cleaned: Product[] = rawList.map(
          ({ sortIndex: _s, ...rest }) => rest
        );
        saveLocalWorkspaceProducts(session.workspaceId, cleaned);
        onReceive(cleaned);
      } else if (!snap.metadata.fromCache && !seededInitial) {
        seededInitial = true;
        const initial = loadLocalWorkspaceProducts(session.workspaceId);
        void syncFullWorkspaceCatalogToCloud(session, initial);
      }
    },
    (error) => {
      const info = inspectFirestoreError(error);
      if (info.isQuotaExceeded || info.isOfflineOrNetwork) {
        return;
      }
      handleFirestoreError(error, OperationType.LIST, productsColPath);
    }
  );
}

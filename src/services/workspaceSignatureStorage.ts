export interface WorkspaceSignatureRecord {
  version: string;
  dataUrl: string;
  updatedAt: string;
}

const IDB_NAME = 'atdcolor_workspace_signature_db';
const IDB_STORE = 'workspace_signatures';
const IDB_VERSION = 1;

const MAX_UPLOAD_FILE_BYTES = 15 * 1024 * 1024; // 15 MB max input file
const KEEP_ORIGINAL_MAX_BYTES = 1_400_000; // ~1.4 MB untouched byte-for-byte threshold
const KEEP_ORIGINAL_MAX_DIM = 1600;
const RESIZE_MAX_DIM = 1200;

export function getWorkspaceSignatureStorageKey(workspaceId: string): string {
  return `atdcolor_ws_${workspaceId.slice(0, 27)}_signature`;
}

function openSignatureIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function loadLocalWorkspaceSignatureSync(
  workspaceId: string
): WorkspaceSignatureRecord | null {
  try {
    const raw = localStorage.getItem(
      getWorkspaceSignatureStorageKey(workspaceId)
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkspaceSignatureRecord>;
    if (
      typeof parsed.version === 'string' &&
      parsed.version &&
      typeof parsed.dataUrl === 'string' &&
      parsed.dataUrl.startsWith('data:image/')
    ) {
      return {
        version: parsed.version,
        dataUrl: parsed.dataUrl,
        updatedAt:
          typeof parsed.updatedAt === 'string'
            ? parsed.updatedAt
            : new Date().toISOString(),
      };
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

export async function loadLocalWorkspaceSignatureAsync(
  workspaceId: string
): Promise<WorkspaceSignatureRecord | null> {
  const syncCopy = loadLocalWorkspaceSignatureSync(workspaceId);
  if (syncCopy) return syncCopy;

  const db = await openSignatureIdb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(workspaceId);
      req.onsuccess = () => {
        const val = req.result as Partial<WorkspaceSignatureRecord> | undefined;
        if (
          val &&
          typeof val.version === 'string' &&
          val.version &&
          typeof val.dataUrl === 'string' &&
          val.dataUrl.startsWith('data:image/')
        ) {
          resolve({
            version: val.version,
            dataUrl: val.dataUrl,
            updatedAt:
              typeof val.updatedAt === 'string'
                ? val.updatedAt
                : new Date().toISOString(),
          });
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveLocalWorkspaceSignature(
  workspaceId: string,
  version: string,
  dataUrl: string
): Promise<void> {
  const record: WorkspaceSignatureRecord = {
    version,
    dataUrl,
    updatedAt: new Date().toISOString(),
  };

  const key = getWorkspaceSignatureStorageKey(workspaceId);
  try {
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // If dataUrl exceeds localStorage 5MB quota, write lightweight cross-tab marker
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          version,
          idbOnly: true,
          updatedAt: record.updatedAt,
        })
      );
    } catch {
      // Ignore quota errors
    }
  }

  const db = await openSignatureIdb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(record, workspaceId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearLocalWorkspaceSignature(
  workspaceId: string
): Promise<void> {
  try {
    localStorage.removeItem(getWorkspaceSignatureStorageKey(workspaceId));
  } catch {
    // Ignore
  }

  const db = await openSignatureIdb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(workspaceId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Không thể đọc tệp ảnh chữ ký.'));
      }
    };
    reader.onerror = () => reject(new Error('Lỗi khi đọc tệp ảnh chữ ký.'));
    reader.readAsDataURL(file);
  });
}

function decodeImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve(img);
      } else {
        reject(new Error('Ảnh chữ ký không hợp lệ hoặc bị hỏng.'));
      }
    };
    img.onerror = () =>
      reject(
        new Error(
          'Không thể giải mã ảnh chữ ký. Vui lòng chọn ảnh PNG, JPG, WebP hoặc SVG.'
        )
      );
    img.src = src;
  });
}

/**
 * Processes an uploaded preparer signature file ("ảnh chữ ký"):
 * - Keeps original PNG/WebP/JPEG byte-for-byte when <= 1.4MB and <= 1600px.
 * - Otherwise renders at high-DPI (up to 1200px) onto a lossless transparent PNG
 *   so alpha transparency and signature ink strokes remain crisp.
 */
export async function processSignatureImageFile(
  file: File
): Promise<{ version: string; dataUrl: string }> {
  const isImageMime = file.type.startsWith('image/');
  const hasImageExt = /\.(png|jpe?g|webp|svg|gif|bmp)$/i.test(file.name);
  if (!isImageMime && !hasImageExt) {
    throw new Error(
      'Vui lòng chọn tệp ảnh chữ ký hợp lệ (PNG, JPG, WebP hoặc SVG).'
    );
  }

  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    throw new Error('Dung lượng ảnh chữ ký quá lớn (tối đa 15MB).');
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await decodeImageElement(rawDataUrl);

  const version = `sg_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8)}`;

  const isDirectRaster =
    file.type === 'image/png' ||
    file.type === 'image/webp' ||
    file.type === 'image/jpeg';

  if (
    isDirectRaster &&
    file.size <= KEEP_ORIGINAL_MAX_BYTES &&
    Math.max(img.naturalWidth, img.naturalHeight) <= KEEP_ORIGINAL_MAX_DIM &&
    rawDataUrl.startsWith('data:image/')
  ) {
    return { version, dataUrl: rawDataUrl };
  }

  const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = maxSide > RESIZE_MAX_DIM ? RESIZE_MAX_DIM / maxSide : 1;
  const targetW = Math.max(1, Math.round(img.naturalWidth * scale));
  const targetH = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { version, dataUrl: rawDataUrl };
  }

  ctx.clearRect(0, 0, targetW, targetH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const losslessPngDataUrl = canvas.toDataURL('image/png');
  return { version, dataUrl: losslessPngDataUrl };
}

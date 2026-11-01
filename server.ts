import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { getApps, initializeApp } from 'firebase/app';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

interface QuoteItemPayload {
  id: string;
  productId?: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  note?: string;
}

interface SavedInvoicePayload {
  id: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  expectedDemoDate: string;
  customer: {
    name: string;
    code: string;
    phone: string;
  };
  items: QuoteItemPayload[];
  discountAmount: number;
  shippingFee: number;
  depositAmount: number;
  designIllustration: string;
  invoiceNote: string;
  reportStage?: string;
  remainingPaid?: boolean;
  remainingPaidAt?: string;
  totals: {
    subtotal: number;
    discountAmount: number;
    shippingFee: number;
    depositAmount: number;
    remainingAmount: number;
    totalQuantity: number;
  };
  syncedToCloud?: boolean;
  syncedOwnerUid?: string;
}

interface StoreSettingsPayload {
  companyName: string;
  address: string;
  phone: string;
  email: string;
  tiktok: string;
  preparerName: string;
  invoiceTitle: string;
  footerNote: string;
  showCalculator: boolean;
  showAiChat: boolean;
  logoVersion: string;
  signatureVersion: string;
}

interface ProductPayload {
  id: string;
  code: string;
  name: string;
  category: string;
  sides?: string;
  size?: string;
  unit: string;
  price: number;
}

interface VoucherBudgetPayload {
  monthKey: string;
  budgetAmount: number;
  note: string;
  updatedAt: string;
}

interface CustomerContactPayload {
  id: string;
  name: string;
  phone: string;
  customerDate: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface InventoryItemPayload {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  minThreshold: number;
  packSize: number;
  packLabel: string;
  sortIndex: number;
  createdAt: string;
  updatedAt: string;
}

interface RevenueEntryPayload {
  id: string;
  invoiceId: string;
  invoiceCode: string;
  orderDate: string;
  monthKey: string;
  customerName: string;
  customerPhone: string;
  customerCode: string;
  designAmount: number;
  printAmount: number;
  totalRevenue: number;
  isManualOverride: boolean;
  isDeleted: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
}

const rootDir = process.cwd();
const rawConfig = fs.readFileSync(
  path.join(rootDir, 'firebase-applet-config.json'),
  'utf8'
);
const firebaseConfig = JSON.parse(rawConfig) as FirebaseAppletConfig;

const firebaseApp =
  getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const serverDb = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

// Schema validation constants strictly matching firebase-blueprint.json & firestore.rules
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const OPTIONAL_INVOICE_ID_PATTERN = /^[a-zA-Z0-9_-]{0,128}$/;
const USERNAME_KEY_PATTERN = /^[a-z0-9_-]{3,40}$/;
const WORKSPACE_ID_PATTERN = /^ws_[a-f0-9]{64}$/;
const HEX64_PATTERN = /^[a-f0-9]{64}$/;
const LOGO_VERSION_PATTERN = /^[a-zA-Z0-9_-]{0,40}$/;
const SIGNATURE_VERSION_PATTERN = /^[a-zA-Z0-9_-]{0,40}$/;
const MONTH_KEY_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const ORDER_DATE_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const MAX_LOGO_DATA_URL_LEN = 6_500_000;
const MAX_SIGNATURE_DATA_URL_LEN = 6_500_000;

function sanitizeOptionalServerOrderDate(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const m = trimmed.match(
    /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/
  );
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const maxDay = new Date(year, month, 0).getDate();
  const safeDay = String(Math.min(day, maxDay)).padStart(2, '0');
  return `${m[1]}-${m[2]}-${safeDay}`;
}

interface StoredWorkspaceLogo {
  version: string;
  dataUrl: string;
  updatedAt: string;
}

const logosDir = path.join(rootDir, '.data', 'logos');
const memoryLogoCache = new Map<string, StoredWorkspaceLogo | null>();

function getWorkspaceLogoFilePath(workspaceId: string): string {
  return path.join(logosDir, `${workspaceId}.json`);
}

function readStoredWorkspaceLogo(
  workspaceId: string
): StoredWorkspaceLogo | null {
  if (memoryLogoCache.has(workspaceId)) {
    return memoryLogoCache.get(workspaceId) || null;
  }
  try {
    const filePath = getWorkspaceLogoFilePath(workspaceId);
    if (!fs.existsSync(filePath)) {
      memoryLogoCache.set(workspaceId, null);
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredWorkspaceLogo>;
    if (
      typeof parsed.version === 'string' &&
      LOGO_VERSION_PATTERN.test(parsed.version) &&
      typeof parsed.dataUrl === 'string' &&
      parsed.dataUrl.startsWith('data:image/') &&
      parsed.dataUrl.length <= MAX_LOGO_DATA_URL_LEN
    ) {
      const record: StoredWorkspaceLogo = {
        version: parsed.version,
        dataUrl: parsed.dataUrl,
        updatedAt:
          typeof parsed.updatedAt === 'string'
            ? parsed.updatedAt
            : new Date().toISOString(),
      };
      memoryLogoCache.set(workspaceId, record);
      return record;
    }
  } catch (err) {
    console.error('Failed reading stored workspace logo:', err);
  }
  memoryLogoCache.set(workspaceId, null);
  return null;
}

function writeStoredWorkspaceLogo(
  workspaceId: string,
  version: string,
  dataUrl: string
): StoredWorkspaceLogo {
  const record: StoredWorkspaceLogo = {
    version,
    dataUrl,
    updatedAt: new Date().toISOString(),
  };
  memoryLogoCache.set(workspaceId, record);
  try {
    fs.mkdirSync(logosDir, { recursive: true });
    const filePath = getWorkspaceLogoFilePath(workspaceId);
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(record), 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('Failed persisting workspace logo to disk:', err);
  }
  return record;
}

function removeStoredWorkspaceLogo(workspaceId: string): void {
  memoryLogoCache.set(workspaceId, null);
  try {
    const filePath = getWorkspaceLogoFilePath(workspaceId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('Failed deleting workspace logo file:', err);
  }
}

interface StoredWorkspaceSignature {
  version: string;
  dataUrl: string;
  updatedAt: string;
}

const signaturesDir = path.join(rootDir, '.data', 'signatures');
const memorySignatureCache = new Map<string, StoredWorkspaceSignature | null>();

function getWorkspaceSignatureFilePath(workspaceId: string): string {
  return path.join(signaturesDir, `${workspaceId}.json`);
}

function readStoredWorkspaceSignature(
  workspaceId: string
): StoredWorkspaceSignature | null {
  if (memorySignatureCache.has(workspaceId)) {
    return memorySignatureCache.get(workspaceId) || null;
  }
  try {
    const filePath = getWorkspaceSignatureFilePath(workspaceId);
    if (!fs.existsSync(filePath)) {
      memorySignatureCache.set(workspaceId, null);
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredWorkspaceSignature>;
    if (
      typeof parsed.version === 'string' &&
      SIGNATURE_VERSION_PATTERN.test(parsed.version) &&
      typeof parsed.dataUrl === 'string' &&
      parsed.dataUrl.startsWith('data:image/') &&
      parsed.dataUrl.length <= MAX_SIGNATURE_DATA_URL_LEN
    ) {
      const record: StoredWorkspaceSignature = {
        version: parsed.version,
        dataUrl: parsed.dataUrl,
        updatedAt:
          typeof parsed.updatedAt === 'string'
            ? parsed.updatedAt
            : new Date().toISOString(),
      };
      memorySignatureCache.set(workspaceId, record);
      return record;
    }
  } catch (err) {
    console.error('Failed reading stored workspace signature:', err);
  }
  memorySignatureCache.set(workspaceId, null);
  return null;
}

function writeStoredWorkspaceSignature(
  workspaceId: string,
  version: string,
  dataUrl: string
): StoredWorkspaceSignature {
  const record: StoredWorkspaceSignature = {
    version,
    dataUrl,
    updatedAt: new Date().toISOString(),
  };
  memorySignatureCache.set(workspaceId, record);
  try {
    fs.mkdirSync(signaturesDir, { recursive: true });
    const filePath = getWorkspaceSignatureFilePath(workspaceId);
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(record), 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('Failed persisting workspace signature to disk:', err);
  }
  return record;
}

function removeStoredWorkspaceSignature(workspaceId: string): void {
  memorySignatureCache.set(workspaceId, null);
  try {
    const filePath = getWorkspaceSignatureFilePath(workspaceId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('Failed deleting workspace signature file:', err);
  }
}

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
const MAX_PRODUCTS = 500;
const MAX_QTY = 100_000;
const MAX_MONEY = 10_000_000_000;
const VALID_REPORT_STAGES = new Set<string>([
  '',
  'bao_gia',
  'cham_soc',
  'coc',
  'chot_in',
  'chot_thiet_ke',
  'hoan_thanh',
]);

function sanitizeReportStage(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return VALID_REPORT_STAGES.has(trimmed) ? trimmed : '';
}

// Stay well below Firestore Security Rules' 20 get()/exists()/getAfter()/existsAfter() batch limit
const SAFE_BATCH_CHUNK = 8;

function sanitizeSafeId(raw: string, fallbackPrefix = 'inv'): string {
  const cleaned = String(raw || '')
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
  return Math.min(max, Math.max(min, Math.trunc(val))) + 0;
}

function clampMoney(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.min(MAX_MONEY, Math.max(0, Math.round(val))) + 0;
}

function computeTotals(
  items: { quantity: number; unitPrice: number }[],
  discountAmount: number,
  shippingFee: number,
  depositAmount: number
) {
  const subtotal = items.reduce((sum, item) => {
    const qty = clampInt(Math.round(Number(item.quantity) || 1), 1, MAX_QTY);
    const price = clampMoney(Number(item.unitPrice) || 0);
    return sum + qty * price;
  }, 0);
  const totalQuantity = items.reduce(
    (sum, item) =>
      sum + clampInt(Math.round(Number(item.quantity) || 1), 1, MAX_QTY),
    0
  );
  const safeDiscount = clampMoney(discountAmount);
  const safeShipping = clampMoney(shippingFee);
  const safeDeposit = clampMoney(depositAmount);
  const remainingAmount = Math.max(
    0,
    Math.round(subtotal - safeDiscount + safeShipping - safeDeposit)
  );
  return {
    subtotal: clampMoney(subtotal),
    discountAmount: safeDiscount,
    shippingFee: safeShipping,
    depositAmount: safeDeposit,
    remainingAmount: clampMoney(remainingAmount),
    totalQuantity: clampInt(totalQuantity, 1, MAX_QTY),
  };
}

function buildItemSummary(
  items: { name: string; quantity: number }[]
): string {
  if (items.length === 0) return 'Hóa đơn tham khảo';
  const joined = items
    .map((item) => `${item.name.trim() || 'Sản phẩm'} (x${item.quantity})`)
    .join(', ');
  const sliced = joined.slice(0, MAX_SUMMARY_LEN).trim();
  return sliced || 'Hóa đơn tham khảo';
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

function formatErrorPayload(error: unknown): {
  status: number;
  code: string;
  message: string;
  projectId: string;
  databaseId: string;
} {
  const rawMsg = error instanceof Error ? error.message : String(error);
  const isQuota =
    rawMsg.includes('Quota exceeded') || rawMsg.includes('resource-exhausted');
  const isDailyReadQuota = rawMsg.includes(
    "Quota exceeded for quota metric 'Free daily read units per project"
  );
  const isPermission =
    rawMsg.includes('PERMISSION_DENIED') ||
    rawMsg.includes('Missing or insufficient permissions');

  if (isDailyReadQuota || isQuota) {
    return {
      status: 429,
      code: isDailyReadQuota ? 'QUOTA_DAILY_READS' : 'QUOTA_EXCEEDED',
      message: rawMsg,
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
    };
  }
  if (isPermission) {
    // Avoid HTTP 403 because container Nginx proxy_intercept_errors maps 403 -> /forbidden.html
    return {
      status: 400,
      code: 'PERMISSION_DENIED',
      message: rawMsg,
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
    };
  }
  // Avoid HTTP 502/503/504 because container Nginx proxy_intercept_errors maps 502/503/504 -> /warmup.html
  return {
    status: 500,
    code: 'FIRESTORE_UNAVAILABLE',
    message: rawMsg,
    projectId: firebaseConfig.projectId,
    databaseId: firebaseConfig.firestoreDatabaseId,
  };
}

// --- Live Server-Side Workspace Mirror (Zero Extra Firestore Reads for Multi-Device Polling) ---

interface WorkspaceLiveMirror {
  workspaceId: string;
  version: number;
  invoicesReady: boolean;
  settingsReady: boolean;
  productsReady: boolean;
  voucherBudgetsReady: boolean;
  customersReady: boolean;
  inventoryReady: boolean;
  revenueEntriesReady: boolean;
  invoices: SavedInvoicePayload[];
  settings: StoreSettingsPayload | null;
  products: ProductPayload[] | null;
  voucherBudgets: VoucherBudgetPayload[];
  customers: CustomerContactPayload[];
  inventory: InventoryItemPayload[] | null;
  revenueEntries: RevenueEntryPayload[];
  lastAccessedAt: number;
  itemsCache: Map<string, { cacheKey: string; items: QuoteItemPayload[] }>;
  readyPromise: Promise<void>;
  dispose: () => void;
}

const activeMirrors = new Map<string, WorkspaceLiveMirror>();
const MIRROR_IDLE_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [wsId, mirror] of activeMirrors.entries()) {
    if (now - mirror.lastAccessedAt > MIRROR_IDLE_TTL_MS) {
      mirror.dispose();
      activeMirrors.delete(wsId);
    }
  }
}, 60 * 1000).unref();

function getOrCreateWorkspaceMirror(workspaceId: string): WorkspaceLiveMirror {
  const existing = activeMirrors.get(workspaceId);
  if (existing) {
    existing.lastAccessedAt = Date.now();
    return existing;
  }

  let resolveInitial!: () => void;
  let settledInitial = false;
  const readyPromise = new Promise<void>((resolve) => {
    resolveInitial = () => {
      if (!settledInitial) {
        settledInitial = true;
        resolve();
      }
    };
  });

  const timeoutHandle = setTimeout(() => {
    resolveInitial();
  }, 5000);
  timeoutHandle.unref?.();

  const mirror: WorkspaceLiveMirror = {
    workspaceId,
    version: 1,
    invoicesReady: false,
    settingsReady: false,
    productsReady: false,
    voucherBudgetsReady: false,
    customersReady: false,
    inventoryReady: false,
    revenueEntriesReady: false,
    invoices: [],
    settings: null,
    products: null,
    voucherBudgets: [],
    customers: [],
    inventory: null,
    revenueEntries: [],
    lastAccessedAt: Date.now(),
    itemsCache: new Map(),
    readyPromise,
    dispose: () => {},
  };

  const healedRevenueEntryIds = new Set<string>();
  const SERVER_DESIGN_CAT_RE = /thiết\s*kế|thiet\s*ke|design/iu;
  const SERVER_PRINT_CAT_RE = /ép\s*nhựa|plastic|formex|decal/iu;
  const SERVER_PRINT_LEADING_RE =
    /^(?:in\s+|ép\s*nhựa|ep\s*nhua|plastic\b|formex\b|foxmex\b|fomex\b|decal\b|cán\s*màng|đóng\s*lò\s*xo|bấm\s*kim)/iu;
  const SERVER_DESIGN_NAME_RE =
    /(?:thiết\s*kế|thiet\s*ke|design|phụ\s*phí\s*chỉnh\s*sửa|phu\s*phi\s*chinh\s*sua|chỉnh\s*sửa\s*file|chinh\s*sua\s*file|sửa\s*file|sua\s*file|vẽ\s*lại|ve\s*lai|vẽ\s*logo|ve\s*logo|phí\s*demo|demo\s*mẫu)/iu;

  const isServerDesignItem = (
    item: QuoteItemPayload,
    productById: Map<string, ProductPayload>
  ): boolean => {
    if (item.productId) {
      const catProd = productById.get(item.productId);
      if (catProd) {
        const cat = (catProd.category || '').trim();
        if (SERVER_DESIGN_CAT_RE.test(cat)) return true;
        if (SERVER_PRINT_CAT_RE.test(cat)) return false;
      }
      if (item.productId.startsWith('tk-')) return true;
      if (item.productId.startsWith('ep-') || item.productId.startsWith('fm-')) {
        return false;
      }
    }
    const nm = (item.name || '').trim();
    if (!nm) return false;
    if (SERVER_PRINT_LEADING_RE.test(nm)) return false;
    return SERVER_DESIGN_NAME_RE.test(nm);
  };

  const healProratedRevenueEntriesIfNeeded = () => {
    if (
      !mirror.invoicesReady ||
      !mirror.productsReady ||
      !mirror.revenueEntriesReady
    ) {
      return;
    }

    const invoiceById = new Map<string, SavedInvoicePayload>();
    for (const inv of mirror.invoices) {
      invoiceById.set(inv.id, inv);
    }
    const productById = new Map<string, ProductPayload>();
    for (const p of mirror.products || []) {
      productById.set(p.id, p);
    }

    let anyHealed = false;
    const nowISO = new Date().toISOString();

    mirror.revenueEntries = mirror.revenueEntries.map((entry) => {
      if (entry.isDeleted || entry.isManualOverride || !entry.invoiceId) {
        return entry;
      }
      const linkedInv = invoiceById.get(entry.invoiceId);
      if (!linkedInv || linkedInv.items.length === 0) {
        return entry;
      }

      let grossDesign = 0;
      let grossPrint = 0;
      let negativeLineAdjust = 0;

      for (const item of linkedInv.items) {
        const qty = Math.max(0, Math.round(Number(item.quantity) || 0));
        const unitPrice = Math.round(Number(item.unitPrice) || 0);
        if (qty <= 0 || unitPrice === 0) continue;
        if (unitPrice < 0) {
          negativeLineAdjust += Math.abs(qty * unitPrice);
          continue;
        }
        const lineAmt = qty * unitPrice;
        if (isServerDesignItem(item, productById)) {
          grossDesign += lineAmt;
        } else {
          grossPrint += lineAmt;
        }
      }

      if (grossDesign + grossPrint <= 0) {
        return entry;
      }

      const headerDisc = Math.max(
        0,
        Math.round(linkedInv.totals?.discountAmount ?? linkedInv.discountAmount ?? 0)
      );
      const totalDisc = headerDisc + Math.round(negativeLineAdjust);
      const designDisc = Math.min(grossDesign, totalDisc);
      const fullDesign = clampMoney(Math.max(0, grossDesign - designDisc));
      const remDisc = Math.max(0, totalDisc - designDisc);
      const fullPrint = clampMoney(Math.max(0, grossPrint - remDisc));
      const fullTotal = fullDesign + fullPrint;

      const rawDeposit = clampMoney(
        linkedInv.totals?.depositAmount ?? linkedInv.depositAmount ?? 0
      );
      const isStage2Row =
        entry.id.startsWith('rev_rem_') ||
        String(entry.note || '').startsWith('[Đợt 2');

      const summaryNote = linkedInv.items
        .slice(0, 4)
        .map(
          (i) =>
            `${(i.name || '').trim()} (x${Math.max(1, Math.round(Number(i.quantity) || 1))})`
        )
        .join(', ')
        .slice(0, 420);

      let exactDesign = fullDesign;
      let exactPrint = fullPrint;
      let exactNote = entry.note;

      if (rawDeposit > 0) {
        const stage1Total = clampMoney(Math.min(fullTotal, rawDeposit));
        const stage1Design = clampMoney(Math.min(fullDesign, stage1Total));
        const stage1Print = clampMoney(Math.max(0, stage1Total - stage1Design));
        const stage2Design = clampMoney(Math.max(0, fullDesign - stage1Design));
        const stage2Print = clampMoney(Math.max(0, fullPrint - stage1Print));
        const hasStage2 = stage2Design + stage2Print > 0;

        if (isStage2Row) {
          exactDesign = stage2Design;
          exactPrint = stage2Print;
          exactNote = `[Đợt 2 - Phần còn lại] ${summaryNote}`
            .trim()
            .slice(0, 500);
        } else {
          exactDesign = stage1Design;
          exactPrint = stage1Print;
          const stage1Prefix = hasStage2 ? '[Đợt 1 - Tiền cọc]' : '[Thu đủ]';
          exactNote = `${stage1Prefix} ${summaryNote}`.trim().slice(0, 500);
        }
      } else if (!String(entry.note || '').startsWith('[')) {
        exactNote = `[Hoàn thành - Thu đủ] ${summaryNote}`
          .trim()
          .slice(0, 500);
      }

      const exactTotal = exactDesign + exactPrint;

      if (
        entry.designAmount === exactDesign &&
        entry.printAmount === exactPrint &&
        entry.totalRevenue === exactTotal &&
        entry.note === exactNote
      ) {
        return entry;
      }

      anyHealed = true;
      const healedKey = `${entry.id}:${exactDesign}:${exactPrint}:${exactNote}`;
      if (!healedRevenueEntryIds.has(healedKey)) {
        healedRevenueEntryIds.add(healedKey);
        const entryRef = doc(
          serverDb,
          'workspaces',
          workspaceId,
          'revenueEntries',
          entry.id
        );
        void updateDoc(entryRef, {
          designAmount: exactDesign,
          printAmount: exactPrint,
          totalRevenue: exactTotal,
          note: exactNote,
          updatedAt: serverTimestamp(),
        }).catch((err) => {
          console.error('Auto-heal revenue entry error:', err);
        });
      }

      return {
        ...entry,
        designAmount: exactDesign,
        printAmount: exactPrint,
        totalRevenue: exactTotal,
        note: exactNote,
        updatedAt: nowISO,
      };
    });

    if (anyHealed) {
      mirror.version += 1;
    }
  };

  const checkAllReady = () => {
    healProratedRevenueEntriesIfNeeded();
    if (
      mirror.invoicesReady &&
      mirror.settingsReady &&
      mirror.productsReady &&
      mirror.voucherBudgetsReady &&
      mirror.customersReady &&
      mirror.inventoryReady &&
      mirror.revenueEntriesReady
    ) {
      clearTimeout(timeoutHandle);
      resolveInitial();
    }
  };

  let invSeq = 0;
  const unsubInvoices = onSnapshot(
    query(
      collection(serverDb, 'workspaces', workspaceId, 'invoices'),
      where('workspaceId', '==', workspaceId)
    ),
    async (snap) => {
      const seq = ++invSeq;
      try {
        const activeIds = new Set<string>();
        const parsedInvoices = await Promise.all(
          snap.docs.map(async (invDoc) => {
            const invId = invDoc.id;
            activeIds.add(invId);
            const data = invDoc.data();
            const fallbackNow = new Date().toISOString();
            const updatedAtISO = timestampToISO(data.updatedAt, fallbackNow);
            const cacheKey = `${String(data.itemCount ?? '')}_${String(data.totalQuantity ?? '')}_${String(data.subtotal ?? '')}_${String(data.itemSummary ?? '')}`;

            const cached = mirror.itemsCache.get(invId);
            let items: QuoteItemPayload[] = [];

            if (cached && cached.cacheKey === cacheKey && cached.items.length > 0) {
              items = cached.items;
            } else {
              const itemsSnap = await getDocs(
                query(
                  collection(
                    serverDb,
                    'workspaces',
                    workspaceId,
                    'invoices',
                    invId,
                    'items'
                  ),
                  where('invoiceId', '==', invId)
                )
              );
              const sorted = itemsSnap.docs
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
                    quantity: clampInt(
                      Math.round(Number(idata.quantity) || 1),
                      1,
                      MAX_QTY
                    ),
                    unitPrice: clampMoney(Number(idata.unitPrice) || 0),
                    note: String(idata.note || ''),
                    sortIndex: Number(idata.sortIndex) || 0,
                  };
                })
                .sort((a, b) => a.sortIndex - b.sortIndex);

              items = sorted.map(({ sortIndex: _s, ...rest }) => rest);
              if (items.length > 0) {
                mirror.itemsCache.set(invId, { cacheKey, items });
              }
            }

            const discountAmount = clampMoney(Number(data.discountAmount) || 0);
            const shippingFee = clampMoney(Number(data.shippingFee) || 0);
            const depositAmount = clampMoney(Number(data.depositAmount) || 0);
            const totals = computeTotals(
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
                  : '',
              invoiceNote: String(data.invoiceNote || ''),
              reportStage: sanitizeReportStage(data.reportStage),
              remainingPaid:
                typeof data.remainingPaid === 'boolean'
                  ? data.remainingPaid
                  : undefined,
              remainingPaidAt:
                sanitizeOptionalServerOrderDate(data.remainingPaidAt) ||
                undefined,
              totals,
              syncedToCloud: true,
              syncedOwnerUid: workspaceId,
            } satisfies SavedInvoicePayload;
          })
        );

        if (seq !== invSeq) return;

        for (const cachedId of mirror.itemsCache.keys()) {
          if (!activeIds.has(cachedId)) {
            mirror.itemsCache.delete(cachedId);
          }
        }

        mirror.invoices = parsedInvoices
          .filter((inv) => inv.items.length > 0)
          .sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        mirror.invoicesReady = true;
        mirror.version += 1;
        checkAllReady();
      } catch (err) {
        console.error('Mirror invoices error:', err);
        mirror.invoicesReady = true;
        checkAllReady();
      }
    },
    (err) => {
      console.error('Mirror invoices listener error:', err);
      mirror.invoicesReady = true;
      checkAllReady();
    }
  );

  const unsubSettings = onSnapshot(
    doc(serverDb, 'workspaces', workspaceId, 'settings', 'store'),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        mirror.settings = {
          companyName: String(data.companyName || 'ATD Color'),
          address: String(data.address || ''),
          phone: String(data.phone || ''),
          email: String(data.email || ''),
          tiktok: String(data.tiktok || ''),
          preparerName: String(data.preparerName || ''),
          invoiceTitle: String(data.invoiceTitle || 'PHIẾU ĐẶT HÀNG'),
          footerNote: String(data.footerNote || ''),
          showCalculator:
            typeof data.showCalculator === 'boolean'
              ? data.showCalculator
              : true,
          showAiChat:
            typeof data.showAiChat === 'boolean' ? data.showAiChat : true,
          logoVersion:
            typeof data.logoVersion === 'string' &&
            LOGO_VERSION_PATTERN.test(data.logoVersion)
              ? data.logoVersion
              : '',
          signatureVersion:
            typeof data.signatureVersion === 'string' &&
            SIGNATURE_VERSION_PATTERN.test(data.signatureVersion)
              ? data.signatureVersion
              : '',
        };
      } else {
        mirror.settings = null;
      }
      mirror.settingsReady = true;
      mirror.version += 1;
      checkAllReady();
    },
    (err) => {
      console.error('Mirror settings listener error:', err);
      mirror.settingsReady = true;
      checkAllReady();
    }
  );

  const unsubProducts = onSnapshot(
    query(
      collection(serverDb, 'workspaces', workspaceId, 'products'),
      where('workspaceId', '==', workspaceId)
    ),
    (snap) => {
      if (!snap.empty) {
        const sorted = snap.docs
          .map((d) => {
            const data = d.data();
            const sides = String(data.sides || '').trim();
            const size = String(data.size || '').trim();
            return {
              id: d.id,
              code: String(data.code || d.id),
              name: String(data.name || 'Sản phẩm'),
              category: String(data.category || 'Khác'),
              sides: sides || undefined,
              size: size || undefined,
              unit: String(data.unit || 'Tờ'),
              price: clampMoney(Number(data.price) || 0),
              sortIndex: Number(data.sortIndex) || 0,
            };
          })
          .sort((a, b) => a.sortIndex - b.sortIndex);

        mirror.products = sorted.map(({ sortIndex: _s, ...rest }) => rest);
      } else {
        mirror.products = null;
      }
      mirror.productsReady = true;
      mirror.version += 1;
      checkAllReady();
    },
    (err) => {
      console.error('Mirror products listener error:', err);
      mirror.productsReady = true;
      checkAllReady();
    }
  );

  const unsubVoucherBudgets = onSnapshot(
    query(
      collection(serverDb, 'workspaces', workspaceId, 'voucherBudgets'),
      where('workspaceId', '==', workspaceId)
    ),
    (snap) => {
      const fallbackNow = new Date().toISOString();
      mirror.voucherBudgets = snap.docs
        .map((d) => {
          const data = d.data();
          const mk = String(data.monthKey || d.id).trim();
          return {
            monthKey: mk,
            budgetAmount: clampMoney(Number(data.budgetAmount) || 0),
            note: String(data.note || '').slice(0, 500),
            updatedAt: timestampToISO(data.updatedAt, fallbackNow),
          } satisfies VoucherBudgetPayload;
        })
        .filter((b) => MONTH_KEY_PATTERN.test(b.monthKey))
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
      mirror.voucherBudgetsReady = true;
      mirror.version += 1;
      checkAllReady();
    },
    (err) => {
      console.error('Mirror voucherBudgets listener error:', err);
      mirror.voucherBudgetsReady = true;
      checkAllReady();
    }
  );

  const unsubCustomers = onSnapshot(
    query(
      collection(serverDb, 'workspaces', workspaceId, 'customers'),
      where('workspaceId', '==', workspaceId)
    ),
    (snap) => {
      const fallbackNow = new Date().toISOString();
      mirror.customers = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: String(data.name || '').trim().slice(0, MAX_CUSTOMER_NAME_LEN),
            phone: String(data.phone || '').trim().slice(0, MAX_CUSTOMER_PHONE_LEN),
            customerDate: String(data.customerDate || '').trim().slice(0, 30),
            note: String(data.note || '').slice(0, 500),
            createdAt: timestampToISO(data.createdAt, fallbackNow),
            updatedAt: timestampToISO(data.updatedAt, fallbackNow),
          } satisfies CustomerContactPayload;
        })
        .filter((c) => c.name.length >= 1 && c.phone.length >= 1)
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      mirror.customersReady = true;
      mirror.version += 1;
      checkAllReady();
    },
    (err) => {
      console.error('Mirror customers listener error:', err);
      mirror.customersReady = true;
      checkAllReady();
    }
  );

  const unsubInventory = onSnapshot(
    query(
      collection(serverDb, 'workspaces', workspaceId, 'inventory'),
      where('workspaceId', '==', workspaceId)
    ),
    (snap) => {
      if (!snap.empty) {
        const fallbackNow = new Date().toISOString();
        mirror.inventory = snap.docs
          .map((d, idx) => {
            const data = d.data();
            const itemName = String(data.name || '').trim().slice(0, 160);
            const isTape = /băng\s*keo/iu.test(itemName);
            const rawUnit = (String(data.unit || '').trim() || 'Tấm').slice(
              0,
              40
            );
            const normUnit =
              isTape && /^cuộn$/iu.test(rawUnit) ? 'Cây' : rawUnit;
            const rawPack = String(data.packLabel || '').trim().slice(0, 120);
            const normPack = isTape
              ? rawPack.replace(/(^|[\s\d])cuộn(?=$|\s|[.,;)])/giu, '$1cây')
              : rawPack;
            return {
              id: d.id,
              name: itemName,
              unit: normUnit,
              quantity: clampInt(Number(data.quantity) || 0, 0, 1_000_000),
              minThreshold: clampInt(Number(data.minThreshold) || 0, 0, 1_000_000),
              packSize: clampInt(Number(data.packSize) || 1, 1, 100_000),
              packLabel: normPack,
              sortIndex: clampInt(Number(data.sortIndex ?? idx), 0, 500),
              createdAt: timestampToISO(data.createdAt, fallbackNow),
              updatedAt: timestampToISO(data.updatedAt, fallbackNow),
            } satisfies InventoryItemPayload;
          })
          .filter((item) => item.name.length >= 1)
          .sort((a, b) => a.sortIndex - b.sortIndex);
      } else {
        mirror.inventory = null;
      }
      mirror.inventoryReady = true;
      mirror.version += 1;
      checkAllReady();
    },
    (err) => {
      console.error('Mirror inventory listener error:', err);
      mirror.inventoryReady = true;
      checkAllReady();
    }
  );

  const unsubRevenueEntries = onSnapshot(
    query(
      collection(serverDb, 'workspaces', workspaceId, 'revenueEntries'),
      where('workspaceId', '==', workspaceId)
    ),
    (snap) => {
      const fallbackNow = new Date().toISOString();
      const todayFallback = fallbackNow.slice(0, 10);
      mirror.revenueEntries = snap.docs
        .map((d) => {
          const data = d.data();
          const rawOrderDate = String(data.orderDate || '').trim();
          const orderDate = ORDER_DATE_PATTERN.test(rawOrderDate)
            ? rawOrderDate
            : todayFallback;
          const designAmount = clampMoney(Number(data.designAmount) || 0);
          const printAmount = clampMoney(Number(data.printAmount) || 0);
          const rawInvId = String(data.invoiceId || '').trim().slice(0, 128);
          return {
            id: d.id,
            invoiceId: OPTIONAL_INVOICE_ID_PATTERN.test(rawInvId) ? rawInvId : '',
            invoiceCode: String(data.invoiceCode || '').trim().slice(0, MAX_CODE_LEN),
            orderDate,
            monthKey: orderDate.slice(0, 7),
            customerName:
              String(data.customerName || '').trim().slice(0, MAX_CUSTOMER_NAME_LEN) ||
              'Khách lẻ',
            customerPhone: String(data.customerPhone || '')
              .trim()
              .slice(0, MAX_CUSTOMER_PHONE_LEN),
            customerCode: String(data.customerCode || '')
              .trim()
              .slice(0, MAX_CUSTOMER_CODE_LEN),
            designAmount,
            printAmount,
            totalRevenue: designAmount + printAmount,
            isManualOverride: Boolean(data.isManualOverride),
            isDeleted: Boolean(data.isDeleted),
            note: String(data.note || '').slice(0, 500),
            createdAt: timestampToISO(data.createdAt, fallbackNow),
            updatedAt: timestampToISO(data.updatedAt, fallbackNow),
          } satisfies RevenueEntryPayload;
        })
        .sort((a, b) => {
          const dc = b.orderDate.localeCompare(a.orderDate);
          if (dc !== 0) return dc;
          return (
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        });
      mirror.revenueEntriesReady = true;
      mirror.version += 1;
      checkAllReady();
    },
    (err) => {
      console.error('Mirror revenueEntries listener error:', err);
      mirror.revenueEntriesReady = true;
      checkAllReady();
    }
  );

  mirror.dispose = () => {
    clearTimeout(timeoutHandle);
    unsubInvoices();
    unsubSettings();
    unsubProducts();
    unsubVoucherBudgets();
    unsubCustomers();
    unsubInventory();
    unsubRevenueEntries();
  };

  activeMirrors.set(workspaceId, mirror);
  return mirror;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  // Disable caching on all API sync routes
  app.use('/api/cloud', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    next();
  });

  // 1. Live Server + Firestore Connectivity Health Check
  app.get('/api/cloud/health', async (_req: Request, res: Response) => {
    try {
      await getDocFromServer(doc(serverDb, 'accounts', 'health_probe_check'));
      res.json({
        ok: true,
        connected: true,
        serverTime: new Date().toISOString(),
      });
    } catch (error) {
      const formatted = formatErrorPayload(error);
      res.status(formatted.status).json({
        ok: false,
        connected: false,
        ...formatted,
      });
    }
  });

  // 2. Fetch Account Verifier Record (/accounts/{usernameKey})
  app.get(
    '/api/cloud/accounts/:usernameKey',
    async (req: Request, res: Response) => {
      const usernameKey = String(req.params.usernameKey || '').trim();
      if (!USERNAME_KEY_PATTERN.test(usernameKey)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_USERNAME',
          message: 'Tên tài khoản không hợp lệ.',
        });
        return;
      }

      try {
        const accountRef = doc(serverDb, 'accounts', usernameKey);
        const snap = await getDocFromServer(accountRef);
        if (!snap.exists()) {
          res.json({ ok: true, exists: false });
          return;
        }
        const data = snap.data();
        res.json({
          ok: true,
          exists: true,
          account: {
            usernameKey: String(data.usernameKey || usernameKey),
            displayName: String(data.displayName || usernameKey),
            verifierHash: String(data.verifierHash || ''),
          },
        });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  // 3. Register New Shared Account (/accounts/{usernameKey})
  app.post('/api/cloud/accounts', async (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      usernameKey?: unknown;
      displayName?: unknown;
      verifierHash?: unknown;
    };
    const usernameKey = String(body.usernameKey || '').trim();
    const displayName = String(body.displayName || usernameKey)
      .trim()
      .slice(0, 80);
    const verifierHash = String(body.verifierHash || '').trim();

    if (!USERNAME_KEY_PATTERN.test(usernameKey)) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_USERNAME',
        message: 'Tên tài khoản không hợp lệ.',
      });
      return;
    }
    if (!displayName || displayName.length > 80) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_DISPLAY_NAME',
        message: 'Tên hiển thị không hợp lệ.',
      });
      return;
    }
    if (!HEX64_PATTERN.test(verifierHash)) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_VERIFIER',
        message: 'Mã xác thực mật khẩu không hợp lệ.',
      });
      return;
    }

    try {
      const accountRef = doc(serverDb, 'accounts', usernameKey);
      const existing = await getDocFromServer(accountRef);
      if (existing.exists()) {
        res.status(409).json({
          ok: false,
          code: 'ACCOUNT_EXISTS',
          message: `Tài khoản "${usernameKey}" đã tồn tại.`,
        });
        return;
      }

      await setDoc(accountRef, {
        usernameKey,
        displayName,
        verifierHash,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      res.status(201).json({
        ok: true,
        account: { usernameKey, displayName },
      });
    } catch (error) {
      const formatted = formatErrorPayload(error);
      res.status(formatted.status).json({ ok: false, ...formatted });
    }
  });

  // 4. Real-Time Delta Workspace Snapshot (Invoices + Settings + Products)
  app.get(
    '/api/cloud/workspaces/:workspaceId/snapshot',
    async (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      try {
        const sinceVersion = Number(req.query.sinceVersion || 0);
        const mirror = getOrCreateWorkspaceMirror(workspaceId);
        await mirror.readyPromise;

        if (sinceVersion > 0 && sinceVersion === mirror.version) {
          res.json({
            ok: true,
            unchanged: true,
            version: mirror.version,
          });
          return;
        }

        const storedLogo = readStoredWorkspaceLogo(workspaceId);
        const storedSignature = readStoredWorkspaceSignature(workspaceId);
        const effectiveSettings = mirror.settings
          ? {
              ...mirror.settings,
              logoVersion:
                mirror.settings.logoVersion || storedLogo?.version || '',
              signatureVersion:
                mirror.settings.signatureVersion ||
                storedSignature?.version ||
                '',
            }
          : storedLogo || storedSignature
            ? {
                companyName: 'ATD Color',
                address: 'Tân Hồng, Đồng Tháp',
                phone: '0967434893',
                email: 'atdcolor.com',
                tiktok: '@atdcolor2',
                preparerName: 'Nguyễn Tuấn Đạt',
                invoiceTitle: 'PHIẾU ĐẶT HÀNG',
                footerNote: '',
                showCalculator: true,
                showAiChat: true,
                logoVersion: storedLogo?.version || '',
                signatureVersion: storedSignature?.version || '',
              }
            : null;

        res.json({
          ok: true,
          unchanged: false,
          version: mirror.version,
          invoices: mirror.invoices,
          settings: effectiveSettings,
          products: mirror.products,
          voucherBudgets: mirror.voucherBudgets,
          customers: mirror.customers,
          inventory: mirror.inventory,
          revenueEntries: mirror.revenueEntries,
          serverTime: new Date().toISOString(),
        });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  // 5. Upsert Shared Workspace Invoice + Subcollection Items (Safe Batch Chunking)
  app.post(
    '/api/cloud/workspaces/:workspaceId/invoices',
    async (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      const body = (req.body || {}) as {
        accountUsername?: unknown;
        invoice?: Partial<SavedInvoicePayload>;
      };
      const accountUsername = String(body.accountUsername || '').trim();
      if (!USERNAME_KEY_PATTERN.test(accountUsername)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_USERNAME',
          message: 'Tài khoản không hợp lệ.',
        });
        return;
      }

      const rawInv = body.invoice;
      if (!rawInv || !Array.isArray(rawInv.items) || rawInv.items.length === 0) {
        res.status(400).json({
          ok: false,
          code: 'EMPTY_INVOICE',
          message: 'Hóa đơn cần có ít nhất 1 sản phẩm.',
        });
        return;
      }

      const invoiceId = sanitizeSafeId(String(rawInv.id || ''), 'inv');
      const safeCode = sanitizeSafeId(String(rawInv.code || 'HD'), 'HD').slice(
        0,
        MAX_CODE_LEN
      );

      const usedItemIds = new Set<string>();
      const boundedItems = rawInv.items
        .slice(0, MAX_ITEMS_PER_INVOICE)
        .map((item, idx) => {
          let candidateId = sanitizeSafeId(
            String(item.id || `item-${idx}`),
            `item-${idx}`
          );
          if (usedItemIds.has(candidateId)) {
            candidateId = sanitizeSafeId(`${candidateId}-${idx}`, `item-${idx}`);
          }
          usedItemIds.add(candidateId);

          return {
            id: candidateId,
            productId: String(item.productId || '')
              .trim()
              .slice(0, MAX_ID_LEN),
            name: (String(item.name || '').trim() || 'Sản phẩm').slice(
              0,
              MAX_ITEM_NAME_LEN
            ),
            unit: (String(item.unit || '').trim() || 'Tờ').slice(
              0,
              MAX_ITEM_UNIT_LEN
            ),
            quantity: clampInt(Number(item.quantity) || 1, 1, MAX_QTY),
            unitPrice: clampMoney(Number(item.unitPrice) || 0),
            note: String(item.note || '')
              .trim()
              .slice(0, MAX_ITEM_NOTE_LEN),
            sortIndex: clampInt(idx, 0, MAX_ITEMS_PER_INVOICE),
          };
        });

      const totals = computeTotals(
        boundedItems,
        Number(rawInv.discountAmount) || 0,
        Number(rawInv.shippingFee) || 0,
        Number(rawInv.depositAmount) || 0
      );

      const mutableFields = {
        invoiceDate: String(rawInv.createdAt || new Date().toISOString()).slice(
          0,
          MAX_INVOICE_DATE_LEN
        ),
        expectedDemoDate: String(rawInv.expectedDemoDate || '')
          .trim()
          .slice(0, MAX_DEMO_DATE_LEN),
        customerName: String(rawInv.customer?.name || '')
          .trim()
          .slice(0, MAX_CUSTOMER_NAME_LEN),
        customerCode: String(rawInv.customer?.code || '')
          .trim()
          .slice(0, MAX_CUSTOMER_CODE_LEN),
        customerPhone: String(rawInv.customer?.phone || '')
          .trim()
          .slice(0, MAX_CUSTOMER_PHONE_LEN),
        designIllustration: String(rawInv.designIllustration || '')
          .trim()
          .slice(0, MAX_DESIGN_ILLUSTRATION_LEN),
        invoiceNote: String(rawInv.invoiceNote || '').slice(0, MAX_NOTE_LEN),
        reportStage: sanitizeReportStage(rawInv.reportStage),
        remainingPaid: Boolean(rawInv.remainingPaid),
        remainingPaidAt: rawInv.remainingPaid
          ? sanitizeOptionalServerOrderDate(rawInv.remainingPaidAt)
          : '',
        itemSummary: buildItemSummary(boundedItems),
        itemCount: clampInt(boundedItems.length, 1, MAX_ITEMS_PER_INVOICE),
        totalQuantity: totals.totalQuantity,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        shippingFee: totals.shippingFee,
        depositAmount: totals.depositAmount,
        remainingAmount: totals.remainingAmount,
      };

      try {
        const invoiceRef = doc(
          serverDb,
          'workspaces',
          workspaceId,
          'invoices',
          invoiceId
        );
        const existingInvSnap = await getDocFromServer(invoiceRef);
        const existsOnServer = existingInvSnap.exists();

        const existingItemIds = new Set<string>();
        if (existsOnServer) {
          const existingItemsSnap = await getDocs(
            query(
              collection(
                serverDb,
                'workspaces',
                workspaceId,
                'invoices',
                invoiceId,
                'items'
              ),
              where('invoiceId', '==', invoiceId)
            )
          );
          for (const d of existingItemsSnap.docs) {
            existingItemIds.add(d.id);
          }
        }

        const incomingIds = new Set(boundedItems.map((i) => i.id));
        const obsoleteIds = Array.from(existingItemIds).filter(
          (oldId) => !incomingIds.has(oldId)
        );

        // Chunk 1: Parent invoice + first <= 8 items (<= 17 rule lookups, safely < 20 limit)
        const firstChunk = boundedItems.slice(0, SAFE_BATCH_CHUNK);
        const batch1 = writeBatch(serverDb);

        if (!existsOnServer) {
          batch1.set(invoiceRef, {
            workspaceId,
            accountUsername,
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
            serverDb,
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

        // Subsequent item chunks (if > 8 items)
        for (
          let offset = SAFE_BATCH_CHUNK;
          offset < boundedItems.length;
          offset += SAFE_BATCH_CHUNK
        ) {
          const slice = boundedItems.slice(offset, offset + SAFE_BATCH_CHUNK);
          const extraBatch = writeBatch(serverDb);
          for (const item of slice) {
            const itemRef = doc(
              serverDb,
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

        // Delete removed line items in safe chunks of <= 8
        for (
          let offset = 0;
          offset < obsoleteIds.length;
          offset += SAFE_BATCH_CHUNK
        ) {
          const delSlice = obsoleteIds.slice(offset, offset + SAFE_BATCH_CHUNK);
          const delBatch = writeBatch(serverDb);
          for (const oldId of delSlice) {
            delBatch.delete(
              doc(
                serverDb,
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

        const mirror = activeMirrors.get(workspaceId);
        if (mirror) {
          mirror.itemsCache.delete(invoiceId);
          mirror.version += 1;
        }

        res.json({ ok: true, invoiceId });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  // 6. Delete Shared Workspace Invoice + Subcollection Items (Safe Batch Chunking)
  app.delete(
    '/api/cloud/workspaces/:workspaceId/invoices/:invoiceId',
    async (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      const invoiceId = sanitizeSafeId(String(req.params.invoiceId || ''), 'inv');

      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      try {
        const invoiceRef = doc(
          serverDb,
          'workspaces',
          workspaceId,
          'invoices',
          invoiceId
        );
        const invSnap = await getDocFromServer(invoiceRef);
        if (!invSnap.exists()) {
          res.json({ ok: true, deleted: false });
          return;
        }

        const itemsSnap = await getDocs(
          query(
            collection(
              serverDb,
              'workspaces',
              workspaceId,
              'invoices',
              invoiceId,
              'items'
            ),
            where('invoiceId', '==', invoiceId)
          )
        );
        const itemIds = itemsSnap.docs.map((d) => d.id);

        // Delete items in chunks of <= 8 while parent invoice still exists
        while (itemIds.length > SAFE_BATCH_CHUNK) {
          const chunk = itemIds.splice(0, SAFE_BATCH_CHUNK);
          const chunkBatch = writeBatch(serverDb);
          for (const id of chunk) {
            chunkBatch.delete(
              doc(
                serverDb,
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

        const finalBatch = writeBatch(serverDb);
        for (const id of itemIds) {
          finalBatch.delete(
            doc(
              serverDb,
              'workspaces',
              workspaceId,
              'invoices',
              invoiceId,
              'items',
              id
            )
          );
        }
        finalBatch.delete(invoiceRef);
        await finalBatch.commit();

        const mirror = activeMirrors.get(workspaceId);
        if (mirror) {
          mirror.itemsCache.delete(invoiceId);
          mirror.invoices = mirror.invoices.filter((inv) => inv.id !== invoiceId);
          mirror.version += 1;
        }

        res.json({ ok: true, deleted: true });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  // 6b. Fast Single-Document Report Stage Classification (/workspaces/{workspaceId}/invoices/{invoiceId}/stage)
  app.patch(
    '/api/cloud/workspaces/:workspaceId/invoices/:invoiceId/stage',
    async (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      const invoiceId = sanitizeSafeId(String(req.params.invoiceId || ''), 'inv');

      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      const body = (req.body || {}) as {
        reportStage?: unknown;
        remainingPaid?: unknown;
        remainingPaidAt?: unknown;
      };
      const rawStage = typeof body.reportStage === 'string' ? body.reportStage.trim() : '';
      if (!VALID_REPORT_STAGES.has(rawStage)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_REPORT_STAGE',
          message: 'Phân loại báo cáo không hợp lệ.',
        });
        return;
      }

      const hasRemainingPaidPatch = typeof body.remainingPaid === 'boolean';
      const safeRemainingPaid = hasRemainingPaidPatch
        ? Boolean(body.remainingPaid)
        : undefined;
      const safeRemainingPaidAt = hasRemainingPaidPatch
        ? safeRemainingPaid
          ? sanitizeOptionalServerOrderDate(body.remainingPaidAt)
          : ''
        : undefined;

      try {
        const invoiceRef = doc(
          serverDb,
          'workspaces',
          workspaceId,
          'invoices',
          invoiceId
        );
        const invSnap = await getDocFromServer(invoiceRef);
        if (!invSnap.exists()) {
          res.json({ ok: true, found: false });
          return;
        }

        const updatePayload: Record<string, unknown> = {
          reportStage: rawStage,
          updatedAt: serverTimestamp(),
        };
        if (hasRemainingPaidPatch) {
          updatePayload.remainingPaid = safeRemainingPaid;
          updatePayload.remainingPaidAt = safeRemainingPaidAt ?? '';
        }

        await updateDoc(invoiceRef, updatePayload);

        const mirror = activeMirrors.get(workspaceId);
        if (mirror) {
          const nowISO = new Date().toISOString();
          mirror.invoices = mirror.invoices
            .map((inv) =>
              inv.id === invoiceId
                ? {
                    ...inv,
                    reportStage: rawStage,
                    ...(hasRemainingPaidPatch
                      ? {
                          remainingPaid: safeRemainingPaid,
                          remainingPaidAt: safeRemainingPaidAt || undefined,
                        }
                      : {}),
                    updatedAt: nowISO,
                  }
                : inv
            )
            .sort(
              (a, b) =>
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            );
          mirror.version += 1;
        }

        res.json({
          ok: true,
          found: true,
          reportStage: rawStage,
          ...(hasRemainingPaidPatch
            ? {
                remainingPaid: safeRemainingPaid,
                remainingPaidAt: safeRemainingPaidAt,
              }
            : {}),
        });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  // 7. Upsert Shared Store Settings (/workspaces/{workspaceId}/settings/store)
  app.put(
    '/api/cloud/workspaces/:workspaceId/settings',
    async (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      const body = (req.body || {}) as {
        accountUsername?: unknown;
        settings?: Partial<StoreSettingsPayload>;
      };
      const accountUsername = String(body.accountUsername || '').trim();
      if (!USERNAME_KEY_PATTERN.test(accountUsername)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_USERNAME',
          message: 'Tài khoản không hợp lệ.',
        });
        return;
      }

      const raw = body.settings || {};
      const mutablePayload = {
        companyName: (String(raw.companyName || '').trim() || 'ATD Color').slice(
          0,
          120
        ),
        address: String(raw.address || '')
          .trim()
          .slice(0, 250),
        phone: String(raw.phone || '')
          .trim()
          .slice(0, 40),
        email: String(raw.email || '')
          .trim()
          .slice(0, 120),
        tiktok: String(raw.tiktok || '')
          .trim()
          .slice(0, 80),
        preparerName: String(raw.preparerName || '')
          .trim()
          .slice(0, 120),
        invoiceTitle: (
          String(raw.invoiceTitle || '').trim() || 'PHIẾU ĐẶT HÀNG'
        ).slice(0, 120),
        footerNote: String(raw.footerNote || '').slice(0, 3000),
        showCalculator:
          typeof raw.showCalculator === 'boolean' ? raw.showCalculator : true,
        showAiChat:
          typeof raw.showAiChat === 'boolean' ? raw.showAiChat : true,
        logoVersion:
          typeof raw.logoVersion === 'string' &&
          LOGO_VERSION_PATTERN.test(raw.logoVersion.trim())
            ? raw.logoVersion.trim()
            : '',
        signatureVersion:
          typeof raw.signatureVersion === 'string' &&
          SIGNATURE_VERSION_PATTERN.test(raw.signatureVersion.trim())
            ? raw.signatureVersion.trim()
            : '',
      };

      try {
        const settingsRef = doc(
          serverDb,
          'workspaces',
          workspaceId,
          'settings',
          'store'
        );
        const snap = await getDocFromServer(settingsRef);
        if (!snap.exists()) {
          await setDoc(settingsRef, {
            workspaceId,
            accountUsername,
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

        const mirror = activeMirrors.get(workspaceId);
        if (mirror) {
          mirror.settings = mutablePayload;
          mirror.version += 1;
        }

        res.json({ ok: true });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  // 7B. Get, Upload & Delete Original Company Logo (/api/cloud/workspaces/:workspaceId/logo)
  app.get(
    '/api/cloud/workspaces/:workspaceId/logo',
    (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      const metaOnly =
        req.query.metaOnly === '1' || req.query.metaOnly === 'true';
      const stored = readStoredWorkspaceLogo(workspaceId);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        ok: true,
        hasLogo: Boolean(stored),
        version: stored?.version || '',
        dataUrl: metaOnly ? null : stored?.dataUrl || null,
      });
    }
  );

  app.put(
    '/api/cloud/workspaces/:workspaceId/logo',
    (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      const body = (req.body || {}) as {
        accountUsername?: unknown;
        version?: unknown;
        dataUrl?: unknown;
      };
      const accountUsername = String(body.accountUsername || '').trim();
      if (!USERNAME_KEY_PATTERN.test(accountUsername)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_USERNAME',
          message: 'Tài khoản không hợp lệ.',
        });
        return;
      }

      const version = String(body.version || '').trim();
      if (!version || !LOGO_VERSION_PATTERN.test(version)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_LOGO_VERSION',
          message: 'Mã phiên bản logo không hợp lệ.',
        });
        return;
      }

      const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl.trim() : '';
      if (
        !dataUrl.startsWith('data:image/') ||
        dataUrl.length > MAX_LOGO_DATA_URL_LEN
      ) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_LOGO_IMAGE',
          message: 'Dữ liệu ảnh logo không hợp lệ hoặc vượt quá giới hạn.',
        });
        return;
      }

      const saved = writeStoredWorkspaceLogo(workspaceId, version, dataUrl);
      const mirror = activeMirrors.get(workspaceId);
      if (mirror) {
        mirror.version += 1;
      }

      res.json({ ok: true, version: saved.version });
    }
  );

  app.delete(
    '/api/cloud/workspaces/:workspaceId/logo',
    (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      removeStoredWorkspaceLogo(workspaceId);
      const mirror = activeMirrors.get(workspaceId);
      if (mirror) {
        mirror.version += 1;
      }

      res.json({ ok: true });
    }
  );

  // 7C. Get, Upload & Delete Preparer Signature (/api/cloud/workspaces/:workspaceId/signature)
  app.get(
    '/api/cloud/workspaces/:workspaceId/signature',
    (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      const metaOnly =
        req.query.metaOnly === '1' || req.query.metaOnly === 'true';
      const stored = readStoredWorkspaceSignature(workspaceId);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        ok: true,
        hasSignature: Boolean(stored),
        version: stored?.version || '',
        dataUrl: metaOnly ? null : stored?.dataUrl || null,
      });
    }
  );

  app.put(
    '/api/cloud/workspaces/:workspaceId/signature',
    (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      const body = (req.body || {}) as {
        accountUsername?: unknown;
        version?: unknown;
        dataUrl?: unknown;
      };
      const accountUsername = String(body.accountUsername || '').trim();
      if (!USERNAME_KEY_PATTERN.test(accountUsername)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_USERNAME',
          message: 'Tài khoản không hợp lệ.',
        });
        return;
      }

      const version = String(body.version || '').trim();
      if (!version || !SIGNATURE_VERSION_PATTERN.test(version)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_SIGNATURE_VERSION',
          message: 'Mã phiên bản chữ ký không hợp lệ.',
        });
        return;
      }

      const dataUrl =
        typeof body.dataUrl === 'string' ? body.dataUrl.trim() : '';
      if (
        !dataUrl.startsWith('data:image/') ||
        dataUrl.length > MAX_SIGNATURE_DATA_URL_LEN
      ) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_SIGNATURE_IMAGE',
          message: 'Dữ liệu ảnh chữ ký không hợp lệ hoặc vượt quá giới hạn.',
        });
        return;
      }

      const saved = writeStoredWorkspaceSignature(
        workspaceId,
        version,
        dataUrl
      );
      const mirror = activeMirrors.get(workspaceId);
      if (mirror) {
        mirror.version += 1;
      }

      res.json({ ok: true, version: saved.version });
    }
  );

  app.delete(
    '/api/cloud/workspaces/:workspaceId/signature',
    (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      removeStoredWorkspaceSignature(workspaceId);
      const mirror = activeMirrors.get(workspaceId);
      if (mirror) {
        mirror.version += 1;
      }

      res.json({ ok: true });
    }
  );

  // 8. Sync Shared Product Catalog (/workspaces/{workspaceId}/products/{productId})
  app.put(
    '/api/cloud/workspaces/:workspaceId/products',
    async (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      const body = (req.body || {}) as {
        accountUsername?: unknown;
        products?: Partial<ProductPayload>[];
      };
      const accountUsername = String(body.accountUsername || '').trim();
      if (!USERNAME_KEY_PATTERN.test(accountUsername)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_USERNAME',
          message: 'Tài khoản không hợp lệ.',
        });
        return;
      }

      const rawProducts = Array.isArray(body.products)
        ? body.products.slice(0, MAX_PRODUCTS)
        : [];

      try {
        const productsCol = collection(
          serverDb,
          'workspaces',
          workspaceId,
          'products'
        );
        const existingSnap = await getDocs(
          query(productsCol, where('workspaceId', '==', workspaceId))
        );
        const existingIds = new Set(existingSnap.docs.map((d) => d.id));
        const incomingIds = new Set<string>();

        const normalizedOps = rawProducts.map((prod, idx) => {
          const safeId = sanitizeSafeId(
            String(prod.id || `prod-${idx}`),
            `prod-${idx}`
          );
          incomingIds.add(safeId);
          return {
            safeId,
            mutableFields: {
              code: (String(prod.code || '').trim() || `SP-${idx + 1}`).slice(
                0,
                40
              ),
              name: (String(prod.name || '').trim() || 'Sản phẩm').slice(
                0,
                200
              ),
              category: (String(prod.category || '').trim() || 'Khác').slice(
                0,
                120
              ),
              sides: String(prod.sides || '')
                .trim()
                .slice(0, 40),
              size: String(prod.size || '')
                .trim()
                .slice(0, 60),
              unit: (String(prod.unit || '').trim() || 'Tờ').slice(0, 40),
              price: clampMoney(Number(prod.price) || 0),
              sortIndex: clampInt(idx, 0, MAX_PRODUCTS),
            },
          };
        });

        for (
          let offset = 0;
          offset < normalizedOps.length;
          offset += SAFE_BATCH_CHUNK
        ) {
          const chunk = normalizedOps.slice(offset, offset + SAFE_BATCH_CHUNK);
          const batch = writeBatch(serverDb);
          for (const op of chunk) {
            const prodRef = doc(
              serverDb,
              'workspaces',
              workspaceId,
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
                workspaceId,
                accountUsername,
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
          const delBatch = writeBatch(serverDb);
          for (const oldId of chunk) {
            delBatch.delete(
              doc(serverDb, 'workspaces', workspaceId, 'products', oldId)
            );
          }
          await delBatch.commit();
        }

        const mirror = activeMirrors.get(workspaceId);
        if (mirror) {
          mirror.products =
            normalizedOps.length > 0
              ? normalizedOps.map(({ safeId, mutableFields }) => ({
                  id: safeId,
                  code: mutableFields.code,
                  name: mutableFields.name,
                  category: mutableFields.category,
                  sides: mutableFields.sides || undefined,
                  size: mutableFields.size || undefined,
                  unit: mutableFields.unit,
                  price: mutableFields.price,
                }))
              : null;
          mirror.version += 1;
        }

        res.json({ ok: true });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  // 8B. Upsert Monthly Voucher Budget (/workspaces/{workspaceId}/voucherBudgets/{monthKey})
  app.put(
    '/api/cloud/workspaces/:workspaceId/voucher-budgets/:monthKey',
    async (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      const monthKey = String(req.params.monthKey || '').trim();
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }
      if (!MONTH_KEY_PATTERN.test(monthKey)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_MONTH_KEY',
          message: 'Tháng không hợp lệ (YYYY-MM).',
        });
        return;
      }

      const body = (req.body || {}) as {
        accountUsername?: unknown;
        budgetAmount?: unknown;
        note?: unknown;
      };
      const accountUsername = String(body.accountUsername || '').trim();
      if (!USERNAME_KEY_PATTERN.test(accountUsername)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_USERNAME',
          message: 'Tài khoản không hợp lệ.',
        });
        return;
      }

      const budgetAmount = clampMoney(Number(body.budgetAmount) || 0);
      const note = String(body.note || '').trim().slice(0, 500);

      try {
        const budgetRef = doc(
          serverDb,
          'workspaces',
          workspaceId,
          'voucherBudgets',
          monthKey
        );
        const existingSnap = await getDocFromServer(budgetRef);
        if (!existingSnap.exists()) {
          await setDoc(budgetRef, {
            workspaceId,
            accountUsername,
            monthKey,
            budgetAmount,
            note,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(budgetRef, {
            budgetAmount,
            note,
            updatedAt: serverTimestamp(),
          });
        }

        const mirror = activeMirrors.get(workspaceId);
        if (mirror) {
          const nowISO = new Date().toISOString();
          const nextItem: VoucherBudgetPayload = {
            monthKey,
            budgetAmount,
            note,
            updatedAt: nowISO,
          };
          mirror.voucherBudgets = [
            nextItem,
            ...mirror.voucherBudgets.filter((b) => b.monthKey !== monthKey),
          ].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
          mirror.version += 1;
        }

        res.json({ ok: true, monthKey, budgetAmount });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  // 8C. Upsert & Delete Customer Contact in Date KH (/workspaces/{workspaceId}/customers/{customerId})
  app.put(
    '/api/cloud/workspaces/:workspaceId/customers/:customerId',
    async (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      const customerId = sanitizeSafeId(
        String(req.params.customerId || ''),
        'cust'
      );
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      const body = (req.body || {}) as {
        accountUsername?: unknown;
        customer?: Partial<CustomerContactPayload>;
      };
      const accountUsername = String(body.accountUsername || '').trim();
      if (!USERNAME_KEY_PATTERN.test(accountUsername)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_USERNAME',
          message: 'Tài khoản không hợp lệ.',
        });
        return;
      }

      const raw = body.customer || {};
      const name = String(raw.name || '')
        .trim()
        .slice(0, MAX_CUSTOMER_NAME_LEN);
      const phone = String(raw.phone || '')
        .trim()
        .slice(0, MAX_CUSTOMER_PHONE_LEN);
      const customerDate = String(raw.customerDate || '')
        .trim()
        .slice(0, 30);
      const note = String(raw.note || '')
        .trim()
        .slice(0, 500);

      if (!name || !phone) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_CUSTOMER',
          message: 'Vui lòng nhập đầy đủ Tên KH và Số điện thoại.',
        });
        return;
      }

      try {
        const custRef = doc(
          serverDb,
          'workspaces',
          workspaceId,
          'customers',
          customerId
        );
        const existingSnap = await getDocFromServer(custRef);
        const nowISO = new Date().toISOString();
        let createdAtISO = nowISO;

        if (!existingSnap.exists()) {
          await setDoc(custRef, {
            workspaceId,
            accountUsername,
            name,
            phone,
            customerDate,
            note,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          createdAtISO = timestampToISO(
            existingSnap.data().createdAt,
            String(raw.createdAt || nowISO)
          );
          await updateDoc(custRef, {
            name,
            phone,
            customerDate,
            note,
            updatedAt: serverTimestamp(),
          });
        }

        const mirror = activeMirrors.get(workspaceId);
        if (mirror) {
          const nextItem: CustomerContactPayload = {
            id: customerId,
            name,
            phone,
            customerDate,
            note,
            createdAt: createdAtISO,
            updatedAt: nowISO,
          };
          mirror.customers = [
            nextItem,
            ...mirror.customers.filter((c) => c.id !== customerId),
          ].sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
          mirror.version += 1;
        }

        res.json({ ok: true, customerId });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  app.delete(
    '/api/cloud/workspaces/:workspaceId/customers/:customerId',
    async (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      const customerId = sanitizeSafeId(
        String(req.params.customerId || ''),
        'cust'
      );
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      try {
        const custRef = doc(
          serverDb,
          'workspaces',
          workspaceId,
          'customers',
          customerId
        );
        const snap = await getDocFromServer(custRef);
        if (snap.exists()) {
          await deleteDoc(custRef);
        }

        const mirror = activeMirrors.get(workspaceId);
        if (mirror) {
          mirror.customers = mirror.customers.filter((c) => c.id !== customerId);
          mirror.version += 1;
        }

        res.json({ ok: true, deleted: snap.exists() });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  // 8D. Sync & Upsert Warehouse Inventory (/workspaces/{workspaceId}/inventory/{itemId})
  app.put(
    '/api/cloud/workspaces/:workspaceId/inventory',
    async (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      const body = (req.body || {}) as {
        accountUsername?: unknown;
        items?: Partial<InventoryItemPayload>[];
      };
      const accountUsername = String(body.accountUsername || '').trim();
      if (!USERNAME_KEY_PATTERN.test(accountUsername)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_USERNAME',
          message: 'Tài khoản không hợp lệ.',
        });
        return;
      }

      const rawItems = Array.isArray(body.items) ? body.items.slice(0, 500) : [];

      try {
        const invCol = collection(
          serverDb,
          'workspaces',
          workspaceId,
          'inventory'
        );
        const existingSnap = await getDocs(
          query(invCol, where('workspaceId', '==', workspaceId))
        );
        const existingIds = new Set(existingSnap.docs.map((d) => d.id));
        const incomingIds = new Set<string>();
        const nowISO = new Date().toISOString();

        const normalizedOps = rawItems
          .map((entry, idx) => {
            const safeId = sanitizeSafeId(
              String(entry.id || `inv-${idx}`),
              `inv-${idx}`
            );
            const name = String(entry.name || '').trim().slice(0, 160);
            if (!name) return null;
            const isTape = /băng\s*keo/iu.test(name);
            const rawUnit = (String(entry.unit || '').trim() || 'Tấm').slice(
              0,
              40
            );
            const normUnit =
              isTape && /^cuộn$/iu.test(rawUnit) ? 'Cây' : rawUnit;
            const rawPack = String(entry.packLabel || '').trim().slice(0, 120);
            const normPack = isTape
              ? rawPack.replace(/(^|[\s\d])cuộn(?=$|\s|[.,;)])/giu, '$1cây')
              : rawPack;
            incomingIds.add(safeId);
            return {
              safeId,
              createdAt: String(entry.createdAt || nowISO),
              mutableFields: {
                name,
                unit: normUnit,
                quantity: clampInt(Number(entry.quantity) || 0, 0, 1_000_000),
                minThreshold: clampInt(
                  Number(entry.minThreshold) || 0,
                  0,
                  1_000_000
                ),
                packSize: clampInt(Number(entry.packSize) || 1, 1, 100_000),
                packLabel: normPack,
                sortIndex: clampInt(Number(entry.sortIndex ?? idx), 0, 500),
              },
            };
          })
          .filter(
            (
              op
            ): op is {
              safeId: string;
              createdAt: string;
              mutableFields: {
                name: string;
                unit: string;
                quantity: number;
                minThreshold: number;
                packSize: number;
                packLabel: string;
                sortIndex: number;
              };
            } => op !== null
          );

        for (
          let offset = 0;
          offset < normalizedOps.length;
          offset += SAFE_BATCH_CHUNK
        ) {
          const chunk = normalizedOps.slice(offset, offset + SAFE_BATCH_CHUNK);
          const batch = writeBatch(serverDb);
          for (const op of chunk) {
            const itemRef = doc(
              serverDb,
              'workspaces',
              workspaceId,
              'inventory',
              op.safeId
            );
            if (existingIds.has(op.safeId)) {
              batch.update(itemRef, {
                ...op.mutableFields,
                updatedAt: serverTimestamp(),
              });
            } else {
              batch.set(itemRef, {
                workspaceId,
                accountUsername,
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
          const delBatch = writeBatch(serverDb);
          for (const oldId of chunk) {
            delBatch.delete(
              doc(serverDb, 'workspaces', workspaceId, 'inventory', oldId)
            );
          }
          await delBatch.commit();
        }

        const mirror = activeMirrors.get(workspaceId);
        if (mirror) {
          mirror.inventory =
            normalizedOps.length > 0
              ? normalizedOps.map(({ safeId, createdAt, mutableFields }) => ({
                  id: safeId,
                  ...mutableFields,
                  createdAt,
                  updatedAt: nowISO,
                }))
              : null;
          mirror.version += 1;
        }

        res.json({ ok: true });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  app.put(
    '/api/cloud/workspaces/:workspaceId/inventory/:itemId',
    async (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      const itemId = sanitizeSafeId(String(req.params.itemId || ''), 'inv');
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      const body = (req.body || {}) as {
        accountUsername?: unknown;
        item?: Partial<InventoryItemPayload>;
      };
      const accountUsername = String(body.accountUsername || '').trim();
      if (!USERNAME_KEY_PATTERN.test(accountUsername)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_USERNAME',
          message: 'Tài khoản không hợp lệ.',
        });
        return;
      }

      const raw = body.item || {};
      const name = String(raw.name || '').trim().slice(0, 160);
      if (!name) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_INVENTORY_ITEM',
          message: 'Vui lòng nhập tên vật tư trong kho.',
        });
        return;
      }

      const isTape = /băng\s*keo/iu.test(name);
      const rawUnit = (String(raw.unit || '').trim() || 'Tấm').slice(0, 40);
      const normUnit = isTape && /^cuộn$/iu.test(rawUnit) ? 'Cây' : rawUnit;
      const rawPack = String(raw.packLabel || '').trim().slice(0, 120);
      const normPack = isTape
        ? rawPack.replace(/(^|[\s\d])cuộn(?=$|\s|[.,;)])/giu, '$1cây')
        : rawPack;

      const mutableFields = {
        name,
        unit: normUnit,
        quantity: clampInt(Number(raw.quantity) || 0, 0, 1_000_000),
        minThreshold: clampInt(Number(raw.minThreshold) || 0, 0, 1_000_000),
        packSize: clampInt(Number(raw.packSize) || 1, 1, 100_000),
        packLabel: normPack,
        sortIndex: clampInt(Number(raw.sortIndex) || 0, 0, 500),
      };

      try {
        const itemRef = doc(
          serverDb,
          'workspaces',
          workspaceId,
          'inventory',
          itemId
        );
        const existingSnap = await getDocFromServer(itemRef);
        const nowISO = new Date().toISOString();
        let createdAtISO = nowISO;

        if (!existingSnap.exists()) {
          await setDoc(itemRef, {
            workspaceId,
            accountUsername,
            ...mutableFields,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          createdAtISO = timestampToISO(
            existingSnap.data().createdAt,
            String(raw.createdAt || nowISO)
          );
          await updateDoc(itemRef, {
            ...mutableFields,
            updatedAt: serverTimestamp(),
          });
        }

        const mirror = activeMirrors.get(workspaceId);
        if (mirror) {
          const nextItem: InventoryItemPayload = {
            id: itemId,
            ...mutableFields,
            createdAt: createdAtISO,
            updatedAt: nowISO,
          };
          const currentList = mirror.inventory || [];
          mirror.inventory = [
            ...currentList.filter((i) => i.id !== itemId),
            nextItem,
          ].sort((a, b) => a.sortIndex - b.sortIndex);
          mirror.version += 1;
        }

        res.json({ ok: true, itemId });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  app.delete(
    '/api/cloud/workspaces/:workspaceId/inventory/:itemId',
    async (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      const itemId = sanitizeSafeId(String(req.params.itemId || ''), 'inv');
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      try {
        const itemRef = doc(
          serverDb,
          'workspaces',
          workspaceId,
          'inventory',
          itemId
        );
        const snap = await getDocFromServer(itemRef);
        if (snap.exists()) {
          await deleteDoc(itemRef);
        }

        const mirror = activeMirrors.get(workspaceId);
        if (mirror && mirror.inventory) {
          mirror.inventory = mirror.inventory.filter((i) => i.id !== itemId);
          mirror.version += 1;
        }

        res.json({ ok: true, deleted: snap.exists() });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  // 8D. Permanent Monthly Revenue Entries (/workspaces/{workspaceId}/revenueEntries/{entryId})
  app.put(
    '/api/cloud/workspaces/:workspaceId/revenue-entries/:entryId',
    async (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      const entryId = sanitizeSafeId(String(req.params.entryId || ''), 'rev');
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      const body = (req.body || {}) as {
        accountUsername?: unknown;
        entry?: Partial<RevenueEntryPayload>;
      };
      const accountUsername = String(body.accountUsername || '').trim();
      if (!USERNAME_KEY_PATTERN.test(accountUsername)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_USERNAME',
          message: 'Tài khoản không hợp lệ.',
        });
        return;
      }

      const raw = body.entry || {};
      const nowISO = new Date().toISOString();
      const rawOrderDate = String(raw.orderDate || '').trim();
      const orderDate = ORDER_DATE_PATTERN.test(rawOrderDate)
        ? rawOrderDate
        : nowISO.slice(0, 10);
      const monthKey = orderDate.slice(0, 7);
      if (!MONTH_KEY_PATTERN.test(monthKey)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_MONTH_KEY',
          message: 'Tháng báo cáo không hợp lệ.',
        });
        return;
      }

      const rawInvoiceId = String(raw.invoiceId || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 128);
      const safeInvoiceId = OPTIONAL_INVOICE_ID_PATTERN.test(rawInvoiceId)
        ? rawInvoiceId
        : '';

      const designAmount = clampMoney(Number(raw.designAmount) || 0);
      const printAmount = clampMoney(Number(raw.printAmount) || 0);
      const totalRevenue = designAmount + printAmount;

      const mutableFields = {
        invoiceCode: String(raw.invoiceCode || '').trim().slice(0, MAX_CODE_LEN),
        orderDate,
        monthKey,
        customerName:
          String(raw.customerName || '')
            .trim()
            .slice(0, MAX_CUSTOMER_NAME_LEN) || 'Khách lẻ',
        customerPhone: String(raw.customerPhone || '')
          .trim()
          .slice(0, MAX_CUSTOMER_PHONE_LEN),
        customerCode: String(raw.customerCode || '')
          .trim()
          .slice(0, MAX_CUSTOMER_CODE_LEN),
        designAmount,
        printAmount,
        totalRevenue,
        isManualOverride: Boolean(raw.isManualOverride),
        isDeleted: Boolean(raw.isDeleted),
        note: String(raw.note || '').slice(0, 500),
      };

      try {
        const entryRef = doc(
          serverDb,
          'workspaces',
          workspaceId,
          'revenueEntries',
          entryId
        );
        const existingSnap = await getDocFromServer(entryRef);
        let createdAtISO = nowISO;
        let persistedInvoiceId = safeInvoiceId;

        if (!existingSnap.exists()) {
          await setDoc(entryRef, {
            workspaceId,
            accountUsername,
            invoiceId: safeInvoiceId,
            ...mutableFields,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          const existingData = existingSnap.data();
          createdAtISO = timestampToISO(
            existingData.createdAt,
            String(raw.createdAt || nowISO)
          );
          persistedInvoiceId = String(existingData.invoiceId || '').slice(0, 128);
          await updateDoc(entryRef, {
            ...mutableFields,
            updatedAt: serverTimestamp(),
          });
        }

        const mirror = activeMirrors.get(workspaceId);
        if (mirror) {
          const nextEntry: RevenueEntryPayload = {
            id: entryId,
            invoiceId: persistedInvoiceId,
            ...mutableFields,
            createdAt: createdAtISO,
            updatedAt: nowISO,
          };
          mirror.revenueEntries = [
            ...mirror.revenueEntries.filter((e) => e.id !== entryId),
            nextEntry,
          ].sort((a, b) => {
            const dc = b.orderDate.localeCompare(a.orderDate);
            if (dc !== 0) return dc;
            return (
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            );
          });
          mirror.version += 1;
        }

        res.json({ ok: true, entryId });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  app.delete(
    '/api/cloud/workspaces/:workspaceId/revenue-entries/:entryId',
    async (req: Request, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '').trim();
      const entryId = sanitizeSafeId(String(req.params.entryId || ''), 'rev');
      if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        res.status(400).json({
          ok: false,
          code: 'INVALID_WORKSPACE_ID',
          message: 'Workspace ID không hợp lệ.',
        });
        return;
      }

      try {
        const entryRef = doc(
          serverDb,
          'workspaces',
          workspaceId,
          'revenueEntries',
          entryId
        );
        const snap = await getDocFromServer(entryRef);
        if (snap.exists()) {
          await deleteDoc(entryRef);
        }

        const mirror = activeMirrors.get(workspaceId);
        if (mirror) {
          mirror.revenueEntries = mirror.revenueEntries.filter(
            (e) => e.id !== entryId
          );
          mirror.version += 1;
        }

        res.json({ ok: true, deleted: snap.exists() });
      } catch (error) {
        const formatted = formatErrorPayload(error);
        res.status(formatted.status).json({ ok: false, ...formatted });
      }
    }
  );

  // 8E. Server-Side Gemini AI Chat Assistant (/api/ai/chat)
  // Circuit-breaker cooldown when upstream Gemini models return 503 UNAVAILABLE so subsequent chat messages respond in <10ms
  let geminiHighDemandUntilMs = 0;

  function withRaceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`UPSTREAM_TIMEOUT_${ms}MS`));
      }, ms);
      timer.unref?.();
      promise.then(
        (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  app.post('/api/ai/chat', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      res.status(200).json({
        ok: true,
        useSmartEngine: true,
        reason: 'MISSING_API_KEY',
      });
      return;
    }

    const body = (req.body || {}) as {
      messages?: { role?: unknown; text?: unknown }[];
      contextSummary?: unknown;
    };

    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const cleanedMessages = rawMessages
      .slice(-14)
      .map((m) => {
        const role: 'user' | 'model' = m.role === 'model' ? 'model' : 'user';
        const text = String(m.text || '').trim().slice(0, 3000);
        return { role, text };
      })
      .filter((m) => m.text.length > 0);

    if (
      cleanedMessages.length === 0 ||
      cleanedMessages[cleanedMessages.length - 1].role !== 'user'
    ) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_PROMPT',
        message: 'Vui lòng nhập nội dung câu hỏi cho trợ lý AI.',
      });
      return;
    }

    if (Date.now() < geminiHighDemandUntilMs) {
      res.status(200).json({
        ok: true,
        useSmartEngine: true,
        reason: 'COOLDOWN_503',
      });
      return;
    }

    const contextSummary =
      typeof body.contextSummary === 'string'
        ? body.contextSummary.trim().slice(0, 36000)
        : '';

    const systemInstruction = [
      'Bạn là Trợ lý AI điều hành đồng bộ 100% với hệ thống web Báo giá, Doanh thu, Tiến độ, Quỹ Voucher, Date Khách hàng & Kho hàng của ATD Color (thông tin công ty ở Mục 1). Trả lời tiếng Việt ngắn gọn, rõ ý, chính xác tuyệt đối từng đồng VNĐ (ví dụ: 15.000đ).',
      'NGUYÊN TẮC SỐ LIỆU BẮT BUỘC (KHÔNG ĐƯỢC SAI LỆCH):',
      '- Mọi con số về Doanh thu hôm nay, Doanh thu hôm qua, Doanh thu 7 ngày qua, Doanh thu tháng, Tiến độ 6 giai đoạn, Quỹ Voucher, Date Khách hàng, Tồn kho và Bill đang mở PHẢI lấy khớp 100% với số liệu đã đối soát sẵn trong "=== 0. KẾT QUẢ ĐỐI SOÁT CHÍNH XÁC TỪ HỆ THỐNG ===" và các mục dữ liệu thực tế bên dưới.',
      '- TUYỆT ĐỐI KHÔNG lấy nhầm "Doanh thu cả tháng" để trả lời khi người dùng hỏi "Doanh thu hôm nay" (hoặc hỏi theo ngày cụ thể / hôm qua / 7 ngày qua)! Nếu hôm nay chưa có đơn thành công nào (Doanh thu hôm nay = 0đ), phải báo đúng Doanh thu đơn thành công hôm nay = 0đ (kèm ghi chú số phiếu đang Báo giá/Chăm sóc chờ chốt hôm nay nếu có).',
      '- Trong hệ thống ATD Color: "Báo cáo doanh thu" ghi nhận chính xác theo 2 GIAI ĐOẠN THANH TOÁN thực tế của đơn hàng (sau giảm giá, không gồm phí ship, không chia tỷ lệ lẻ):',
      '  + Đợt 1 (Thanh toán Cọc): Khi đơn phát sinh tiền cọc (depositAmount > 0), hệ thống ghi nhận đúng số tiền cọc Đợt 1 vào doanh thu của NGÀY / THÁNG CỌC (ví dụ KH đặt 300k, cọc 150k ngày 31/10 -> Tháng 10 ghi nhận 150.000đ).',
      '  + Đợt 2 (Thanh toán Phần còn lại / Hoàn thành): Khi khách thanh toán phần còn lại và nhân viên tích "Đã thu phần còn lại" (hoặc bấm xác nhận trạng thái "Hoàn thành"), hệ thống ghi nhận phần doanh thu còn lại vào đúng NGÀY / THÁNG TẤT TOÁN ĐÓ (ví dụ thanh toán 150k còn lại vào ngày 01/11 -> Tháng 11 ghi nhận 150.000đ).',
      'Bạn nắm rõ toàn bộ 8 mục lớn & quy tắc trên web:',
      '1) Chọn & Báo giá (navigateTarget="workspace"): Có Bảng giá in ấn gửi khách gắn logo, chọn sản phẩm xong tự thêm dòng mới bên dưới đơn hàng (không cộng dồn), cột STT có nút Copy cả hàng, và có mục tích "Đã thu phần còn lại" + ngày thu.',
      '2) Báo giá đã lưu (navigateTarget="saved"): Danh sách tất cả báo giá đồng bộ đám mây, có ô tích nhanh "Đã thu phần còn lại" + chọn ngày thanh toán.',
      '3) Báo cáo: Doanh thu theo ngày / tháng theo 2 giai đoạn Cọc & Phần còn lại tách Tiền thiết kế / Tiền in lưu vĩnh viễn (navigateTarget="reports_revenue") & Phân loại tiến độ 6 giai đoạn lọc theo Hôm nay / 7 ngày / Tháng này / Tất cả kèm tích phần còn lại (navigateTarget="reports_pipeline").',
      '4) Kế Hoạch: (a) Quỹ Voucher tháng (navigateTarget="plan_voucher") — cứ phát sinh giảm khách từ 1.000đ trở lên (>= 1.000đ) là hệ thống tự động tính trừ thẳng đúng số tiền giảm đó vào Quỹ Voucher tháng ngay lập tức! (b) Danh sách Date Khách hàng hợp nhất (navigateTarget="plan_customers").',
      '5) Kho hàng: Quản lý tồn kho (navigateTarget="inventory_stock") & Bảng sản phẩm cần đặt 2 cột SẢN PHẨM ĐẶT | SỐ LƯỢNG ĐẶT (navigateTarget="inventory_reorder") — không có logo, không ghi = tờ; Băng keo (Băng Keo Trong, Băng Keo Nguy Hiểm) luôn tính là CÂY; giấy/nhựa/decal/formex tính là xấp; màng BOBB & chống sốc tính là cuộn.',
      '6) Xem bản in (navigateTarget="invoice"), 7) Sửa bảng giá (navigateTarget="catalog"), 8) Cài đặt chung (navigateTarget="settings").',
      '',
      'NHIỆM VỤ 1 — HỎI ĐÁP ĐỒNG BỘ & ĐIỀU HƯỚNG NHANH TRÊN WEB:',
      '- Trả lời chính xác 100% dựa trên dữ liệu thực tế. Điền đúng navigateTarget của mục liên quan ("reports_revenue", "reports_pipeline", "plan_voucher", "plan_customers", "inventory_reorder", "inventory_stock", "saved", "workspace", "invoice", "catalog", "settings") để hiện nút mở nhanh.',
      '- Chỉ đặt autoNavigate=true khi người dùng chủ động ra lệnh mở/chuyển trang (ví dụ: "mở báo cáo doanh thu", "mở bảng đặt hàng kho", "mở quỹ voucher"). Nếu chỉ hỏi thông tin thì đặt autoNavigate=false.',
      '',
      'NHIỆM VỤ 2 — ĐẶT HÀNG, GIẢM GIÁ VOUCHER (TỪ 1.000Đ), TÍCH PHẦN CÒN LẠI / HOÀN THÀNH & CẬP NHẬT BILL TRỰC TIẾP:',
      '- Bạn có thể vừa thêm sản phẩm mới vào bill, vừa áp dụng giảm giá cho khách (discountAmount >= 1000 sẽ tự trừ thẳng vào Quỹ Voucher!), cập nhật tiền cọc Đợt 1 (depositAmount), tích thanh toán phần còn lại Đợt 2 (markRemainingPaid="true" kèm remainingPaidAt="YYYY-MM-DD" và reportStage="hoan_thanh"), phí ship (shippingFee), tên/SĐT khách hoặc giai đoạn đơn (reportStage). Cũng có thể chỉ cập nhật tích phần còn lại / hoàn thành / giảm giá / tiền cọc cho bill hiện tại hoặc đơn đã lưu mà không thêm món mới (itemsToAdd = []).',
      '- Trường hợp A (Đề xuất chờ chốt — PROPOSE_ORDER): Khi người dùng yêu cầu đặt món hoặc giảm giá/tích phần còn lại/cập nhật bill NHƯNG chưa có từ xác nhận ("ok", "oke", "đồng ý", "chốt", "lưu luôn") -> đặt actionType="PROPOSE_ORDER", nêu rõ chi tiết và nhắc gõ "ok" hoặc bấm nút xác nhận.',
      '- Trường hợp B (Thực thi & đồng bộ ngay — EXECUTE_ORDER):',
      '  (1) Người dùng vừa ra lệnh vừa kèm từ xác nhận ngay trong câu (ví dụ: "đặt 1 menu ép nhựa và ok", "xác nhận hoàn thành đã thu phần còn lại đơn HD-3110-015 và ok", "giảm cho khách trên bill 20.000đ và ok") -> đặt actionType="EXECUTE_ORDER" ngay!',
      '  (2) Hoặc đang có mục "9. LỆNH ĐƠN HÀNG / GIẢM GIÁ ĐANG CHỜ XÁC NHẬN OK" và người dùng nhắn "ok", "oke", "ừ", "đồng ý", "chốt", "lưu luôn" -> đặt actionType="EXECUTE_ORDER" với đầy đủ thông tin!',
      '- QUY TẮC KHỚP SẢN PHẨM & BILL:',
      '  + Lấy đúng productId, name, unit, unitPrice từ "3. BẢNG GIÁ & DANH MỤC SẢN PHẨM". Nếu nói gọn "menu ép nhựa" / "ép nhựa" không nêu khổ/mặt -> mặc định productId="ep-2m-a4", name="Ép Nhựa - Plastic (A4 - 2 Mặt)", unit="Tờ", unitPrice=32000. Nếu "ép nhựa A3" -> productId="ep-2m-a3" (40.000đ). Nếu "decal formex" -> productId="fm-1m-a4" (88.000đ/Bảng).',
      '  + Mặc định tác động lên bill đang mở trên màn hình (targetSavedInvoiceId="", createNewBill=false). Nếu người dùng chỉ định rõ mã đơn hoặc tên/SĐT khách của một đơn trong "5. BÁO GIÁ ĐÃ LƯU" -> điền đúng targetSavedInvoiceId của đơn đó.',
      '  + discountAmount, shippingFee, depositAmount: đặt -1 nếu giữ nguyên không đổi; điền số VNĐ đầy đủ >= 0 khi người dùng yêu cầu (ví dụ "giảm 15k" -> discountAmount=15000, "bỏ giảm giá" -> discountAmount=0).',
      '  + markRemainingPaid: để "" nếu giữ nguyên; đặt "true" khi người dùng yêu cầu tích thanh toán phần còn lại hoặc xác nhận hoàn thành đơn (kèm reportStage="hoan_thanh"); đặt "false" nếu yêu cầu bỏ tích phần còn lại. remainingPaidAt: điền ngày "YYYY-MM-DD" nếu người dùng nêu ngày thanh toán phần còn lại, ngược lại để "".',
      contextSummary
        ? `\nDỮ LIỆU THỰC TẾ TOÀN HỆ THỐNG HIỆN TẠI:\n${contextSummary}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const contents = cleanedMessages.map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      }));

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          reply: {
            type: Type.STRING,
            description:
              'Câu trả lời tiếng Việt ngắn gọn, rõ ràng gửi cho người dùng.',
          },
          orderAction: {
            type: Type.OBJECT,
            properties: {
              actionType: {
                type: Type.STRING,
                description:
                  'Một trong 3 giá trị: NONE, PROPOSE_ORDER, EXECUTE_ORDER.',
              },
              targetSavedInvoiceId: {
                type: Type.STRING,
                description:
                  'ID đơn đã lưu nếu thao tác trên đơn khách khác trong Báo giá đã lưu; để "" nếu thao tác trên bill đang mở.',
              },
              createNewBill: {
                type: Type.BOOLEAN,
                description:
                  'true nếu người dùng yêu cầu tách lập bill mới hoàn toàn, mặc định false.',
              },
              customerName: {
                type: Type.STRING,
                description:
                  'Tên khách hàng mới nếu người dùng cung cấp, ngược lại để "".',
              },
              customerPhone: {
                type: Type.STRING,
                description:
                  'Số điện thoại khách hàng nếu người dùng cung cấp, ngược lại để "".',
              },
              discountAmount: {
                type: Type.NUMBER,
                description:
                  'Số tiền giảm giá VNĐ mới (>= 0, từ 1000 trở lên sẽ tự trừ vào Quỹ Voucher) nếu người dùng yêu cầu, hoặc -1 nếu giữ nguyên.',
              },
              shippingFee: {
                type: Type.NUMBER,
                description:
                  'Phí ship VNĐ mới (>= 0) nếu người dùng yêu cầu, hoặc -1 nếu giữ nguyên.',
              },
              depositAmount: {
                type: Type.NUMBER,
                description:
                  'Tiền cọc VNĐ mới (>= 0) nếu người dùng yêu cầu, hoặc -1 nếu giữ nguyên.',
              },
              reportStage: {
                type: Type.STRING,
                description:
                  'Giai đoạn báo cáo mới nếu người dùng chỉ định (bao_gia, cham_soc, coc, chot_in, chot_thiet_ke, hoan_thanh), ngược lại để "".',
              },
              markRemainingPaid: {
                type: Type.STRING,
                description:
                  '"" nếu giữ nguyên, "true" nếu tích Đã thu phần còn lại / Hoàn thành, "false" nếu bỏ tích.',
              },
              remainingPaidAt: {
                type: Type.STRING,
                description:
                  'Ngày thanh toán phần còn lại định dạng YYYY-MM-DD nếu người dùng chỉ định, ngược lại để "".',
              },
              navigateTarget: {
                type: Type.STRING,
                description:
                  'Màn hình liên quan trên web ("", "workspace", "saved", "reports_revenue", "reports_pipeline", "plan_voucher", "plan_customers", "inventory_stock", "inventory_reorder", "invoice", "catalog", "settings").',
              },
              autoNavigate: {
                type: Type.BOOLEAN,
                description:
                  'true chỉ khi người dùng yêu cầu mở/chuyển sang màn hình đó ngay lập tức; mặc định false.',
              },
              itemsToAdd: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    productId: {
                      type: Type.STRING,
                      description:
                        'Mã productId từ bảng giá (ví dụ ep-2m-a4), hoặc "" nếu là món thiết kế/tự chỉnh.',
                    },
                    name: {
                      type: Type.STRING,
                      description: 'Tên sản phẩm hiển thị trên hóa đơn.',
                    },
                    unit: {
                      type: Type.STRING,
                      description: 'Đơn vị tính (Tờ, Bảng, Mẫu, Mục, Cái).',
                    },
                    quantity: {
                      type: Type.NUMBER,
                      description: 'Số lượng cần thêm (>= 1).',
                    },
                    unitPrice: {
                      type: Type.NUMBER,
                      description: 'Đơn giá VNĐ (>= 0).',
                    },
                    note: {
                      type: Type.STRING,
                      description: 'Ghi chú kèm theo dòng sản phẩm nếu có.',
                    },
                  },
                  required: [
                    'productId',
                    'name',
                    'unit',
                    'quantity',
                    'unitPrice',
                    'note',
                  ],
                },
              },
            },
            required: [
              'actionType',
              'targetSavedInvoiceId',
              'createNewBill',
              'customerName',
              'customerPhone',
              'discountAmount',
              'shippingFee',
              'depositAmount',
              'reportStage',
              'markRemainingPaid',
              'remainingPaidAt',
              'navigateTarget',
              'autoNavigate',
              'itemsToAdd',
            ],
          },
        },
        required: ['reply', 'orderAction'],
      };

      let rawText = '';
      try {
        const primaryRes = await withRaceTimeout(
          ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents,
            config: {
              systemInstruction,
              thinkingConfig: {
                thinkingLevel: ThinkingLevel.LOW,
              },
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
          4200
        );
        rawText = (primaryRes.text ?? '').trim();
      } catch {
        const secondaryRes = await withRaceTimeout(
          ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
          3000
        );
        rawText = (secondaryRes.text ?? '').trim();
      }

      geminiHighDemandUntilMs = 0;

      if (!rawText) {
        res.status(200).json({
          ok: true,
          useSmartEngine: true,
          reason: 'EMPTY_AI_RESPONSE',
        });
        return;
      }

      const VALID_NAV_TARGETS = new Set([
        '',
        'workspace',
        'saved',
        'reports_revenue',
        'reports_pipeline',
        'plan_voucher',
        'plan_customers',
        'inventory_stock',
        'inventory_reorder',
        'invoice',
        'catalog',
        'settings',
      ]);

      let reply = rawText;
      let orderAction: {
        actionType: 'NONE' | 'PROPOSE_ORDER' | 'EXECUTE_ORDER';
        targetSavedInvoiceId: string;
        createNewBill: boolean;
        customerName: string;
        customerPhone: string;
        discountAmount: number;
        shippingFee: number;
        depositAmount: number;
        reportStage: string;
        markRemainingPaid: boolean | null;
        remainingPaidAt: string;
        navigateTarget: string;
        autoNavigate: boolean;
        itemsToAdd: {
          productId: string;
          name: string;
          unit: string;
          quantity: number;
          unitPrice: number;
          note: string;
        }[];
      } = {
        actionType: 'NONE',
        targetSavedInvoiceId: '',
        createNewBill: false,
        customerName: '',
        customerPhone: '',
        discountAmount: -1,
        shippingFee: -1,
        depositAmount: -1,
        reportStage: '',
        markRemainingPaid: null,
        remainingPaidAt: '',
        navigateTarget: '',
        autoNavigate: false,
        itemsToAdd: [],
      };

      try {
        const parsed = JSON.parse(rawText) as {
          reply?: unknown;
          orderAction?: Record<string, unknown>;
        };
        if (typeof parsed.reply === 'string' && parsed.reply.trim()) {
          reply = parsed.reply.trim();
        }
        if (parsed.orderAction && typeof parsed.orderAction === 'object') {
          const oa = parsed.orderAction;
          const rawType = String(oa.actionType || 'NONE').toUpperCase();
          const actionType: 'NONE' | 'PROPOSE_ORDER' | 'EXECUTE_ORDER' =
            rawType === 'EXECUTE_ORDER'
              ? 'EXECUTE_ORDER'
              : rawType === 'PROPOSE_ORDER'
                ? 'PROPOSE_ORDER'
                : 'NONE';

          const rawItems = Array.isArray(oa.itemsToAdd) ? oa.itemsToAdd : [];
          const sanitizedItems = rawItems
            .map((it) => {
              const obj = (it || {}) as Record<string, unknown>;
              const name = String(obj.name || '').trim().slice(0, 200);
              const qty = Math.max(1, Math.round(Number(obj.quantity) || 1));
              const unitPrice = Math.max(
                0,
                Math.round(Number(obj.unitPrice) || 0)
              );
              return {
                productId: String(obj.productId || '').trim().slice(0, 80),
                name,
                unit: String(obj.unit || 'Tờ').trim().slice(0, 40) || 'Tờ',
                quantity: qty,
                unitPrice,
                note: String(obj.note || '').trim().slice(0, 300),
              };
            })
            .filter((it) => it.name.length > 0 || it.productId.length > 0);

          const rawNav = String(oa.navigateTarget || '').trim();
          const safeNav = VALID_NAV_TARGETS.has(rawNav) ? rawNav : '';

          const rawMarkRem = String(oa.markRemainingPaid ?? '')
            .trim()
            .toLowerCase();
          const parsedMarkRemainingPaid: boolean | null =
            rawMarkRem === 'true'
              ? true
              : rawMarkRem === 'false'
                ? false
                : typeof oa.markRemainingPaid === 'boolean'
                  ? oa.markRemainingPaid
                  : null;
          const parsedRemainingPaidAt = sanitizeOptionalServerOrderDate(
            oa.remainingPaidAt
          );

          orderAction = {
            actionType:
              sanitizedItems.length === 0 &&
              Number(oa.discountAmount ?? -1) < 0 &&
              Number(oa.shippingFee ?? -1) < 0 &&
              Number(oa.depositAmount ?? -1) < 0 &&
              !String(oa.customerName || '').trim() &&
              !String(oa.customerPhone || '').trim() &&
              !String(oa.reportStage || '').trim() &&
              parsedMarkRemainingPaid === null
                ? 'NONE'
                : actionType,
            targetSavedInvoiceId: String(oa.targetSavedInvoiceId || '')
              .trim()
              .slice(0, 128),
            createNewBill: Boolean(oa.createNewBill),
            customerName: String(oa.customerName || '').trim().slice(0, 120),
            customerPhone: String(oa.customerPhone || '').trim().slice(0, 40),
            discountAmount:
              typeof oa.discountAmount === 'number' && oa.discountAmount >= 0
                ? Math.round(oa.discountAmount)
                : -1,
            shippingFee:
              typeof oa.shippingFee === 'number' && oa.shippingFee >= 0
                ? Math.round(oa.shippingFee)
                : -1,
            depositAmount:
              typeof oa.depositAmount === 'number' && oa.depositAmount >= 0
                ? Math.round(oa.depositAmount)
                : -1,
            reportStage: String(oa.reportStage || '').trim().slice(0, 40),
            markRemainingPaid: parsedMarkRemainingPaid,
            remainingPaidAt: parsedRemainingPaidAt,
            navigateTarget: safeNav,
            autoNavigate: Boolean(oa.autoNavigate) && Boolean(safeNav),
            itemsToAdd: sanitizedItems,
          };
        }
      } catch {
        // Fallback if model returned plain text despite responseMimeType
      }

      res.status(200).json({ ok: true, reply, orderAction });
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      const lower = rawMsg.toLowerCase();
      if (
        lower.includes('503') ||
        lower.includes('unavailable') ||
        lower.includes('high demand') ||
        lower.includes('upstream_timeout') ||
        lower.includes('429') ||
        lower.includes('resource_exhausted')
      ) {
        geminiHighDemandUntilMs = Date.now() + 20_000;
      }
      // Always return HTTP 200 JSON so Nginx proxy_intercept_errors NEVER swaps to HTML
      res.status(200).json({
        ok: true,
        useSmartEngine: true,
        reason: 'UPSTREAM_FALLBACK',
      });
    }
  });

  // 9. Read-Only Pre-Account Legacy Invoices for Optional 1-Click Migration
  app.get('/api/cloud/legacy-invoices', async (_req: Request, res: Response) => {
    try {
      const legacySnap = await getDocs(
        query(collection(serverDb, 'invoices'), where('itemCount', '>=', 1))
      );

      const invoices: SavedInvoicePayload[] = [];
      for (const invDoc of legacySnap.docs) {
        const data = invDoc.data();
        const itemsSnap = await getDocs(
          query(
            collection(serverDb, 'invoices', invDoc.id, 'items'),
            where('invoiceId', '==', invDoc.id)
          )
        );
        const items = itemsSnap.docs
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

        if (items.length === 0) continue;
        const fallbackNow = new Date().toISOString();
        const discountAmount = Number(data.discountAmount) || 0;
        const shippingFee = Number(data.shippingFee) || 0;
        const depositAmount = Number(data.depositAmount) || 0;
        const totals = computeTotals(
          items,
          discountAmount,
          shippingFee,
          depositAmount
        );

        invoices.push({
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
              : '',
          invoiceNote: String(data.invoiceNote || ''),
          totals,
          syncedToCloud: false,
          syncedOwnerUid: undefined,
        });
      }

      res.json({ ok: true, invoices });
    } catch (error) {
      const formatted = formatErrorPayload(error);
      res.status(formatted.status).json({ ok: false, ...formatted });
    }
  });

  // Guarantee JSON responses for any unmatched /api/* routes or malformed JSON bodies
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({
      ok: false,
      code: 'API_NOT_FOUND',
      message: 'Đường dẫn API không tồn tại.',
    });
  });

  app.use(
    (err: unknown, req: Request, res: Response, next: NextFunction): void => {
      if (req.path.startsWith('/api')) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(400).json({
          ok: false,
          code: 'BAD_API_REQUEST',
          message: `Yêu cầu không hợp lệ: ${msg}`,
        });
        return;
      }
      next(err);
    }
  );

  // Determine dev vs production serving
  const distPath = path.join(rootDir, 'dist');
  const distIndexHtml = path.join(distPath, 'index.html');
  const isDev =
    process.env.NODE_ENV === 'development' ||
    (process.env.NODE_ENV !== 'production' && !fs.existsSync(distIndexHtml));

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: !disableHmr,
        watch: disableHmr
          ? null
          : {
              ignored: ['**/.data/**'],
            },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(distIndexHtml);
    });
  }

  // Keep doc(serverDb) import referenced cleanly
  void getDoc;

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`ATD Color server listening on http://0.0.0.0:${port}`);
  });
}

void startServer();

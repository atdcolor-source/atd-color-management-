import {
  CAT_DESIGN_SURCHARGE,
  CAT_FORMEX,
  CAT_MENU_DESIGN,
  CAT_PLASTIC,
  LEGACY_CAT_MENU_DESIGN,
} from '../data/initialData';
import { Product, QuoteItem, RevenueEntry, SavedInvoice } from '../types';
import { sanitizeSafeId } from '../services/invoiceStorage';
import { auditInvoiceVoucher } from './voucherAudit';

export const MAX_REVENUE_PART = 10_000_000_000;

const SUCCESSFUL_STAGES = new Set<string>([
  'coc',
  'chot_in',
  'chot_thiet_ke',
  'hoan_thanh',
]);

const DESIGN_CATEGORY_RE = /thiết\s*kế|thiet\s*ke|design/iu;

const PRINT_LEADING_RE =
  /^(?:in\s+|ép\s*nhựa|ep\s*nhua|plastic\b|formex\b|foxmex\b|fomex\b|decal\b|cán\s*màng|đóng\s*lò\s*xo|bấm\s*kim)/iu;

const DESIGN_ITEM_NAME_RE =
  /(?:thiết\s*kế|thiet\s*ke|design|phụ\s*phí\s*chỉnh\s*sửa|phu\s*phi\s*chinh\s*sua|chỉnh\s*sửa\s*file|chinh\s*sua\s*file|sửa\s*file|sua\s*file|vẽ\s*lại|ve\s*lai|vẽ\s*logo|ve\s*logo|phí\s*demo|demo\s*mẫu)/iu;

const GENERIC_CUSTOMER_NAMES = new Set<string>([
  '',
  'khách lẻ',
  'khach le',
  'khách hàng',
  'khach hang',
  'khách',
  'khach',
]);

export function clampRevenuePart(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.min(MAX_REVENUE_PART, Math.max(0, Math.round(val))) + 0;
}

export function getCurrentMonthKeyLocal(date = new Date()): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

export function isoTimestampToLocalOrderDate(isoStr: string): string {
  if (typeof isoStr === 'string') {
    const directMatch = isoStr
      .trim()
      .match(/^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/);
    if (directMatch) {
      return `${directMatch[1]}-${directMatch[2]}-${directMatch[3]}`;
    }
  }
  const parsed = new Date(isoStr);
  const valid = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const yyyy = String(valid.getFullYear());
  const mm = String(valid.getMonth() + 1).padStart(2, '0');
  const dd = String(valid.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function sanitizeOptionalOrderDate(rawDate: unknown): string {
  if (typeof rawDate !== 'string') return '';
  const candidate = rawDate.trim();
  if (!candidate) return '';
  const match = candidate.match(
    /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/
  );
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const maxDay = new Date(year, month, 0).getDate();
  const safeDay = String(Math.min(day, maxDay)).padStart(2, '0');
  return `${match[1]}-${match[2]}-${safeDay}`;
}

export function normalizeOrderDateString(
  rawDate: string | undefined | null,
  fallbackDate?: string
): string {
  const valid = sanitizeOptionalOrderDate(rawDate);
  if (valid) return valid;
  if (fallbackDate && fallbackDate !== rawDate) {
    const validFallback = sanitizeOptionalOrderDate(fallbackDate);
    if (validFallback) return validFallback;
  }
  return isoTimestampToLocalOrderDate(new Date().toISOString());
}

export function getMonthDateRangeVN(monthKey: string): {
  monthKey: string;
  monthLabel: string;
  startISO: string;
  endISO: string;
  startVN: string;
  endVN: string;
  rangeVN: string;
} {
  const match = String(monthKey || '')
    .trim()
    .match(/^([0-9]{4})-(0[1-9]|1[0-2])$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const month = match ? Number(match[2]) : now.getMonth() + 1;
  const mm = String(month).padStart(2, '0');
  const yyyy = String(year);
  const lastDay = String(new Date(year, month, 0).getDate()).padStart(2, '0');

  const safeMonthKey = `${yyyy}-${mm}`;
  const startISO = `${yyyy}-${mm}-01`;
  const endISO = `${yyyy}-${mm}-${lastDay}`;
  const startVN = `01/${mm}/${yyyy}`;
  const endVN = `${lastDay}/${mm}/${yyyy}`;

  return {
    monthKey: safeMonthKey,
    monthLabel: `Tháng ${mm}/${yyyy}`,
    startISO,
    endISO,
    startVN,
    endVN,
    rangeVN: `${startVN} – ${endVN}`,
  };
}

export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const match = String(monthKey || '')
    .trim()
    .match(/^([0-9]{4})-(0[1-9]|1[0-2])$/);
  const base = match
    ? new Date(Number(match[1]), Number(match[2]) - 1 + deltaMonths, 1)
    : new Date();
  return getCurrentMonthKeyLocal(base);
}

export function isDesignQuoteItem(
  item: QuoteItem,
  productById: Map<string, Product>
): boolean {
  if (item.productId) {
    const catalogProd = productById.get(item.productId);
    if (catalogProd) {
      const cat = (catalogProd.category || '').trim();
      if (
        cat === CAT_MENU_DESIGN ||
        cat === LEGACY_CAT_MENU_DESIGN ||
        cat === CAT_DESIGN_SURCHARGE ||
        DESIGN_CATEGORY_RE.test(cat)
      ) {
        return true;
      }
      if (cat === CAT_PLASTIC || cat === CAT_FORMEX) {
        return false;
      }
    }
  }

  const name = (item.name || '').trim();
  if (!name) return false;
  if (PRINT_LEADING_RE.test(name)) {
    return false;
  }
  return DESIGN_ITEM_NAME_RE.test(name);
}

export function isInvoiceRemainingSettled(
  invoice: Pick<
    SavedInvoice,
    'remainingPaid' | 'reportStage' | 'depositAmount' | 'totals'
  >
): boolean {
  if (Boolean(invoice.remainingPaid)) return true;
  const stage = String(invoice.reportStage || '').trim();
  if (stage === 'hoan_thanh' && invoice.remainingPaid !== false) {
    return true;
  }
  const rem = clampRevenuePart(invoice.totals?.remainingAmount ?? 0);
  const dep = clampRevenuePart(
    invoice.totals?.depositAmount ?? invoice.depositAmount ?? 0
  );
  if (rem === 0 && dep > 0) {
    return true;
  }
  return false;
}

export function hasCollectibleRemainingBalance(
  invoice: Pick<SavedInvoice, 'totals'>
): boolean {
  return clampRevenuePart(invoice.totals?.remainingAmount ?? 0) > 0;
}

export function getInvoiceRemainingPaidDate(
  invoice: Pick<SavedInvoice, 'remainingPaidAt' | 'updatedAt' | 'createdAt'>
): string {
  const explicit = sanitizeOptionalOrderDate(invoice.remainingPaidAt);
  if (explicit) return explicit;
  return isoTimestampToLocalOrderDate(invoice.updatedAt || invoice.createdAt);
}

export function getUncollectedRemainingAmount(
  invoice: Pick<
    SavedInvoice,
    'remainingPaid' | 'reportStage' | 'depositAmount' | 'totals'
  >
): number {
  if (isInvoiceRemainingSettled(invoice)) return 0;
  return clampRevenuePart(invoice.totals?.remainingAmount ?? 0);
}

export function getCollectedCashAmount(
  invoice: Pick<
    SavedInvoice,
    'remainingPaid' | 'reportStage' | 'depositAmount' | 'totals'
  >
): number {
  const dep = clampRevenuePart(
    invoice.totals?.depositAmount ?? invoice.depositAmount ?? 0
  );
  const rem = clampRevenuePart(invoice.totals?.remainingAmount ?? 0);
  return isInvoiceRemainingSettled(invoice) ? dep + rem : dep;
}

export function isSuccessfulOrderForRevenue(
  invoice: SavedInvoice,
  storeFooterNote?: string
): boolean {
  if (!invoice || !Array.isArray(invoice.items) || invoice.items.length === 0) {
    return false;
  }
  if (invoice.remainingPaid) {
    return true;
  }
  const stage = String(invoice.reportStage || '').trim();
  if (SUCCESSFUL_STAGES.has(stage)) {
    return true;
  }
  const audit = auditInvoiceVoucher(invoice, storeFooterNote);
  return audit.isCoc;
}

export function splitInvoiceRevenue(
  invoice: SavedInvoice,
  catalogProducts: Product[]
): {
  designAmount: number;
  printAmount: number;
  totalRevenue: number;
  summaryNote: string;
} {
  const productById = new Map<string, Product>();
  for (const p of catalogProducts) {
    productById.set(p.id, p);
  }

  let grossDesign = 0;
  let grossPrint = 0;
  let negativeLineAdjust = 0;

  for (const item of invoice.items || []) {
    const qty = Math.max(0, Math.round(Number(item.quantity) || 0));
    const unitPrice = Math.round(Number(item.unitPrice) || 0);
    if (qty <= 0 || unitPrice === 0) continue;

    if (unitPrice < 0) {
      negativeLineAdjust += Math.abs(qty * unitPrice);
      continue;
    }

    const lineAmount = qty * unitPrice;
    if (isDesignQuoteItem(item, productById)) {
      grossDesign += lineAmount;
    } else {
      grossPrint += lineAmount;
    }
  }

  const headerDiscount = Math.max(
    0,
    Math.round(invoice.totals?.discountAmount ?? invoice.discountAmount ?? 0)
  );
  const totalDiscount = headerDiscount + Math.round(negativeLineAdjust);
  const grossTotal = grossDesign + grossPrint;

  if (grossTotal <= 0) {
    return {
      designAmount: 0,
      printAmount: 0,
      totalRevenue: 0,
      summaryNote: '',
    };
  }

  // Exact non-prorated deduction: deduct voucher/order discount from Design first,
  // and only deduct any overflow beyond grossDesign from Print so item prices stay 100% exact.
  const designDiscount = Math.min(grossDesign, totalDiscount);
  const designAmount = clampRevenuePart(Math.max(0, grossDesign - designDiscount));
  const remainingDiscount = Math.max(0, totalDiscount - designDiscount);
  const printAmount = clampRevenuePart(
    Math.max(0, grossPrint - remainingDiscount)
  );

  const totalRevenue = designAmount + printAmount;
  const itemSummary = (invoice.items || [])
    .slice(0, 4)
    .map((i) => `${i.name.trim()} (x${Math.max(1, Math.round(Number(i.quantity) || 1))})`)
    .join(', ')
    .slice(0, 420);

  return {
    designAmount,
    printAmount,
    totalRevenue,
    summaryNote: itemSummary,
  };
}

export function buildRevenueEntryIdForInvoice(invoiceId: string): string {
  const safeInvId = sanitizeSafeId(invoiceId, 'inv').slice(0, 120);
  return sanitizeSafeId(`rev_${safeInvId}`, 'rev');
}

export function buildRemainingRevenueEntryIdForInvoice(
  invoiceId: string
): string {
  const safeInvId = sanitizeSafeId(invoiceId, 'inv').slice(0, 116);
  return sanitizeSafeId(`rev_rem_${safeInvId}`, 'rev');
}

export function isRemainingStageRevenueEntry(
  entry: Pick<RevenueEntry, 'id' | 'note'>
): boolean {
  return (
    entry.id.startsWith('rev_rem_') ||
    String(entry.note || '').startsWith('[Đợt 2')
  );
}

export function getRevenueEntryPaymentBadge(
  entry: Pick<RevenueEntry, 'id' | 'invoiceId' | 'note'>
): string {
  if (!entry.invoiceId) return 'Nhập tay';
  const note = String(entry.note || '');
  if (entry.id.startsWith('rev_rem_') || note.startsWith('[Đợt 2')) {
    return 'Đợt 2 · Phần còn lại';
  }
  if (note.startsWith('[Đợt 1')) {
    return 'Đợt 1 · Tiền cọc';
  }
  if (note.startsWith('[Thu đủ') || note.startsWith('[Hoàn thành')) {
    return 'Thu đủ 100%';
  }
  return 'Đơn chốt';
}

export function stripStagePrefixFromRevenueNote(note: string): string {
  return String(note || '')
    .replace(
      /^\[(?:Đợt\s*1\s*-\s*Tiền\s*cọc|Đợt\s*2\s*-\s*Phần\s*còn\s*lại|Thu\s*đủ|Hoàn\s*thành\s*-\s*Thu\s*đủ)\]\s*/iu,
      ''
    )
    .trim();
}

export interface TwoStageRevenueBreakdown {
  fullDesign: number;
  fullPrint: number;
  fullTotal: number;
  summaryNote: string;
  hasStage1: boolean;
  stage1Date: string;
  stage1Design: number;
  stage1Print: number;
  stage1Total: number;
  stage1Note: string;
  hasStage2: boolean;
  isStage2Settled: boolean;
  stage2Date: string;
  stage2Design: number;
  stage2Print: number;
  stage2Total: number;
  stage2Note: string;
}

export function computeTwoStageInvoiceRevenue(
  invoice: SavedInvoice,
  catalogProducts: Product[]
): TwoStageRevenueBreakdown {
  const split = splitInvoiceRevenue(invoice, catalogProducts);
  const fullDesign = split.designAmount;
  const fullPrint = split.printAmount;
  const fullTotal = split.totalRevenue;
  const summaryNote = split.summaryNote;

  const rawDeposit = clampRevenuePart(
    invoice.totals?.depositAmount ?? invoice.depositAmount ?? 0
  );
  const depositDate = isoTimestampToLocalOrderDate(invoice.createdAt);
  const settlementDate = getInvoiceRemainingPaidDate(invoice);
  const settled = isInvoiceRemainingSettled(invoice);

  if (fullTotal <= 0) {
    return {
      fullDesign: 0,
      fullPrint: 0,
      fullTotal: 0,
      summaryNote,
      hasStage1: false,
      stage1Date: depositDate,
      stage1Design: 0,
      stage1Print: 0,
      stage1Total: 0,
      stage1Note: '',
      hasStage2: false,
      isStage2Settled: false,
      stage2Date: settlementDate,
      stage2Design: 0,
      stage2Print: 0,
      stage2Total: 0,
      stage2Note: '',
    };
  }

  if (rawDeposit > 0) {
    const stage1Total = clampRevenuePart(Math.min(fullTotal, rawDeposit));
    const stage1Design = clampRevenuePart(Math.min(fullDesign, stage1Total));
    const stage1Print = clampRevenuePart(Math.max(0, stage1Total - stage1Design));

    const stage2Design = clampRevenuePart(Math.max(0, fullDesign - stage1Design));
    const stage2Print = clampRevenuePart(Math.max(0, fullPrint - stage1Print));
    const stage2Total = stage2Design + stage2Print;
    const hasStage2 = stage2Total > 0;

    const stage1Prefix = hasStage2 ? '[Đợt 1 - Tiền cọc]' : '[Thu đủ]';
    const stage1Note = `${stage1Prefix} ${summaryNote}`.trim().slice(0, 500);
    const stage2Note = `[Đợt 2 - Phần còn lại] ${summaryNote}`
      .trim()
      .slice(0, 500);

    return {
      fullDesign,
      fullPrint,
      fullTotal,
      summaryNote,
      hasStage1: stage1Total > 0,
      stage1Date: depositDate,
      stage1Design,
      stage1Print,
      stage1Total,
      stage1Note,
      hasStage2,
      isStage2Settled: hasStage2 && settled,
      stage2Date: settlementDate,
      stage2Design,
      stage2Print,
      stage2Total,
      stage2Note,
    };
  }

  // Zero-deposit order: revenue is booked in full on settlementDate once settled (Hoàn thành / Đã thu phần còn lại)
  const fullSettledNote = `[Hoàn thành - Thu đủ] ${summaryNote}`
    .trim()
    .slice(0, 500);

  if (settled) {
    return {
      fullDesign,
      fullPrint,
      fullTotal,
      summaryNote,
      hasStage1: true,
      stage1Date: settlementDate,
      stage1Design: fullDesign,
      stage1Print: fullPrint,
      stage1Total: fullTotal,
      stage1Note: fullSettledNote,
      hasStage2: false,
      isStage2Settled: false,
      stage2Date: settlementDate,
      stage2Design: 0,
      stage2Print: 0,
      stage2Total: 0,
      stage2Note: '',
    };
  }

  return {
    fullDesign,
    fullPrint,
    fullTotal,
    summaryNote,
    hasStage1: false,
    stage1Date: depositDate,
    stage1Design: 0,
    stage1Print: 0,
    stage1Total: 0,
    stage1Note: '',
    hasStage2: true,
    isStage2Settled: false,
    stage2Date: settlementDate,
    stage2Design: fullDesign,
    stage2Print: fullPrint,
    stage2Total: fullTotal,
    stage2Note: fullSettledNote,
  };
}

function buildSingleStageEntry(params: {
  id: string;
  invoice: SavedInvoice;
  targetDate: string;
  targetDesign: number;
  targetPrint: number;
  targetNote: string;
  existing?: RevenueEntry;
  forceRestoreDeleted?: boolean;
}): RevenueEntry {
  const {
    id,
    invoice,
    targetDate,
    targetDesign,
    targetPrint,
    targetNote,
    existing,
    forceRestoreDeleted,
  } = params;

  const orderDate = existing?.isManualOverride
    ? normalizeOrderDateString(existing.orderDate)
    : normalizeOrderDateString(targetDate);
  const monthKey = orderDate.slice(0, 7);

  const nowMs = Date.now();
  const prevMs = existing?.updatedAt
    ? new Date(existing.updatedAt).getTime()
    : 0;
  const nowISO = new Date(
    Math.max(nowMs, (Number.isFinite(prevMs) ? prevMs : 0) + 1000)
  ).toISOString();

  const designAmount = existing?.isManualOverride
    ? clampRevenuePart(existing.designAmount)
    : targetDesign;
  const printAmount = existing?.isManualOverride
    ? clampRevenuePart(existing.printAmount)
    : targetPrint;

  return {
    id: existing?.id || id,
    invoiceId: sanitizeSafeId(invoice.id, 'inv'),
    invoiceCode: (invoice.code || '').trim().slice(0, 40),
    orderDate,
    monthKey,
    customerName:
      (invoice.customer?.name || '').trim().slice(0, 120) || 'Khách lẻ',
    customerPhone: (invoice.customer?.phone || '').trim().slice(0, 30),
    customerCode: (invoice.customer?.code || '').trim().slice(0, 30),
    designAmount,
    printAmount,
    totalRevenue: designAmount + printAmount,
    isManualOverride: Boolean(existing?.isManualOverride),
    isDeleted: forceRestoreDeleted ? false : Boolean(existing?.isDeleted),
    note: existing?.isManualOverride
      ? (existing.note || '').slice(0, 500)
      : targetNote.slice(0, 500),
    createdAt: existing?.createdAt || invoice.createdAt || nowISO,
    updatedAt: nowISO,
  };
}

export function buildStageRevenueEntriesFromInvoice(
  invoice: SavedInvoice,
  catalogProducts: Product[],
  existingStage1?: RevenueEntry,
  existingStage2?: RevenueEntry,
  options?: { forceRestoreStage2?: boolean; forceRestoreStage1?: boolean }
): {
  breakdown: TwoStageRevenueBreakdown;
  stage1Candidate: RevenueEntry | null;
  stage2Candidate: RevenueEntry | null;
} {
  const breakdown = computeTwoStageInvoiceRevenue(invoice, catalogProducts);

  const stage1Candidate = breakdown.hasStage1
    ? buildSingleStageEntry({
        id: buildRevenueEntryIdForInvoice(invoice.id),
        invoice,
        targetDate: breakdown.stage1Date,
        targetDesign: breakdown.stage1Design,
        targetPrint: breakdown.stage1Print,
        targetNote: breakdown.stage1Note,
        existing: existingStage1,
        forceRestoreDeleted: options?.forceRestoreStage1,
      })
    : null;

  const stage2Candidate =
    breakdown.hasStage2 && breakdown.isStage2Settled
      ? buildSingleStageEntry({
          id: buildRemainingRevenueEntryIdForInvoice(invoice.id),
          invoice,
          targetDate: breakdown.stage2Date,
          targetDesign: breakdown.stage2Design,
          targetPrint: breakdown.stage2Print,
          targetNote: breakdown.stage2Note,
          existing: existingStage2,
          forceRestoreDeleted: options?.forceRestoreStage2,
        })
      : null;

  return {
    breakdown,
    stage1Candidate,
    stage2Candidate,
  };
}

export function buildRevenueEntryFromInvoice(
  invoice: SavedInvoice,
  catalogProducts: Product[],
  existing?: RevenueEntry
): RevenueEntry {
  const breakdown = computeTwoStageInvoiceRevenue(invoice, catalogProducts);
  if (breakdown.hasStage1) {
    return buildSingleStageEntry({
      id: buildRevenueEntryIdForInvoice(invoice.id),
      invoice,
      targetDate: breakdown.stage1Date,
      targetDesign: breakdown.stage1Design,
      targetPrint: breakdown.stage1Print,
      targetNote: breakdown.stage1Note,
      existing,
    });
  }
  return buildSingleStageEntry({
    id: buildRevenueEntryIdForInvoice(invoice.id),
    invoice,
    targetDate: breakdown.stage2Date,
    targetDesign: breakdown.fullDesign,
    targetPrint: breakdown.fullPrint,
    targetNote: breakdown.stage2Note || breakdown.summaryNote,
    existing,
  });
}

export function countDistinctOrdersInEntries(entries: RevenueEntry[]): number {
  const seenOrderKeys = new Set<string>();
  for (const entry of entries) {
    if (entry.isDeleted) continue;
    if (entry.invoiceId) {
      seenOrderKeys.add(`inv:${entry.invoiceId}`);
    } else {
      seenOrderKeys.add(`man:${entry.id}`);
    }
  }
  return seenOrderKeys.size;
}

export function countDistinctCustomersInEntries(
  entries: RevenueEntry[]
): number {
  const seenKeys = new Set<string>();
  for (const entry of entries) {
    if (entry.isDeleted) continue;
    const phoneDigits = (entry.customerPhone || '').replace(/\D/g, '');
    if (phoneDigits.length >= 6) {
      seenKeys.add(`phone:${phoneDigits}`);
      continue;
    }
    const normName = (entry.customerName || '').trim().toLowerCase();
    if (normName && !GENERIC_CUSTOMER_NAMES.has(normName)) {
      seenKeys.add(`name:${normName}`);
      continue;
    }
    const normCode = (entry.customerCode || '').trim().toLowerCase();
    if (normCode) {
      seenKeys.add(`code:${normCode}`);
      continue;
    }
    seenKeys.add(`anon:${entry.id}`);
  }
  return seenKeys.size;
}

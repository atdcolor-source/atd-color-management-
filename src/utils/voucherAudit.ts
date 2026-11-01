import { DESIGN_ILLUSTRATION_PRESETS } from '../components/DesignIllustrationSelector';
import {
  DEFAULT_FOOTER_NOTE,
  LEGACY_FOOTER_NOTE,
  PREVIOUS_FOOTER_NOTE,
} from '../data/initialData';
import { CustomerInfo, QuoteItem, QuoteTotals, ReportStage } from '../types';
import { formatVND } from './formatters';

export const MIN_VOUCHER_DISCOUNT_AMOUNT = 1_000;
export const QUICK_DISCOUNT_PRESETS = [10_000, 20_000, 50_000] as const;

export interface VoucherAuditTarget {
  reportStage?: ReportStage | '' | null;
  remainingPaid?: boolean;
  discountAmount?: number;
  depositAmount?: number;
  totals?: Pick<QuoteTotals, 'discountAmount' | 'depositAmount'>;
  customer: CustomerInfo;
  items: QuoteItem[];
  designIllustration?: string;
  invoiceNote?: string;
}

export interface InvoiceVoucherAudit {
  isCoc: boolean;
  cocReasons: string[];
  hasValidDiscount: boolean;
  discountReasons: string[];
  detectedDiscountAmount: number;
  isQualifiedVoucher: boolean;
  voucherDeductAmount: number;
  rawDepositAmount: number;
  rawDiscountAmount: number;
  hasSubThresholdDiscount: boolean;
  isInAdvancedStageWithoutCoc: boolean;
}

const STATIC_BOILERPLATE_LINES = new Set<string>(
  [DEFAULT_FOOTER_NOTE, LEGACY_FOOTER_NOTE, PREVIOUS_FOOTER_NOTE]
    .flatMap((block) => block.split(/\r?\n/))
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean)
);

const POLICY_COC_DISCLAIMER_RE =
  /(?:không\s*hoàn|ko\s*hoàn|hoàn\s*(?:trả\s*|lại\s*)?tiền)\s*(?:trả\s*|lại\s*)?(?:tiền\s*)?cọc/iu;

const NEGATIVE_COC_PHRASE_RE =
  /(?:không|ko|chưa|chờ|đợi|hủy|huỷ|bỏ|thiếu|nhắc(?:\s*khách)?|báo(?:\s*khách)?)\s*(?:nhận\s*|đặt\s*|chuyển\s*|thanh\s*toán\s*|đóng\s*|có\s*)?(?:tiền\s*)?cọc|(?:chua|khong|ko|cho|doi|huy)\s+(?:dat\s+|chuyen\s+|nhan\s+)?coc|cọc\s*[:=-]?\s*0(?:\s*(?:đ|d|k|vnd|vnđ))?(?![\p{N}])/giu;

const POSITIVE_COC_ACCENTED_RE =
  /(?:^|[^\p{L}\p{N}])((?:đã\s*nhận\s*cọc|đã\s*chuyển\s*cọc|đã\s*đặt\s*cọc|đã\s*cọc|đặt\s*cọc|nhận\s*cọc|chuyển\s*cọc|khách\s*cọc|kh\s*cọc|cọc\s*trước|tiền\s*cọc|cọc)(?:\s*[:=-]?\s*\d[\d.,]*\s*(?:k|đ|d|tr|vnd|vnđ)?)?)(?=$|[^\p{L}\p{N}])/iu;

const POSITIVE_COC_UNACCENTED_RE =
  /(?:^|[^\p{L}\p{N}])((?:da\s+coc|dat\s+coc|nhan\s+coc|chuyen\s+coc|khach\s+coc|kh\s+coc|coc\s+\d+\s*k))(?=$|[^\p{L}\p{N}])/iu;

const NEGATIVE_DISCOUNT_PHRASE_RE =
  /(?:không|ko|chưa|hết|bỏ|hủy|huỷ)\s*(?:áp\s*dụng\s*|được\s*|có\s*)?(?:giảm(?:\s*giá)?|giam(?:\s*gia)?|voucher|vc|ưu\s*đãi|uu\s*dai|khuyến\s*mãi|khuyen\s*mai|km|trừ|tru|bớt|bot)(?:\s*[:=-]?\s*\d[\d.,]*\s*(?:k|ngàn|nghìn|nghin|ngan|đ|d|vnd|vnđ)?)?/giu;

const NON_DISCOUNT_CONTEXT_RE =
  /(?:đã\s*cọc|đặt\s*cọc|nhận\s*cọc|chuyển\s*cọc|tiền\s*cọc|cọc|da\s+coc|dat\s+coc|tiền\s*ship|phí\s*ship|ship|vận\s*chuyển|phụ\s*phí|phụ\s*thu|cộng\s*thêm|tính\s*thêm)\s*[:=-]?\s*\d[\d.,]*\s*(?:k|ngàn|nghìn|nghin|ngan|đ|d|vnd|vnđ)?/giu;

const UNIT_RATE_OR_SPEC_RE =
  /\d[\d.,]*\s*(?:k|ngàn|nghìn|nghin|ngan|đ|d|vnd|vnđ)?\s*\/\s*(?:\d+\s*)?[\p{L}]+|\d+\s*%|\b\d+\s*[x×*]\s*\d+|\b\d+\s*(?:cm|mm|m|tờ|bảng|cái|ly|cuộn|cây|xấp|bộ|mẫu|trang|món|mic)(?=$|[^\p{L}])/giu;

const MONEY_TOKEN = String.raw`(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?\s*(?:k|ngàn|nghìn|nghin|ngan)|\d{4,8})\s*(?:đ|d|vnd|vnđ)?`;

const DISCOUNT_BEFORE_AMOUNT_RE = new RegExp(
  String.raw`(?:^|[^\p{L}\p{N}])((?:giảm(?:\s*giá)?|giam(?:\s*gia)?|voucher|vc|ưu\s*đãi|uu\s*dai|khuyến\s*mãi|khuyen\s*mai|chiết\s*khấu|chiet\s*khau|trừ\s*voucher|tru\s*voucher|bớt|bot|hỗ\s*trợ\s*giảm)\s*[:=-]?\s*${MONEY_TOKEN})(?=$|[^\p{L}\p{N}])`,
  'iu'
);

const DISCOUNT_AFTER_AMOUNT_RE = new RegExp(
  String.raw`(?:^|[^\p{L}\p{N}])(${MONEY_TOKEN}\s*(?:voucher|vc|ưu\s*đãi|uu\s*dai|giảm\s*giá|giam\s*gia|khuyến\s*mãi|khuyen\s*mai))(?=$|[^\p{L}\p{N}])`,
  'iu'
);

const SIGNED_MINUS_AMOUNT_RE = new RegExp(
  String.raw`(?:^|[\n:(,;]|(?<![\p{N}kKđd]\s)\s)(-\s*${MONEY_TOKEN})(?=$|[^\p{L}\p{N}])`,
  'iu'
);

const ITEM_DISCOUNT_NAME_RE =
  /(?:^|[^\p{L}\p{N}])(giảm\s*giá|giam\s*gia|voucher|vc|ưu\s*đãi|uu\s*dai|khuyến\s*mãi|khuyen\s*mai|trừ\s*voucher|mã\s*giảm)(?=$|[^\p{L}\p{N}])/iu;

function compactSnippet(raw: string, maxLen = 36): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1).trim()}…`;
}

function parseMatchedMoneyToken(rawToken: string): number {
  const normalized = rawToken.trim().toLowerCase();
  if (!normalized) return 0;

  if (/(?:k|ngàn|nghìn|nghin|ngan)$/iu.test(normalized)) {
    const numStr = normalized
      .replace(/(?:k|ngàn|nghìn|nghin|ngan)$/iu, '')
      .trim()
      .replace(',', '.');
    const parsed = Number.parseFloat(numStr);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    const vnd = Math.round(parsed * 1_000);
    return vnd >= MIN_VOUCHER_DISCOUNT_AMOUNT && vnd <= 50_000_000 ? vnd : 0;
  }

  const digitsOnly = normalized.replace(/[^\d]/g, '');
  if (!digitsOnly) return 0;
  const parsedInt = Number.parseInt(digitsOnly, 10);
  if (!Number.isFinite(parsedInt) || parsedInt <= 0) return 0;
  return parsedInt >= MIN_VOUCHER_DISCOUNT_AMOUNT && parsedInt <= 50_000_000
    ? parsedInt
    : 0;
}

export function stripFooterBoilerplate(
  note: string | undefined | null,
  customStoreFooterNote?: string
): string {
  if (!note || !note.trim()) return '';
  const dynamicLines = customStoreFooterNote
    ? new Set(
        customStoreFooterNote
          .split(/\r?\n/)
          .map((line) => line.trim().toLowerCase())
          .filter(Boolean)
      )
    : null;

  return note
    .split(/\r?\n/)
    .filter((line) => {
      const normalized = line.trim().toLowerCase();
      if (!normalized) return false;
      if (STATIC_BOILERPLATE_LINES.has(normalized)) return false;
      if (dynamicLines && dynamicLines.has(normalized)) return false;
      if (POLICY_COC_DISCLAIMER_RE.test(normalized)) return false;
      return true;
    })
    .join('\n');
}

export function findPositiveCocSnippet(
  rawText: string | undefined | null
): string | null {
  if (!rawText || !rawText.trim()) return null;
  const cleaned = rawText
    .replace(POLICY_COC_DISCLAIMER_RE, ' ')
    .replace(NEGATIVE_COC_PHRASE_RE, ' ');

  const accentedMatch = cleaned.match(POSITIVE_COC_ACCENTED_RE);
  if (accentedMatch && accentedMatch[1]) {
    return compactSnippet(accentedMatch[1]);
  }

  const unaccentedMatch = cleaned.match(POSITIVE_COC_UNACCENTED_RE);
  if (unaccentedMatch && unaccentedMatch[1]) {
    return compactSnippet(unaccentedMatch[1]);
  }

  return null;
}

export function findDiscountMention(
  rawText: string | undefined | null
): { amount: number; snippet: string } | null {
  if (!rawText || !rawText.trim()) return null;
  const cleaned = rawText
    .replace(NEGATIVE_DISCOUNT_PHRASE_RE, ' ')
    .replace(NON_DISCOUNT_CONTEXT_RE, ' ')
    .replace(UNIT_RATE_OR_SPEC_RE, ' ');

  const m1 = cleaned.match(DISCOUNT_BEFORE_AMOUNT_RE);
  if (m1 && m1[1] && m1[2]) {
    const amount = parseMatchedMoneyToken(m1[2]);
    if (amount >= MIN_VOUCHER_DISCOUNT_AMOUNT) {
      return { amount, snippet: compactSnippet(m1[1]) };
    }
  }

  const m2 = cleaned.match(DISCOUNT_AFTER_AMOUNT_RE);
  if (m2 && m2[1] && m2[2]) {
    const amount = parseMatchedMoneyToken(m2[2]);
    if (amount >= MIN_VOUCHER_DISCOUNT_AMOUNT) {
      return { amount, snippet: compactSnippet(m2[1]) };
    }
  }

  const m3 = cleaned.match(SIGNED_MINUS_AMOUNT_RE);
  if (m3 && m3[1] && m3[2]) {
    const amount = parseMatchedMoneyToken(m3[2]);
    if (amount >= MIN_VOUCHER_DISCOUNT_AMOUNT) {
      return { amount, snippet: compactSnippet(m3[1]) };
    }
  }

  return null;
}

function getCustomDesignText(designIllustration: string | undefined): string {
  const trimmed = (designIllustration || '').trim();
  if (!trimmed || trimmed === 'Tự chọn') return '';
  if (
    DESIGN_ILLUSTRATION_PRESETS.includes(
      trimmed as (typeof DESIGN_ILLUSTRATION_PRESETS)[number]
    )
  ) {
    return '';
  }
  return trimmed;
}

export function auditInvoiceVoucher(
  target: VoucherAuditTarget,
  customStoreFooterNote?: string
): InvoiceVoucherAudit {
  const rawDepositAmount = Math.max(
    0,
    Math.round(target.totals?.depositAmount ?? target.depositAmount ?? 0)
  );
  const rawDiscountAmount = Math.max(
    0,
    Math.round(target.totals?.discountAmount ?? target.discountAmount ?? 0)
  );

  const cocReasons: string[] = [];
  const discountReasons: string[] = [];

  // --- Track Cọc & Thanh toán phần còn lại status for follow-up & reconciliation ---
  if (target.reportStage === 'hoan_thanh' || target.remainingPaid) {
    cocReasons.push('Đã tất toán / Hoàn thành');
  } else if (target.reportStage === 'coc') {
    cocReasons.push('Để là Cọc');
  }

  if (rawDepositAmount > 0) {
    cocReasons.push(`Đã cọc ${formatVND(rawDepositAmount)}`);
  }

  const custCocSnippet =
    findPositiveCocSnippet(target.customer?.name) ||
    findPositiveCocSnippet(target.customer?.code);
  if (custCocSnippet) {
    cocReasons.push(`Thông tin KH: "${custCocSnippet}"`);
  }

  for (const item of target.items || []) {
    const itemCoc =
      findPositiveCocSnippet(item.name) || findPositiveCocSnippet(item.note);
    if (itemCoc) {
      cocReasons.push(`Dòng SP: "${itemCoc}"`);
      break;
    }
  }

  const customDesign = getCustomDesignText(target.designIllustration);
  const designCocSnippet = findPositiveCocSnippet(customDesign);
  if (designCocSnippet) {
    cocReasons.push(`Minh họa: "${designCocSnippet}"`);
  }

  const cleanedInvoiceNote = stripFooterBoilerplate(
    target.invoiceNote,
    customStoreFooterNote
  );
  const noteCocSnippet = findPositiveCocSnippet(cleanedInvoiceNote);
  if (noteCocSnippet) {
    cocReasons.push(`Ghi chú đơn: "${noteCocSnippet}"`);
  }

  // --- Detect Customer Discount (>= 1.000đ deducts immediately into Quỹ Voucher) ---
  let detectedDiscountAmount = 0;

  if (rawDiscountAmount >= MIN_VOUCHER_DISCOUNT_AMOUNT) {
    detectedDiscountAmount = rawDiscountAmount;
    discountReasons.push(`Tiền giảm: ${formatVND(rawDiscountAmount)}`);
  }

  // Also check negative discount line items in the quote table
  let negativeItemSum = 0;
  for (const item of target.items || []) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = Number(item.unitPrice) || 0;
    const lineTotal = Math.round(qty * unitPrice);

    if (lineTotal <= -MIN_VOUCHER_DISCOUNT_AMOUNT) {
      const absAmt = Math.abs(lineTotal);
      negativeItemSum += absAmt;
      discountReasons.push(
        `Dòng trừ ${formatVND(absAmt)} (${compactSnippet(item.name || 'Voucher', 24)})`
      );
    }
  }

  if (negativeItemSum >= MIN_VOUCHER_DISCOUNT_AMOUNT) {
    detectedDiscountAmount += negativeItemSum;
  }

  // Fallback: if neither Tiền giảm nor negative line items recorded it, scan text mentions (>= 1.000đ)
  if (detectedDiscountAmount < MIN_VOUCHER_DISCOUNT_AMOUNT) {
    for (const item of target.items || []) {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const unitPrice = Math.abs(Math.round(Number(item.unitPrice) || 0));
      const absLine = qty * unitPrice;

      if (
        absLine >= MIN_VOUCHER_DISCOUNT_AMOUNT &&
        ITEM_DISCOUNT_NAME_RE.test(item.name || '')
      ) {
        detectedDiscountAmount = absLine;
        discountReasons.push(
          `Mục giảm giá: "${compactSnippet(item.name, 26)}" (${formatVND(absLine)})`
        );
        break;
      }

      const nameMention = findDiscountMention(item.name);
      if (nameMention) {
        detectedDiscountAmount = nameMention.amount;
        discountReasons.push(
          `Tên SP: "${nameMention.snippet}" (${formatVND(nameMention.amount)})`
        );
        break;
      }

      const noteMention = findDiscountMention(item.note);
      if (noteMention) {
        detectedDiscountAmount = noteMention.amount;
        discountReasons.push(
          `Ghi chú SP: "${noteMention.snippet}" (${formatVND(noteMention.amount)})`
        );
        break;
      }
    }
  }

  if (detectedDiscountAmount < MIN_VOUCHER_DISCOUNT_AMOUNT) {
    const noteMention = findDiscountMention(cleanedInvoiceNote);
    if (noteMention) {
      detectedDiscountAmount = noteMention.amount;
      discountReasons.push(
        `Ghi chú đơn: "${noteMention.snippet}" (${formatVND(noteMention.amount)})`
      );
    }
  }

  if (detectedDiscountAmount < MIN_VOUCHER_DISCOUNT_AMOUNT) {
    const custMention =
      findDiscountMention(target.customer?.name) ||
      findDiscountMention(target.customer?.code) ||
      findDiscountMention(customDesign);
    if (custMention) {
      detectedDiscountAmount = custMention.amount;
      discountReasons.push(
        `Thông tin đơn: "${custMention.snippet}" (${formatVND(custMention.amount)})`
      );
    }
  }

  const isCoc = cocReasons.length > 0;
  const hasValidDiscount =
    detectedDiscountAmount >= MIN_VOUCHER_DISCOUNT_AMOUNT;
  // Rule: Phát sinh giảm khách từ 1.000đ trở lên là tính trừ thẳng vào Quỹ Voucher luôn
  const isQualifiedVoucher = hasValidDiscount;
  const voucherDeductAmount = isQualifiedVoucher ? detectedDiscountAmount : 0;
  const hasSubThresholdDiscount =
    !hasValidDiscount &&
    rawDiscountAmount > 0 &&
    rawDiscountAmount < MIN_VOUCHER_DISCOUNT_AMOUNT;
  const isInAdvancedStageWithoutCoc =
    !isCoc &&
    (target.reportStage === 'chot_in' ||
      target.reportStage === 'chot_thiet_ke' ||
      target.reportStage === 'hoan_thanh');

  return {
    isCoc,
    cocReasons,
    hasValidDiscount,
    discountReasons,
    detectedDiscountAmount,
    isQualifiedVoucher,
    voucherDeductAmount,
    rawDepositAmount,
    rawDiscountAmount,
    hasSubThresholdDiscount,
    isInAdvancedStageWithoutCoc,
  };
}

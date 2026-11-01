import {
  getReportStageLabel,
  REPORT_STAGE_OPTIONS,
} from '../constants/reportStages';
import {
  AiNavigateTarget,
  AiOrderAction,
  AiOrderItemDraft,
  InventoryItem,
  Product,
  ReportStage,
  RevenueEntry,
  SavedInvoice,
} from '../types';
import {
  computeMergedCustomerDirectory,
  computePipelineWindowStats,
  computeRevenueWindowStats,
  computeVoucherMonthStats,
  FullWebContextInput,
  getSynchronizedActiveRevenueEntries,
  hasMeaningfulOrderChanges,
  TAB_LABELS,
} from './aiWorkspaceContext';
import {
  formatDateOnlyVN,
  formatISODateVN,
  formatVND,
  getLocalISODate,
} from './formatters';
import {
  countDistinctCustomersInEntries,
  countDistinctOrdersInEntries,
  getCurrentMonthKeyLocal,
  getInvoiceRemainingPaidDate,
  getMonthDateRangeVN,
  getRevenueEntryPaymentBadge,
  getUncollectedRemainingAmount,
  isInvoiceRemainingSettled,
  isoTimestampToLocalOrderDate,
  shiftMonthKey,
} from './revenueSplit';
import {
  auditInvoiceVoucher,
  MIN_VOUCHER_DISCOUNT_AMOUNT,
} from './voucherAudit';

export interface SmartAssistantResult {
  reply: string;
  orderAction: AiOrderAction;
}

export function createDefaultOrderAction(): AiOrderAction {
  return {
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
}

function foldVi(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isPureConfirmationInput(raw: string): boolean {
  const f = foldVi(raw).replace(/[.!,?~]+$/g, '').trim();
  return /^(ok|oke|okay|ok nha|ok luon|ok em|ok ban|ok anh|ok chi|ok ad|u|uh|uk|ukm|dong y|chot|chot don|chot luon|luu|luu luon|lien ket|lien ket luon|dung roi|ap dung|ap dung luon|xac nhan)$/i.test(
    f
  );
}

function hasInlineConfirmation(raw: string): boolean {
  const f = foldVi(raw).replace(/[.!,?~]+$/g, '').trim();
  if (isPureConfirmationInput(f)) return true;
  return /(?:\bva\s+ok\b|\broi\s+ok\b|\bok\s*luon\b|\boke\s*luon\b|\bchot\s*luon\b|\bchot\s*don\b|\bluu\s*luon\b|\bap\s*dung\s*luon\b|\bdong\s*y\b|(?:^|[\s,;+])(?:ok|oke|okay)$)/i.test(
    f
  );
}

/**
 * Parses Vietnamese money expressions like:
 * "15k", "15.000đ", "1tr5", "1.5tr", "200 ngàn", "50,000", "1000"
 */
export function parseMoneyTokenVN(rawToken: string): number | null {
  const s = foldVi(rawToken).replace(/\s+/g, '');
  if (!s) return null;

  const trSplit = s.match(/^(\d+)(?:[.,](\d+))?(?:tr|trieu)(\d+)?$/i);
  if (trSplit) {
    const whole = parseInt(trSplit[1], 10);
    const decStr = trSplit[2] || trSplit[3] || '';
    const decVal = decStr
      ? parseInt(decStr.padEnd(6, '0').slice(0, 6), 10)
      : 0;
    return whole * 1_000_000 + decVal;
  }

  const kMatch = s.match(/^(\d+)(?:[.,](\d+))?(?:k|nghin|ngan)$/i);
  if (kMatch) {
    const whole = parseInt(kMatch[1], 10);
    const decStr = kMatch[2] || '';
    const decVal = decStr
      ? parseInt(decStr.padEnd(3, '0').slice(0, 3), 10)
      : 0;
    return whole * 1_000 + decVal;
  }

  const groupedMatch = s.match(/^(\d{1,3}(?:[.,]\d{3})+)(?:d|vnd|dong)?$/i);
  if (groupedMatch) {
    const digits = groupedMatch[1].replace(/[.,]/g, '');
    const val = parseInt(digits, 10);
    return Number.isFinite(val) ? val : null;
  }

  const plainMatch = s.match(/^(\d+)(?:d|vnd|dong)?$/i);
  if (plainMatch) {
    const val = parseInt(plainMatch[1], 10);
    if (!Number.isFinite(val)) return null;
    return val;
  }

  return null;
}

function extractMoneyAfterKeyword(
  foldedText: string,
  pattern: RegExp
): number | null {
  const m = foldedText.match(pattern);
  if (!m || !m[1]) return null;
  const parsed = parseMoneyTokenVN(m[1]);
  if (parsed === null) return null;
  if (parsed > 0 && parsed < 1000 && !/[.,]|d$|vnd$|dong$/i.test(m[1].trim())) {
    return parsed * 1000;
  }
  return parsed;
}

// --- Vietnamese Time Scope Resolver ---

export type TimeScope =
  | {
      kind: 'day';
      subKind: 'today' | 'yesterday' | 'dayBefore' | 'exactDate';
      dateISO: string;
      label: string;
      shortLabel: string;
      matchDate: (isoDate: string) => boolean;
    }
  | {
      kind: 'range';
      subKind: 'last7d';
      startISO: string;
      endISO: string;
      label: string;
      shortLabel: string;
      matchDate: (isoDate: string) => boolean;
    }
  | {
      kind: 'month';
      subKind: 'currentMonth' | 'prevMonth' | 'exactMonth';
      monthKey: string;
      label: string;
      shortLabel: string;
      matchDate: (isoDate: string) => boolean;
    }
  | {
      kind: 'all';
      label: string;
      shortLabel: string;
      matchDate: (isoDate: string) => boolean;
    }
  | {
      kind: 'unspecified';
      label: string;
      shortLabel: string;
      matchDate: (isoDate: string) => boolean;
    };

export function resolveTimeScope(rawText: string, folded: string): TimeScope {
  const now = new Date();
  const currentYear = now.getFullYear();
  const todayISO = getLocalISODate(0);
  const yesterdayISO = getLocalISODate(-1);
  const dayBeforeISO = getLocalISODate(-2);
  const currentMonthKey = getCurrentMonthKeyLocal();

  // 1. Explicit ISO date YYYY-MM-DD
  const isoMatch = rawText.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const yyyy = isoMatch[1];
    const mm = isoMatch[2].padStart(2, '0');
    const dd = isoMatch[3].padStart(2, '0');
    const dateISO = `${yyyy}-${mm}-${dd}`;
    const vn = formatISODateVN(dateISO);
    return {
      kind: 'day',
      subKind: dateISO === todayISO ? 'today' : 'exactDate',
      dateISO,
      label: `ngày ${vn}`,
      shortLabel: `ngày ${vn}`,
      matchDate: (d) => d === dateISO,
    };
  }

  // 2. Explicit DD/MM/YYYY or DD-MM-YYYY
  const fullVnDate = rawText.match(
    /\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/
  );
  if (fullVnDate) {
    const dayNum = parseInt(fullVnDate[1], 10);
    const monthNum = parseInt(fullVnDate[2], 10);
    const yyyy = fullVnDate[3];
    if (dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12) {
      const dateISO = `${yyyy}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const vn = formatISODateVN(dateISO);
      return {
        kind: 'day',
        subKind: dateISO === todayISO ? 'today' : 'exactDate',
        dateISO,
        label: `ngày ${vn}`,
        shortLabel: `ngày ${vn}`,
        matchDate: (d) => d === dateISO,
      };
    }
  }

  // 3. Explicit "ngày D tháng M (năm YYYY)"
  const spokenDayMonth = folded.match(
    /\bngay\s+(\d{1,2})\s+thang\s+(\d{1,2})(?:\s+nam\s+(20\d{2}))?\b/i
  );
  if (spokenDayMonth) {
    const dayNum = parseInt(spokenDayMonth[1], 10);
    const monthNum = parseInt(spokenDayMonth[2], 10);
    const yyyy = spokenDayMonth[3] || String(currentYear);
    if (dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12) {
      const dateISO = `${yyyy}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const vn = formatISODateVN(dateISO);
      return {
        kind: 'day',
        subKind: dateISO === todayISO ? 'today' : 'exactDate',
        dateISO,
        label: `ngày ${vn}`,
        shortLabel: `ngày ${vn}`,
        matchDate: (d) => d === dateISO,
      };
    }
  }

  // 4. Relative day keywords: hôm nay / bữa nay / hôm qua / hôm kia
  if (
    /\b(?:hom\s*nay|bua\s*nay|ngay\s*nay|ngay\s*hom\s*nay|sang\s*nay|chieu\s*nay|toi\s*nay|trong\s*ngay)\b/i.test(
      folded
    )
  ) {
    const vn = formatISODateVN(todayISO);
    return {
      kind: 'day',
      subKind: 'today',
      dateISO: todayISO,
      label: `hôm nay (${vn})`,
      shortLabel: `hôm nay (${vn})`,
      matchDate: (d) => d === todayISO,
    };
  }

  if (/\b(?:hom\s*qua|ngay\s*hom\s*qua|toi\s*qua)\b/i.test(folded)) {
    const vn = formatISODateVN(yesterdayISO);
    return {
      kind: 'day',
      subKind: 'yesterday',
      dateISO: yesterdayISO,
      label: `hôm qua (${vn})`,
      shortLabel: `hôm qua (${vn})`,
      matchDate: (d) => d === yesterdayISO,
    };
  }

  if (/\b(?:hom\s*kia|ngay\s*hom\s*kia)\b/i.test(folded)) {
    const vn = formatISODateVN(dayBeforeISO);
    return {
      kind: 'day',
      subKind: 'dayBefore',
      dateISO: dayBeforeISO,
      label: `hôm kia (${vn})`,
      shortLabel: `hôm kia (${vn})`,
      matchDate: (d) => d === dayBeforeISO,
    };
  }

  // 5. 7-day / weekly range
  if (
    /\b(?:7\s*ngay|bay\s*ngay|tuan\s*nay|tuan\s*qua|1\s*tuan|mot\s*tuan)\b/i.test(
      folded
    )
  ) {
    const startISO = getLocalISODate(-6);
    return {
      kind: 'range',
      subKind: 'last7d',
      startISO,
      endISO: todayISO,
      label: `7 ngày qua (${formatISODateVN(startISO)} – ${formatISODateVN(todayISO)})`,
      shortLabel: '7 ngày qua',
      matchDate: (d) => d >= startISO && d <= todayISO,
    };
  }

  // 6. Explicit Month MM/YYYY or "tháng M"
  const explicitMonthYear = folded.match(
    /\b(?:thang|t)\s*(\d{1,2})\s*[/-]\s*(20\d{2})\b/i
  );
  if (explicitMonthYear) {
    const mNum = parseInt(explicitMonthYear[1], 10);
    const yyyy = explicitMonthYear[2];
    if (mNum >= 1 && mNum <= 12) {
      const mk = `${yyyy}-${String(mNum).padStart(2, '0')}`;
      const range = getMonthDateRangeVN(mk);
      return {
        kind: 'month',
        subKind: mk === currentMonthKey ? 'currentMonth' : 'exactMonth',
        monthKey: mk,
        label: `${range.monthLabel} (${range.rangeVN})`,
        shortLabel: range.monthLabel,
        matchDate: (d) => d.slice(0, 7) === mk,
      };
    }
  }

  const explicitMonthOnly = folded.match(/\bthang\s+(\d{1,2})\b/i);
  if (explicitMonthOnly) {
    const mNum = parseInt(explicitMonthOnly[1], 10);
    if (mNum >= 1 && mNum <= 12) {
      const mk = `${currentYear}-${String(mNum).padStart(2, '0')}`;
      const range = getMonthDateRangeVN(mk);
      return {
        kind: 'month',
        subKind: mk === currentMonthKey ? 'currentMonth' : 'exactMonth',
        monthKey: mk,
        label: `${range.monthLabel} (${range.rangeVN})`,
        shortLabel: range.monthLabel,
        matchDate: (d) => d.slice(0, 7) === mk,
      };
    }
  }

  // 7. Short DD/MM date (checked AFTER "tháng M/YYYY" so MM/YYYY is not misread)
  const shortDayMonth = rawText.match(
    /(?:\bngày\s*|\bngay\s*|\b)(\d{1,2})[/-](\d{1,2})(?![/\d-])/i
  );
  if (shortDayMonth) {
    const dNum = parseInt(shortDayMonth[1], 10);
    const mNum = parseInt(shortDayMonth[2], 10);
    if (dNum >= 1 && dNum <= 31 && mNum >= 1 && mNum <= 12) {
      const dateISO = `${currentYear}-${String(mNum).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
      const vn = formatISODateVN(dateISO);
      return {
        kind: 'day',
        subKind: dateISO === todayISO ? 'today' : 'exactDate',
        dateISO,
        label: `ngày ${vn}`,
        shortLabel: `ngày ${vn}`,
        matchDate: (d) => d === dateISO,
      };
    }
  }

  // 8. Previous month / Current month / All-time
  if (/\b(?:thang\s*truoc|thang\s*roi|thang\s*vua\s*roi)\b/i.test(folded)) {
    const prevMk = shiftMonthKey(currentMonthKey, -1);
    const range = getMonthDateRangeVN(prevMk);
    return {
      kind: 'month',
      subKind: 'prevMonth',
      monthKey: prevMk,
      label: `${range.monthLabel} (${range.rangeVN})`,
      shortLabel: range.monthLabel,
      matchDate: (d) => d.slice(0, 7) === prevMk,
    };
  }

  if (/\b(?:thang\s*nay|thang\s*hien\s*tai|trong\s*thang)\b/i.test(folded)) {
    const range = getMonthDateRangeVN(currentMonthKey);
    return {
      kind: 'month',
      subKind: 'currentMonth',
      monthKey: currentMonthKey,
      label: `${range.monthLabel} (${range.rangeVN})`,
      shortLabel: range.monthLabel,
      matchDate: (d) => d.slice(0, 7) === currentMonthKey,
    };
  }

  if (
    /\b(?:tat\s*ca\s*cac\s*thang|tat\s*ca\s*thoi\s*gian|luy\s*ke|toan\s*bo\s*doanh\s*thu|tu\s*truoc\s*den\s*nay|cac\s*thang)\b/i.test(
      folded
    )
  ) {
    return {
      kind: 'all',
      label: 'tất cả các tháng (lũy kế)',
      shortLabel: 'lũy kế tất cả',
      matchDate: () => true,
    };
  }

  return {
    kind: 'unspecified',
    label: '',
    shortLabel: '',
    matchDate: () => true,
  };
}

// --- Product & Order Parsing Helpers ---

function findPlasticProduct(
  products: Product[],
  size: 'A3' | 'A4' | 'A5',
  sides: '1' | '2'
): Product | undefined {
  const targetId = `ep-${sides}m-${size.toLowerCase()}`;
  const exact = products.find((p) => p.id.toLowerCase() === targetId);
  if (exact) return exact;

  return products.find((p) => {
    const pf = foldVi(
      `${p.name} ${p.category} ${p.size || ''} ${p.sides || ''}`
    );
    return (
      (pf.includes('ep nhua') || pf.includes('plastic')) &&
      pf.includes(size.toLowerCase()) &&
      pf.includes(`${sides} mat`)
    );
  });
}

function findFormexProduct(
  products: Product[],
  size: 'A3' | 'A4' | 'A5',
  sides: '1' | '2'
): Product | undefined {
  const targetId = `fm-${sides}m-${size.toLowerCase()}`;
  const exact = products.find((p) => p.id.toLowerCase() === targetId);
  if (exact) return exact;

  return products.find((p) => {
    const pf = foldVi(
      `${p.name} ${p.category} ${p.size || ''} ${p.sides || ''}`
    );
    return (
      (pf.includes('formex') || pf.includes('decal')) &&
      pf.includes(size.toLowerCase()) &&
      pf.includes(`${sides} mat`)
    );
  });
}

function extractSize(foldedClause: string): 'A3' | 'A4' | 'A5' | null {
  if (/\ba3\b/i.test(foldedClause)) return 'A3';
  if (/\ba4\b/i.test(foldedClause)) return 'A4';
  if (/\ba5\b/i.test(foldedClause)) return 'A5';
  return null;
}

function extractSides(foldedClause: string): '1' | '2' | null {
  if (/\b(?:1\s*mat|1m|mot\s*mat)\b/i.test(foldedClause)) return '1';
  if (/\b(?:2\s*mat|2m|hai\s*mat)\b/i.test(foldedClause)) return '2';
  return null;
}

function extractQuantityFromClause(foldedClause: string): number {
  const cleaned = foldedClause
    .replace(/\ba[345]\b/gi, ' ')
    .replace(/\b[12]\s*(?:mat|m)\b/gi, ' ')
    .replace(/\b\d+\s*(?:mm|mic|g|gsm)\b/gi, ' ')
    .replace(
      /\b\d+(?:[.,]\d+)?\s*(?:k|tr|trieu|nghin|ngan|d|vnd|dong)\b/gi,
      ' '
    )
    .replace(/\b\d{1,3}(?:[.,]\d{3})+\b/g, ' ')
    .replace(/\b0\d{8,10}\b/g, ' ');

  const xMatch = cleaned.match(/(?:\bx\s*(\d{1,4})\b|\b(\d{1,4})\s*x\b)/i);
  if (xMatch) {
    const q = parseInt(xMatch[1] || xMatch[2], 10);
    if (q >= 1 && q <= 5000) return q;
  }

  const unitMatch = cleaned.match(
    /\b(\d{1,4})\s*(?:to|bang|tam|mau|cai|cuon|bo|muc|menu|poster|san pham|sp)\b/i
  );
  if (unitMatch) {
    const q = parseInt(unitMatch[1], 10);
    if (q >= 1 && q <= 5000) return q;
  }

  const verbMatch = cleaned.match(
    /\b(?:dat|them|lay|in|cho|mua)\s+(\d{1,4})\b/i
  );
  if (verbMatch) {
    const q = parseInt(verbMatch[1], 10);
    if (q >= 1 && q <= 5000) return q;
  }

  const leadMatch = cleaned.trim().match(/^(\d{1,4})\s+[a-z]/i);
  if (leadMatch) {
    const q = parseInt(leadMatch[1], 10);
    if (q >= 1 && q <= 5000) return q;
  }

  return 1;
}

function parseOrderItemsFromText(
  rawText: string,
  products: Product[]
): AiOrderItemDraft[] {
  const stripped = rawText
    .replace(
      /(?:,|\bvà\b|\brồi\b)?\s*(?:ok|oke|okay|chốt\s*luôn|chốt\s*đơn|lưu\s*luôn|đồng\s*ý|áp\s*dụng\s*luôn)\s*[.!,?~]*$/iu,
      ' '
    )
    .replace(
      /(?:giảm\s*khách|giảm\s*giá|trừ\s*voucher|chiết\s*khấu|giảm)\s+\d+(?:[.,]\d+)?\s*(?:tr|triệu|k|nghìn|ngàn|đ|d|vnd|đồng)?/giu,
      ' '
    )
    .replace(
      /(?:đã\s*cọc|nhận\s*cọc|đặt\s*cọc|tiền\s*cọc|cọc)\s+\d+(?:[.,]\d+)?\s*(?:tr|triệu|k|nghìn|ngàn|đ|d|vnd|đồng)?/giu,
      ' '
    )
    .replace(
      /(?:phí\s*ship|tiền\s*ship|vận\s*chuyển|ship)\s+\d+(?:[.,]\d+)?\s*(?:tr|triệu|k|nghìn|ngàn|đ|d|vnd|đồng)?/giu,
      ' '
    );

  const rawClauses = stripped
    .split(/(?:[,;+\n]|\bvà\b|\bvới\b|\bkèm\b)/iu)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const items: AiOrderItemDraft[] = [];

  for (const clause of rawClauses) {
    const fc = foldVi(clause);
    if (!fc) continue;

    let matchedCatalog: Product | undefined;
    for (const p of products) {
      const pCode = foldVi(p.code);
      const pId = foldVi(p.id);
      if (
        (pCode.length >= 4 && fc.includes(pCode)) ||
        (pId.length >= 5 && fc.includes(pId))
      ) {
        matchedCatalog = p;
        break;
      }
    }

    if (
      !matchedCatalog &&
      /\b(?:ep\s*nhua|plastic|menu\s*ep|ep\s*plastic|ep\s*a[345])\b/i.test(fc)
    ) {
      const size = extractSize(fc) || 'A4';
      const sides = extractSides(fc) || '2';
      matchedCatalog = findPlasticProduct(products, size, sides);
    }

    if (
      !matchedCatalog &&
      /\b(?:formex|foxmex|fomex|foocmex|decal\s*formex|bang\s*formex|in\s*decal)\b/i.test(
        fc
      )
    ) {
      const size = extractSize(fc) || 'A4';
      const sides = extractSides(fc) || '1';
      matchedCatalog = findFormexProduct(products, size, sides);
    }

    if (matchedCatalog) {
      const qty = extractQuantityFromClause(fc);
      items.push({
        productId: matchedCatalog.id,
        name: matchedCatalog.name,
        unit: matchedCatalog.unit,
        quantity: qty,
        unitPrice: matchedCatalog.price,
        note: '',
      });
      continue;
    }

    if (
      /\b(?:thiet\s*ke|phu\s*phi|ve\s*lai\s*logo|chinh\s*sua\s*file)\b/i.test(fc)
    ) {
      const qty = extractQuantityFromClause(fc);
      const priceMatch = fc.match(
        /(\d+(?:[.,]\d+)?\s*(?:tr|trieu|k|nghin|ngan)|\d{1,3}(?:[.,]\d{3})+|\d{4,9})\s*(?:d|vnd|dong)?/i
      );
      const parsedPrice = priceMatch ? parseMoneyTokenVN(priceMatch[1]) : null;
      const isSurcharge = /\bphu\s*phi\b/i.test(fc);
      const size = extractSize(fc);
      const customName = isSurcharge
        ? 'Phụ phí thiết kế'
        : /\bposter\b/i.test(fc)
          ? `Thiết kế Poster${size ? ` (${size})` : ''}`
          : /\blogo\b/i.test(fc)
            ? 'Thiết kế Logo'
            : `Thiết kế Menu${size ? ` (${size})` : ''}`;

      items.push({
        productId: '',
        name: customName,
        unit: isSurcharge ? 'Mục' : 'Mẫu',
        quantity: qty,
        unitPrice:
          parsedPrice !== null && parsedPrice >= 0
            ? parsedPrice
            : isSurcharge
              ? 30_000
              : 150_000,
        note: '',
      });
      continue;
    }

    for (const p of products) {
      const pNameFolded = foldVi(p.name);
      if (pNameFolded.length >= 4 && fc.includes(pNameFolded)) {
        const qty = extractQuantityFromClause(fc);
        items.push({
          productId: p.id,
          name: p.name,
          unit: p.unit,
          quantity: qty,
          unitPrice: p.price,
          note: '',
        });
        break;
      }
    }
  }

  return items;
}

/**
 * Distinguishes pure data/reporting/warehouse questions from bill order commands.
 */
function isPriceOrInfoQuestionOnly(folded: string): boolean {
  // Warehouse / Revenue / Voucher / Report / Lookup questions are never customer bill orders
  const isDomainReportOrStockQuery =
    /\b(?:doanh\s*thu|tien\s*thiet\s*ke|tien\s*in|ban\s*duoc|thu\s*nhap|quy\s*voucher|ngan\s*sach|ton\s*kho|kho\s*hang|kiem\s*kho|can\s*dat|bang\s*dat|dat\s*kho|dat\s*hang\s*kho|het\s*hang|tien\s*do|phan\s*loai\s*khach|6\s*giai\s*doan|date\s*kh|lich\s*hen|danh\s*sach\s*khach|bao\s*gia\s*da\s*luu|lich\s*su\s*don|thong\s*ke|bao\s*cao|tom\s*tat|tinh\s*hinh|tra\s*cuu|tim\s*don|kiem\s*tra)\b/i.test(
      folded
    );

  const hasQuestionCue =
    /\b(?:bao\s*nhieu|may\s*tien|may\s*don|may\s*khach|may\s*to|may\s*xap|may\s*cay|may\s*cuon|co\s*don\s*nao|co\s*khach\s*nao|bang\s*gia|gia\s*sao|gia\s*the\s*nao|hoi\s*gia|xem\s*gia|con\s*bao\s*nhieu|con\s*khong|con\s*ko|the\s*nao|ra\s*sao)\b/i.test(
      folded
    ) ||
    /(?:\bkhong|\bko|\bchua|\bsao|\bnhi)\s*\?*$/i.test(folded) ||
    folded.endsWith('?');

  const hasExplicitBillCommand =
    /\b(?:len\s*don|tao\s*don|tao\s*bill|ghi\s*vao\s*bill|ap\s*dung|giam\s*cho\s*khach|giam\s*khach|da\s*coc|nhan\s*coc|ghi\s*coc|tich\s*(?:da\s*thu\s*)?phan\s*con\s*lai|da\s*thu\s*phan\s*con\s*lai|thanh\s*toan\s*phan\s*con\s*lai|thu\s*not\s*phan\s*con\s*lai|tat\s*toan\s*don|tat\s*toan\s*bill|xac\s*nhan\s*hoan\s*thanh|bo\s*tich\s*phan\s*con\s*lai|chua\s*thu\s*phan\s*con\s*lai)\b/i.test(
      folded
    ) ||
    /^(?:dat|them|lay)\s+\d*\s*(?:menu|poster|ep\s*nhua|plastic|decal|formex|foxmex|fomex|thiet\s*ke|phu\s*phi|to|bang|mau)\b/i.test(
      folded
    );

  if (hasExplicitBillCommand) return false;
  return isDomainReportOrStockQuery || hasQuestionCue;
}

function findTargetSavedInvoice(
  rawText: string,
  folded: string,
  savedInvoices: SavedInvoice[]
): SavedInvoice | null {
  for (const inv of savedInvoices) {
    const codeFold = foldVi(inv.code);
    if (codeFold.length >= 4 && folded.includes(codeFold)) {
      return inv;
    }
  }
  if (/\b(?:don\s*cua|bill\s*cua|hoa\s*don\s*cua|don\s*khach)\b/i.test(folded)) {
    const phoneMatch = rawText.match(/\b(0\d{8,10})\b/);
    if (phoneMatch) {
      const found = savedInvoices.find((inv) =>
        inv.customer.phone.replace(/\D/g, '').includes(phoneMatch[1])
      );
      if (found) return found;
    }
  }
  return null;
}

function detectStageFilterInQuery(
  folded: string
): ReportStage | 'unclassified' | null {
  if (/\bchua\s*phan\s*loai\b/i.test(folded)) return 'unclassified';
  if (/\bchot\s*thiet\s*ke\b/i.test(folded)) return 'chot_thiet_ke';
  if (/\bchot\s*in\b/i.test(folded)) return 'chot_in';
  if (/\bhoan\s*thanh\b/i.test(folded)) return 'hoan_thanh';
  if (/\bcham\s*soc\b/i.test(folded)) return 'cham_soc';
  if (/\b(?:da\s*coc|giai\s*doan\s*coc|don\s*coc)\b/i.test(folded))
    return 'coc';
  if (/\bgiai\s*doan\s*bao\s*gia\b/i.test(folded)) return 'bao_gia';
  return null;
}

function matchInventoryItemsByQuery(
  folded: string,
  inventoryItems: InventoryItem[]
): InventoryItem[] {
  const size = extractSize(folded);
  return inventoryItems.filter((item) => {
    const nf = foldVi(item.name);
    if (size && /\ba[345]\b/i.test(nf) && !nf.includes(size.toLowerCase())) {
      return false;
    }
    if (/\bbang\s*keo\s*nguy\s*hiem\b/i.test(folded)) {
      return nf.includes('nguy hiem');
    }
    if (/\bbang\s*keo\s*trong\b/i.test(folded)) {
      return nf.includes('keo trong');
    }
    if (/\bbang\s*keo\b/i.test(folded) && nf.includes('bang keo')) return true;
    if (/\bchong\s*soc\b/i.test(folded) && nf.includes('chong soc')) return true;
    if (/\b(?:bobb|mang\s*bong)\b/i.test(folded) && nf.includes('bobb'))
      return true;
    if (/\bgiay\s*in\s*anh\b/i.test(folded) && nf.includes('giay in anh'))
      return true;
    if (
      /\b(?:mieng\s*nhua|nhua\s*plastic|plastic)\b/i.test(folded) &&
      nf.includes('plastic')
    ) {
      return true;
    }
    if (/\bdecal\b/i.test(folded) && nf.includes('decal')) return true;
    if (/\b(?:formex|fomex|foxmex)\b/i.test(folded) && nf.includes('formex'))
      return true;
    return nf.length >= 5 && folded.includes(nf);
  });
}

function detectNavigationTarget(folded: string): {
  target: AiNavigateTarget;
  isExplicitOpen: boolean;
} {
  const isExplicitOpen =
    /^(?:mo|vao|chuyen\s*sang|di\s*toi|xem\s*muc|chuyen\s*qua|mo\s*muc|mo\s*trang)\b/i.test(
      folded
    );

  if (
    /\b(?:quy\s*voucher|voucher|ngan\s*sach\s*giam|giam\s*chua\s*coc)\b/i.test(
      folded
    )
  ) {
    return { target: 'plan_voucher', isExplicitOpen };
  }
  if (
    /\b(?:bang\s*san\s*pham\s*can\s*dat|bang\s*dat\s*kho|bang\s*dat\s*hang\s*kho|can\s*dat\s*them|hop\s*tin\s*kho|dat\s*hang\s*kho|san\s*pham\s*can\s*dat)\b/i.test(
      folded
    )
  ) {
    return { target: 'inventory_reorder', isExplicitOpen };
  }
  if (/\b(?:kho\s*hang|ton\s*kho|vat\s*tu|kiem\s*kho)\b/i.test(folded)) {
    return { target: 'inventory_stock', isExplicitOpen };
  }
  if (
    /\b(?:doanh\s*thu|tien\s*thiet\s*ke|tien\s*in|ban\s*duoc\s*bao\s*nhieu|thu\s*nhap|tong\s*thu)\b/i.test(
      folded
    )
  ) {
    return { target: 'reports_revenue', isExplicitOpen };
  }
  if (
    /\b(?:tien\s*do|phan\s*loai\s*khach|6\s*giai\s*doan|cham\s*soc\s*khach|con\s*phai\s*thu|con\s*no)\b/i.test(
      folded
    )
  ) {
    return { target: 'reports_pipeline', isExplicitOpen };
  }
  if (
    /\b(?:date\s*kh|date\s*khach|lich\s*hen\s*khach|hen\s*khach|danh\s*sach\s*khach|danh\s*ba\s*khach|khach\s*chua\s*co\s*bill)\b/i.test(
      folded
    )
  ) {
    return { target: 'plan_customers', isExplicitOpen };
  }
  if (
    /\b(?:bao\s*gia\s*da\s*luu|don\s*da\s*luu|lich\s*su\s*don)\b/i.test(folded)
  ) {
    return { target: 'saved', isExplicitOpen };
  }
  if (/\b(?:xem\s*ban\s*in|xuat\s*pdf|in\s*hoa\s*don)\b/i.test(folded)) {
    return { target: 'invoice', isExplicitOpen };
  }
  if (/\b(?:sua\s*bang\s*gia|danh\s*muc\s*gia)\b/i.test(folded)) {
    return { target: 'catalog', isExplicitOpen };
  }
  if (
    /\b(?:cai\s*dat\s*chung|thong\s*tin\s*cong\s*ty|chu\s*ky|logo\s*cong\s*ty)\b/i.test(
      folded
    )
  ) {
    return { target: 'settings', isExplicitOpen };
  }
  if (
    /\b(?:phieu\s*bao\s*gia|chon\s*bao\s*gia|bill\s*hien\s*tai|bill\s*dang\s*mo|don\s*dang\s*mo)\b/i.test(
      folded
    )
  ) {
    return { target: 'workspace', isExplicitOpen };
  }

  return { target: '', isExplicitOpen: false };
}

function inferFollowUpTopicFromHistory(
  foldedCurrent: string,
  timeScope: TimeScope,
  recentMessages?: { role: 'user' | 'model'; text: string }[]
): AiNavigateTarget {
  if (timeScope.kind === 'unspecified' || !recentMessages?.length) return '';
  // Only inherit if current message is a short time follow-up like "còn hôm qua?", "tháng trước thì sao?"
  if (foldedCurrent.split(' ').length > 8) return '';
  for (let i = recentMessages.length - 1; i >= 0; i -= 1) {
    const m = recentMessages[i];
    if (m.role !== 'user') continue;
    const prevFolded = foldVi(m.text);
    if (prevFolded === foldedCurrent) continue;
    const prevNav = detectNavigationTarget(prevFolded);
    if (prevNav.target) return prevNav.target;
    if (/\b(?:may\s*don|don\s*hom|bao\s*gia)\b/i.test(prevFolded)) {
      return 'saved';
    }
    break;
  }
  return '';
}

function formatRevenueEntryLine(e: RevenueEntry): string {
  return `• [${formatISODateVN(e.orderDate)}] [${getRevenueEntryPaymentBadge(e)}] ${e.invoiceCode || 'Nhập tay'} · ${e.customerName || 'Khách lẻ'}: Thiết kế ${formatVND(e.designAmount)} + In ${formatVND(e.printAmount)} = ${formatVND(e.totalRevenue)}`;
}

export function runSmartWorkspaceAssistant(
  rawUserText: string,
  ctx: FullWebContextInput
): SmartAssistantResult {
  const trimmed = rawUserText.trim();
  const folded = foldVi(trimmed);
  const action = createDefaultOrderAction();

  // 1. Direct "OK" confirmation on pending proposal
  if (
    hasMeaningfulOrderChanges(ctx.pendingProposal) &&
    isPureConfirmationInput(trimmed)
  ) {
    const execAction: AiOrderAction = {
      ...ctx.pendingProposal!,
      actionType: 'EXECUTE_ORDER',
    };
    const deductText =
      execAction.discountAmount >= MIN_VOUCHER_DISCOUNT_AMOUNT
        ? ` (đã tự động trừ -${formatVND(execAction.discountAmount)} vào Quỹ Voucher tháng)`
        : '';
    return {
      reply: `Đã chốt áp dụng và đồng bộ trực tiếp vào đơn hàng trên web${deductText}!`,
      orderAction: execAction,
    };
  }

  // 2. Check if user is placing an order OR updating discount / deposit / shipping / customer / stage on bill
  const inlineOk = hasInlineConfirmation(trimmed);
  const infoQuestionOnly = isPriceOrInfoQuestionOnly(folded);

  let parsedItems: AiOrderItemDraft[] = [];
  let nextDiscount = -1;
  let nextDeposit = -1;
  let nextShipping = -1;
  let nextCustomerName = '';
  let nextCustomerPhone = '';
  let nextStage: ReportStage | '' = '';
  let nextMarkRemainingPaid: boolean | null = null;
  let nextRemainingPaidAt = '';
  let createNewBill = false;
  let targetSavedInvoiceId = '';

  if (!infoQuestionOnly) {
    const hasOrderCue =
      /\b(?:dat|them|len\s*don|tao\s*don|lay|cho\s*khach|ep\s*nhua|plastic|formex|foxmex|fomex|decal|thiet\s*ke\s*menu|thiet\s*ke\s*poster|phu\s*phi)\b/i.test(
        folded
      );

    if (hasOrderCue) {
      parsedItems = parseOrderItemsFromText(trimmed, ctx.products);
    }

    if (
      /\b(?:bo\s*giam\s*gia|xoa\s*giam\s*gia|khong\s*giam\s*gia|giam\s*0d?)\b/i.test(
        folded
      )
    ) {
      nextDiscount = 0;
    } else {
      const discAmt = extractMoneyAfterKeyword(
        folded,
        /\b(?:giam\s*cho\s*khach|giam\s*khach|giam\s*gia\s*khach|giam\s*gia|tru\s*voucher|voucher\s*giam|chiet\s*khau|bot\s*khach|giam)\s*(?:la|muc|con|them)?\s*:?\s*(\d+(?:[.,]\d+)?\s*(?:tr|trieu|k|nghin|ngan|d|vnd|dong)?|\d{1,3}(?:[.,]\d{3})+)/i
      );
      if (discAmt !== null && discAmt >= 0) {
        nextDiscount = discAmt;
      }
    }

    if (/\b(?:bo\s*coc|xoa\s*coc|chua\s*coc|coc\s*0d?)\b/i.test(folded)) {
      nextDeposit = 0;
    } else {
      const depAmt = extractMoneyAfterKeyword(
        folded,
        /\b(?:da\s*coc|nhan\s*coc|dat\s*coc|tien\s*coc|ghi\s*coc|khach\s*coc|coc)\s*:?\s*(\d+(?:[.,]\d+)?\s*(?:tr|trieu|k|nghin|ngan|d|vnd|dong)?|\d{1,3}(?:[.,]\d{3})+)/i
      );
      if (depAmt !== null && depAmt >= 0) {
        nextDeposit = depAmt;
      }
    }

    if (
      /\b(?:freeship|free\s*ship|mien\s*ship|mien\s*phi\s*ship|ship\s*0d?)\b/i.test(
        folded
      )
    ) {
      nextShipping = 0;
    } else {
      const shipAmt = extractMoneyAfterKeyword(
        folded,
        /\b(?:phi\s*ship|tien\s*ship|phi\s*van\s*chuyen|ship)\s*:?\s*(\d+(?:[.,]\d+)?\s*(?:tr|trieu|k|nghin|ngan|d|vnd|dong)?|\d{1,3}(?:[.,]\d{3})+)/i
      );
      if (shipAmt !== null && shipAmt >= 0) {
        nextShipping = shipAmt;
      }
    }

    if (
      /\b(?:bo\s*tich\s*(?:da\s*thu\s*)?phan\s*con\s*lai|chua\s*thu\s*phan\s*con\s*lai|huy\s*thu\s*phan\s*con\s*lai)\b/i.test(
        folded
      )
    ) {
      nextMarkRemainingPaid = false;
      nextRemainingPaidAt = '';
    } else if (
      /\b(?:tich\s*(?:da\s*thu\s*)?phan\s*con\s*lai|da\s*thu\s*phan\s*con\s*lai|thanh\s*toan\s*phan\s*con\s*lai|thu\s*not\s*phan\s*con\s*lai|thu\s*phan\s*con\s*lai|tat\s*toan\s*don|tat\s*toan\s*bill|xac\s*nhan\s*hoan\s*thanh|hoan\s*thanh\s*don)\b/i.test(
        folded
      )
    ) {
      nextMarkRemainingPaid = true;
      nextStage = 'hoan_thanh';
      const cmdDateScope = resolveTimeScope(trimmed, folded);
      nextRemainingPaidAt =
        cmdDateScope.kind === 'day' ? cmdDateScope.dateISO : getLocalISODate(0);
    }

    if (
      parsedItems.length > 0 ||
      nextDiscount >= 0 ||
      nextDeposit >= 0 ||
      nextShipping >= 0 ||
      nextMarkRemainingPaid !== null ||
      /\b(?:ten\s*khach|cap\s*nhat\s*khach|doi\s*ten\s*khach|ghi\s*khach|khach\s*hang)\b/i.test(
        folded
      )
    ) {
      const phoneMatch = trimmed.match(/\b(0\d{8,10})\b/);
      if (phoneMatch) {
        nextCustomerPhone = phoneMatch[1];
      }
      const nameMatch = trimmed.match(
        /(?:cho\s+khách|tên\s+khách|khách\s+hàng|khách)\s*:?\s*([A-ZÀ-Ỹa-zà-ỹ][A-ZÀ-Ỹa-zà-ỹ\s]{1,30}?)(?=\s+(?:0\d{8,10}|sđt|sdt|giảm|cọc|ship|và\s+ok|ok\b|oke\b|chốt\b)|[,;.]|$)/iu
      );
      if (nameMatch && nameMatch[1]) {
        const candidate = nameMatch[1].trim();
        const candFold = foldVi(candidate);
        if (
          candFold &&
          !/^(?:le|tren bill|hien tai|nay|tu|dat|hang|in|gia|hom nay|hom qua|nao)$/i.test(
            candFold
          ) &&
          !candFold.includes('tu 1')
        ) {
          nextCustomerName = candidate;
        }
      }
    }

    if (
      !nextStage &&
      /\b(?:chuyen\s*giai\s*doan|doi\s*trang\s*thai|de\s*giai\s*doan|cap\s*nhat\s*don|chot\s*in|chot\s*thiet\s*ke|hoan\s*thanh\s*don)\b/i.test(
        folded
      )
    ) {
      if (/\bchot\s*in\b/i.test(folded)) nextStage = 'chot_in';
      else if (/\bchot\s*thiet\s*ke\b/i.test(folded))
        nextStage = 'chot_thiet_ke';
      else if (/\bhoan\s*thanh\b/i.test(folded)) {
        nextStage = 'hoan_thanh';
        nextMarkRemainingPaid = true;
        const cmdDateScope = resolveTimeScope(trimmed, folded);
        nextRemainingPaidAt =
          cmdDateScope.kind === 'day'
            ? cmdDateScope.dateISO
            : getLocalISODate(0);
      } else if (/\bcham\s*soc\b/i.test(folded)) nextStage = 'cham_soc';
      else if (/\bgiai\s*doan\s*coc\b/i.test(folded)) nextStage = 'coc';
      else if (/\bgiai\s*doan\s*bao\s*gia\b/i.test(folded))
        nextStage = 'bao_gia';
    }

    if (
      /\b(?:tao\s*bill\s*moi|lap\s*bill\s*moi|tach\s*don\s*moi|don\s*moi\s*hoan\s*toan)\b/i.test(
        folded
      )
    ) {
      createNewBill = true;
    } else {
      const targetSaved = findTargetSavedInvoice(
        trimmed,
        folded,
        ctx.savedInvoices
      );
      if (targetSaved) {
        targetSavedInvoiceId = targetSaved.id;
      }
    }
  }

  const candidateOrderAction: AiOrderAction = {
    actionType: inlineOk ? 'EXECUTE_ORDER' : 'PROPOSE_ORDER',
    targetSavedInvoiceId,
    createNewBill,
    customerName: nextCustomerName,
    customerPhone: nextCustomerPhone,
    discountAmount: nextDiscount,
    shippingFee: nextShipping,
    depositAmount: nextDeposit,
    reportStage: nextStage,
    markRemainingPaid: nextMarkRemainingPaid,
    remainingPaidAt: nextRemainingPaidAt,
    navigateTarget: 'workspace',
    autoNavigate: false,
    itemsToAdd: parsedItems,
  };

  if (hasMeaningfulOrderChanges(candidateOrderAction)) {
    const addedSum = parsedItems.reduce(
      (s, it) => s + it.quantity * it.unitPrice,
      0
    );
    const lines: string[] = [];

    if (inlineOk) {
      lines.push('Đã tiếp nhận và thực thi đồng bộ ngay lên bill:');
    } else {
      lines.push('Đã chuẩn bị thông tin cập nhật đơn hàng trên bill:');
    }

    for (const it of parsedItems) {
      lines.push(
        `- ${it.name}: ${it.quantity} ${it.unit} × ${formatVND(it.unitPrice)} = ${formatVND(it.quantity * it.unitPrice)}`
      );
    }
    if (parsedItems.length > 1) {
      lines.push(`- Tạm tính món thêm: ${formatVND(addedSum)}`);
    }
    if (nextCustomerName || nextCustomerPhone) {
      lines.push(
        `- Khách hàng: ${nextCustomerName || ctx.customer.name || 'Khách lẻ'}${nextCustomerPhone ? ` (${nextCustomerPhone})` : ''}`
      );
    }
    if (nextDiscount >= 0) {
      if (nextDiscount >= MIN_VOUCHER_DISCOUNT_AMOUNT) {
        lines.push(
          `- Giảm giá khách: ${formatVND(nextDiscount)} → Tự động trừ thẳng -${formatVND(nextDiscount)} vào Quỹ Voucher tháng.`
        );
      } else {
        lines.push(`- Giảm giá khách: ${formatVND(nextDiscount)}`);
      }
    }
    if (nextDeposit >= 0) {
      lines.push(`- Tiền cọc (Đợt 1): ${formatVND(nextDeposit)}`);
    }
    if (nextShipping >= 0) {
      lines.push(`- Phí ship: ${formatVND(nextShipping)}`);
    }
    if (nextMarkRemainingPaid === true) {
      lines.push(
        `- Thanh toán Đợt 2: Tích đã thu phần còn lại · Ghi nhận doanh thu vào ngày ${formatISODateVN(nextRemainingPaidAt)} (Chuyển sang Hoàn thành)`
      );
    } else if (nextMarkRemainingPaid === false) {
      lines.push('- Thanh toán Đợt 2: Bỏ tích đã thu phần còn lại');
    } else if (nextStage) {
      lines.push(`- Giai đoạn đơn: ${getReportStageLabel(nextStage)}`);
    }

    if (!inlineOk) {
      lines.push(
        'Bạn bấm nút "OK · Áp dụng & liên kết ngay" bên dưới hoặc nhắn "ok" để lưu đồng bộ vào đơn nhé.'
      );
    }

    return {
      reply: lines.join('\n'),
      orderAction: candidateOrderAction,
    };
  }

  // 3. Synchronized Live Data Queries Across All 8 Web Sections
  const timeScope = resolveTimeScope(trimmed, folded);
  const directNav = detectNavigationTarget(folded);
  const inheritedTopic =
    !directNav.target
      ? inferFollowUpTopicFromHistory(folded, timeScope, ctx.recentMessages)
      : '';
  const effectiveTarget: AiNavigateTarget = directNav.target || inheritedTopic;
  const todayISO = getLocalISODate(0);
  const currentMonthKey = getCurrentMonthKeyLocal();

  // 3A. BÁO CÁO DOANH THU (Hôm nay / Hôm qua / Ngày DD/MM / 7 ngày / Tháng / Lũy kế)
  if (
    effectiveTarget === 'reports_revenue' ||
    /\b(?:doanh\s*thu|tien\s*thiet\s*ke|tien\s*in|ban\s*duoc\s*bao\s*nhieu|chot\s*duoc\s*bao\s*nhieu|thu\s*nhap|tong\s*thu)\b/i.test(
      folded
    )
  ) {
    const activeRevEntries = getSynchronizedActiveRevenueEntries(ctx);

    // Case 1: Specific Day ("hôm nay", "hôm qua", "ngày DD/MM") or 7-day range
    if (timeScope.kind === 'day' || timeScope.kind === 'range') {
      const stats = computeRevenueWindowStats(
        activeRevEntries,
        ctx.savedInvoices,
        ctx.products,
        ctx.store.footerNote,
        timeScope.matchDate
      );

      const lines: string[] = [
        `Báo cáo doanh thu ${timeScope.label} (đồng bộ mục Báo cáo doanh thu):`,
        `- Đơn thành công ghi nhận doanh thu: ${stats.orderCount} đơn (${stats.customerCount} khách đặt hàng)`,
        `- Tiền thiết kế: ${formatVND(stats.designAmount)}`,
        `- Tiền in: ${formatVND(stats.printAmount)}`,
        `- Tổng doanh thu ${timeScope.shortLabel}: ${formatVND(stats.totalRevenue)}`,
      ];

      if (stats.entries.length > 0) {
        lines.push(`Chi tiết đơn thành công (${stats.entries.length} đơn):`);
        for (const e of stats.entries.slice(0, 10)) {
          lines.push(formatRevenueEntryLine(e));
        }
        if (stats.entries.length > 10) {
          lines.push(`• ... và ${stats.entries.length - 10} đơn khác.`);
        }
      } else {
        lines.push(
          `- Trong ${timeScope.label} hiện chưa có đơn nào ở trạng thái Cọc / Chốt in / Chốt thiết kế / Hoàn thành (hoặc nhập tay) nên doanh thu đơn thành công = 0đ.`
        );
      }

      // Cross-reconcile with Saved Invoices created in that same window so staff sees 100% parity
      if (stats.pendingInvoicesCount > 0) {
        lines.push(
          `- Đối soát Báo giá đã lưu (${timeScope.shortLabel}): Đang có ${stats.pendingInvoicesCount} phiếu ở giai đoạn Báo giá / Chăm sóc trị giá ${formatVND(stats.pendingNetAmount)} chưa chốt cọc (khi chuyển sang Cọc / Chốt sẽ tự cộng vào doanh thu).`
        );
      } else if (stats.totalInvoicesCount > 0) {
        lines.push(
          `- Đối soát thu tiền (${timeScope.shortLabel}): Đã nhận cọc ${formatVND(stats.depositSum)} · Còn phải thu ${formatVND(stats.remainingSum)}.`
        );
      }

      if (
        timeScope.kind === 'day' &&
        timeScope.subKind === 'today' &&
        ctx.quoteItems.length > 0 &&
        !ctx.editingInvoiceId
      ) {
        lines.push(
          `- Lưu ý trên màn hình: Đang mở 1 bill nháp chưa lưu (${ctx.quoteItems.length} món, tạm tính ${formatVND(ctx.totals.subtotal)}).`
        );
      }

      return {
        reply: lines.join('\n'),
        orderAction: {
          ...action,
          navigateTarget: 'reports_revenue',
          autoNavigate: directNav.isExplicitOpen,
        },
      };
    }

    // Case 2: All-time cumulative revenue ("doanh thu tất cả các tháng" / "lũy kế")
    if (timeScope.kind === 'all') {
      const allStats = computeRevenueWindowStats(
        activeRevEntries,
        ctx.savedInvoices,
        ctx.products,
        ctx.store.footerNote,
        () => true
      );
      const byMonth = new Map<string, RevenueEntry[]>();
      for (const e of activeRevEntries) {
        const list = byMonth.get(e.monthKey) || [];
        list.push(e);
        byMonth.set(e.monthKey, list);
      }
      const monthRows = Array.from(byMonth.keys())
        .sort((a, b) => b.localeCompare(a))
        .slice(0, 6)
        .map((mk) => {
          const list = byMonth.get(mk) || [];
          const dSum = list.reduce((s, x) => s + x.designAmount, 0);
          const pSum = list.reduce((s, x) => s + x.printAmount, 0);
          const ordCnt = countDistinctOrdersInEntries(list);
          return `• Tháng ${mk.slice(5, 7)}/${mk.slice(0, 4)}: ${countDistinctCustomersInEntries(list)} khách (${ordCnt} đơn${list.length > ordCnt ? ` · ${list.length} đợt thu` : ''}) — Thiết kế ${formatVND(dSum)} | In ${formatVND(pSum)} | Tổng ${formatVND(dSum + pSum)}`;
        });

      return {
        reply: [
          `Tổng doanh thu lũy kế tất cả các tháng (${allStats.orderCount} đơn thành công · ${allStats.customerCount} khách):`,
          `- Tổng Tiền thiết kế: ${formatVND(allStats.designAmount)}`,
          `- Tổng Tiền in: ${formatVND(allStats.printAmount)}`,
          `- Tổng doanh thu lũy kế: ${formatVND(allStats.totalRevenue)}`,
          ...(monthRows.length > 0
            ? ['Chi tiết theo từng tháng:', ...monthRows]
            : []),
        ].join('\n'),
        orderAction: {
          ...action,
          navigateTarget: 'reports_revenue',
          autoNavigate: directNav.isExplicitOpen,
        },
      };
    }

    // Case 3: Specific Month ("tháng này", "tháng trước", "tháng 9") OR Unspecified ("doanh thu")
    const targetMk =
      timeScope.kind === 'month' ? timeScope.monthKey : currentMonthKey;
    const targetRange = getMonthDateRangeVN(targetMk);
    const monthStats = computeRevenueWindowStats(
      activeRevEntries,
      ctx.savedInvoices,
      ctx.products,
      ctx.store.footerNote,
      (d) => d.slice(0, 7) === targetMk
    );

    const todayStats = computeRevenueWindowStats(
      activeRevEntries,
      ctx.savedInvoices,
      ctx.products,
      ctx.store.footerNote,
      (d) => d === todayISO
    );

    const lines: string[] = [];
    // If user asked generic "doanh thu" without specifying month vs today, show Today right at top + Current Month below!
    if (timeScope.kind === 'unspecified') {
      lines.push(
        `1) Doanh thu hôm nay (${formatISODateVN(todayISO)}): ${formatVND(todayStats.totalRevenue)} (${todayStats.orderCount} đơn thành công · ${todayStats.customerCount} khách — Thiết kế: ${formatVND(todayStats.designAmount)} | In: ${formatVND(todayStats.printAmount)})${todayStats.pendingInvoicesCount > 0 ? ` · Ngoài ra có ${todayStats.pendingInvoicesCount} báo giá hôm nay đang chờ chốt (${formatVND(todayStats.pendingNetAmount)})` : ''}`
      );
      lines.push('');
      lines.push(
        `2) Doanh thu ${targetRange.monthLabel} (${targetRange.rangeVN}):`
      );
    } else {
      lines.push(
        `Báo cáo doanh thu ${targetRange.monthLabel} (${targetRange.rangeVN}):`
      );
    }

    lines.push(
      `- Số khách đặt hàng thành công: ${monthStats.customerCount} khách (${monthStats.orderCount} đơn)`
    );
    lines.push(`- Tiền thiết kế: ${formatVND(monthStats.designAmount)}`);
    lines.push(`- Tiền in: ${formatVND(monthStats.printAmount)}`);
    lines.push(`- Tổng doanh thu tháng: ${formatVND(monthStats.totalRevenue)}`);

    if (monthStats.pendingInvoicesCount > 0) {
      lines.push(
        `- Phiếu đang Báo giá / Chăm sóc trong tháng (chưa tính vào doanh thu): ${monthStats.pendingInvoicesCount} phiếu (${formatVND(monthStats.pendingNetAmount)})`
      );
    }

    if (targetMk === currentMonthKey && timeScope.kind === 'month') {
      lines.push(
        `- Riêng hôm nay (${formatISODateVN(todayISO)}): ${formatVND(todayStats.totalRevenue)} (${todayStats.orderCount} đơn thành công)`
      );
    }

    return {
      reply: lines.join('\n'),
      orderAction: {
        ...action,
        navigateTarget: 'reports_revenue',
        autoNavigate: directNav.isExplicitOpen,
      },
    };
  }

  // 3B. QUỸ VOUCHER THÁNG (Hôm nay / Tháng này / Tháng trước / Tháng MM/YYYY / Đơn giảm chưa cọc)
  if (
    effectiveTarget === 'plan_voucher' ||
    /\b(?:voucher|quy\s*giam|tru\s*quy|muc\s*1\.?000|giam\s*tu\s*1\.?000)\b/i.test(
      folded
    )
  ) {
    // Daily voucher check (e.g. "hôm nay trừ bao nhiêu voucher")
    if (timeScope.kind === 'day' || timeScope.kind === 'range') {
      const matchedOrders = ctx.savedInvoices
        .filter((inv) =>
          timeScope.matchDate(isoTimestampToLocalOrderDate(inv.createdAt))
        )
        .map((inv) => ({
          invoice: inv,
          audit: auditInvoiceVoucher(inv, ctx.store.footerNote),
        }))
        .filter((r) => r.audit.isQualifiedVoucher);

      const sumDeducted = matchedOrders.reduce(
        (s, r) => s + r.audit.voucherDeductAmount,
        0
      );
      const monthVoucher = computeVoucherMonthStats(
        ctx.savedInvoices,
        ctx.voucherBudgets,
        ctx.store.footerNote,
        currentMonthKey
      );

      const lines = [
        `Đối soát trừ Quỹ Voucher ${timeScope.label} (Quy tắc: giảm khách ≥ 1.000đ trừ thẳng vào quỹ):`,
        `- Đã trừ quỹ ${timeScope.shortLabel}: -${formatVND(sumDeducted)} (${matchedOrders.length} đơn giảm giá)`,
        ...(matchedOrders.length > 0
          ? matchedOrders
              .slice(0, 8)
              .map(
                (r) =>
                  `• ${r.invoice.code} (${r.invoice.customer.name || 'Khách lẻ'}): -${formatVND(r.audit.voucherDeductAmount)} (${r.audit.isCoc ? 'Đã cọc' : 'Chưa ghi Cọc'})`
              )
          : [
              `- Trong ${timeScope.label} chưa phát sinh hóa đơn nào giảm giá ≥ 1.000đ.`,
            ]),
        `- Quỹ Voucher ${monthVoucher.monthLabel} hiện còn lại: ${formatVND(monthVoucher.remainingBudget)} / ${formatVND(monthVoucher.budgetAmount)}`,
      ];

      return {
        reply: lines.join('\n'),
        orderAction: {
          ...action,
          navigateTarget: 'plan_voucher',
          autoNavigate: directNav.isExplicitOpen,
        },
      };
    }

    const targetMk =
      timeScope.kind === 'month' ? timeScope.monthKey : currentMonthKey;
    const vStats = computeVoucherMonthStats(
      ctx.savedInvoices,
      ctx.voucherBudgets,
      ctx.store.footerNote,
      targetMk
    );

    const askingNoCocOnly = /\bgiam\s*chua\s*coc|chua\s*ghi\s*coc\b/i.test(
      folded
    );
    const detailRows = askingNoCocOnly
      ? vStats.discountedWithoutCocOrders
          .slice(0, 8)
          .map(
            (r) =>
              `• [${formatISODateVN(r.orderDate)}] ${r.invoice.code} (${r.invoice.customer.name || 'Khách lẻ'}): -${formatVND(r.deductAmount)} [${r.stageLabel}]`
          )
      : vStats.qualifiedOrders
          .slice(0, 8)
          .map(
            (r) =>
              `• [${formatISODateVN(r.orderDate)}] ${r.invoice.code} (${r.invoice.customer.name || 'Khách lẻ'}): -${formatVND(r.deductAmount)} (${r.isCoc ? 'Đã cọc' : 'Chưa ghi Cọc'})`
          );

    const replyLines = [
      `Quỹ Voucher ${vStats.monthLabel} (Quy tắc đồng bộ: giảm khách từ 1.000đ trở lên trừ thẳng vào quỹ):`,
      `- Ngân sách tháng: ${formatVND(vStats.budgetAmount)}`,
      `- Đã trừ quỹ: -${formatVND(vStats.totalUsedDiscount)} (${vStats.qualifiedCount} đơn có giảm ≥ 1.000đ)`,
      `- Quỹ còn lại: ${formatVND(vStats.remainingBudget)}${vStats.overBudgetAmount > 0 ? ` (Vượt quỹ +${formatVND(vStats.overBudgetAmount)})` : ''}`,
      vStats.discountedWithoutCocCount > 0
        ? `- Đối soát lưu ý: Có ${vStats.discountedWithoutCocCount} đơn giảm giá nhưng chưa ghi nhận Cọc.`
        : '',
      ...(detailRows.length > 0
        ? [
            askingNoCocOnly
              ? 'Các đơn giảm giá chưa ghi Cọc:'
              : 'Các đơn đã trừ Quỹ trong tháng:',
            ...detailRows,
          ]
        : ['- Hiện chưa có đơn đã lưu nào phát sinh giảm giá trong tháng này.']),
    ].filter(Boolean);

    return {
      reply: replyLines.join('\n'),
      orderAction: {
        ...action,
        navigateTarget: 'plan_voucher',
        autoNavigate: directNav.isExplicitOpen,
      },
    };
  }

  // 3C. KHO HÀNG & BẢNG SẢN PHẨM CẦN ĐẶT (12 vật tư chuẩn + tùy chỉnh, Băng keo = cây)
  if (
    effectiveTarget === 'inventory_reorder' ||
    effectiveTarget === 'inventory_stock' ||
    /\b(?:bang\s*keo|chong\s*soc|mang\s*bobb|giay\s*in\s*anh|mieng\s*nhua|giay\s*decal|ton\s*kho|can\s*dat|het\s*hang)\b/i.test(
      folded
    )
  ) {
    const specificMatches = matchInventoryItemsByQuery(
      folded,
      ctx.inventoryItems
    );

    const reorderLines =
      ctx.inventoryAlerts.length > 0
        ? ctx.inventoryAlerts.map(
            (a, idx) =>
              `${idx + 1}. ${a.itemName} — Đặt: ${a.orderQuantity} ${a.orderUnitLabel} (Tồn hiện tại: ${a.quantity} ${a.unit.toLowerCase()})`
          )
        : [
            '- Hiện tại tất cả vật tư trong kho đều đủ định mức, không có món nào cần đặt thêm.',
          ];

    const replyParts: string[] = [];
    if (specificMatches.length > 0) {
      replyParts.push('Tình trạng vật tư thực tế trong kho:');
      for (const m of specificMatches) {
        const alert = ctx.inventoryAlerts.find((a) => a.itemId === m.id);
        replyParts.push(
          `- ${m.name}: Còn ${m.quantity} ${m.unit.toLowerCase()} (Định mức báo ≤ ${m.minThreshold} ${m.unit.toLowerCase()})${alert ? ` → Cần đặt: ${alert.orderQuantity} ${alert.orderUnitLabel}` : ' → Đủ dùng'}`
        );
      }
      return {
        reply: replyParts.join('\n'),
        orderAction: {
          ...action,
          navigateTarget: specificMatches.some((m) =>
            ctx.inventoryAlerts.some((a) => a.itemId === m.id)
          )
            ? 'inventory_reorder'
            : 'inventory_stock',
          autoNavigate: directNav.isExplicitOpen,
        },
      };
    }

    if (
      effectiveTarget === 'inventory_stock' &&
      !/\b(?:can\s*dat|bang\s*dat)\b/i.test(folded)
    ) {
      replyParts.push(
        `Tồn kho hiện tại (${ctx.inventoryItems.length} vật tư — ${ctx.inventoryAlerts.length} món cần đặt thêm):`
      );
      for (const item of ctx.inventoryItems) {
        const alert = ctx.inventoryAlerts.find((a) => a.itemId === item.id);
        replyParts.push(
          `- ${item.name}: ${item.quantity} ${item.unit.toLowerCase()}${alert ? ` (Cần đặt ${alert.orderQuantity} ${alert.orderUnitLabel})` : ''}`
        );
      }
    } else {
      replyParts.push(
        `Bảng sản phẩm cần đặt kho (${ctx.inventoryAlerts.length} mặt hàng — Băng keo tính theo cây):`
      );
      replyParts.push(...reorderLines);
    }

    return {
      reply: replyParts.join('\n'),
      orderAction: {
        ...action,
        navigateTarget:
          effectiveTarget === 'inventory_stock'
            ? 'inventory_stock'
            : 'inventory_reorder',
        autoNavigate: directNav.isExplicitOpen,
      },
    };
  }

  // 3D. TIẾN ĐỘ & PHÂN LOẠI KHÁCH HÀNG (6 giai đoạn + Hôm nay / 7 ngày / Tháng này / Tất cả)
  const stageFilter = detectStageFilterInQuery(folded);
  if (effectiveTarget === 'reports_pipeline' || stageFilter !== null) {
    const scopeLabel =
      timeScope.kind === 'unspecified'
        ? 'tất cả thời gian'
        : timeScope.label;
    const pipeStats = computePipelineWindowStats(
      ctx.savedInvoices,
      timeScope.matchDate
    );

    if (stageFilter !== null) {
      const stageInvoices = pipeStats.matchedInvoices.filter((inv) =>
        stageFilter === 'unclassified'
          ? !inv.reportStage
          : inv.reportStage === stageFilter
      );
      const label =
        stageFilter === 'unclassified'
          ? 'Chưa phân loại'
          : getReportStageLabel(stageFilter);
      const remSum = stageInvoices.reduce(
        (s, inv) => s + getUncollectedRemainingAmount(inv),
        0
      );
      return {
        reply: [
          `Đơn ở giai đoạn "${label}" (${scopeLabel}): ${stageInvoices.length} đơn (Tổng còn phải thu: ${formatVND(remSum)})`,
          ...(stageInvoices.length > 0
            ? stageInvoices
                .slice(0, 10)
                .map(
                  (inv) =>
                    `• ${inv.code} (${formatDateOnlyVN(inv.createdAt)}) · ${inv.customer.name || 'Khách lẻ'}: Tổng ${formatVND(inv.totals.subtotal)}, Đã cọc ${formatVND(inv.totals.depositAmount)}, ${isInvoiceRemainingSettled(inv) ? `Đã tất toán (${formatISODateVN(getInvoiceRemainingPaidDate(inv))})` : `Còn lại ${formatVND(getUncollectedRemainingAmount(inv))}`}`
                )
            : [`- Không có đơn nào ở giai đoạn "${label}" trong ${scopeLabel}.`]),
        ].join('\n'),
        orderAction: {
          ...action,
          navigateTarget: 'reports_pipeline',
          autoNavigate: directNav.isExplicitOpen,
        },
      };
    }

    const stageLines = REPORT_STAGE_OPTIONS.map(
      (opt) => `- ${opt.label}: ${pipeStats.stageCounts[opt.value]} đơn`
    );
    if (pipeStats.unclassifiedCount > 0) {
      stageLines.push(`- Chưa phân loại: ${pipeStats.unclassifiedCount} đơn`);
    }

    return {
      reply: [
        `Thống kê tiến độ & phân loại khách hàng (${scopeLabel} — Tổng ${pipeStats.totalCount} phiếu):`,
        ...stageLines,
        `- Tổng giá trị sau giảm + ship: ${formatVND(pipeStats.netOrderTotal)}`,
        `- Tổng đã thu khách: ${formatVND(pipeStats.collectedTotal)} (Cọc đợt 1: ${formatVND(pipeStats.depositTotal)}) | Tổng còn phải thu: ${formatVND(pipeStats.remainingTotal)}`,
      ].join('\n'),
      orderAction: {
        ...action,
        navigateTarget: 'reports_pipeline',
        autoNavigate: directNav.isExplicitOpen,
      },
    };
  }

  // 3E. DANH SÁCH & DATE KHÁCH HÀNG (Kế Hoạch -> Date KH, hợp nhất với Hóa đơn)
  if (effectiveTarget === 'plan_customers') {
    const merged = computeMergedCustomerDirectory(
      ctx.workspaceCustomers,
      ctx.savedInvoices,
      ctx.store.footerNote
    );

    if (/\bkhach\s*chua\s*co\s*bill\b/i.test(folded)) {
      const noBill = merged.filter((c) => c.invoiceCount === 0);
      return {
        reply: [
          `Khách hàng đã lưu lịch hẹn nhưng chưa phát sinh bill (${noBill.length} khách):`,
          ...(noBill.length > 0
            ? noBill
                .slice(0, 10)
                .map(
                  (c) =>
                    `• ${c.name} (${c.phone || 'chưa SĐT'}) · Date hẹn: ${formatISODateVN(c.customerDate) || 'Chưa đặt'}${c.note ? ` · ${c.note}` : ''}`
                )
            : ['- Tất cả khách trong danh sách đều đã có bill.']),
        ].join('\n'),
        orderAction: {
          ...action,
          navigateTarget: 'plan_customers',
          autoNavigate: directNav.isExplicitOpen,
        },
      };
    }

    const filteredByDate =
      timeScope.kind === 'day' || timeScope.kind === 'range'
        ? merged.filter((c) => timeScope.matchDate(c.customerDate))
        : merged;

    const header =
      timeScope.kind === 'day' || timeScope.kind === 'range'
        ? `Danh sách & lịch Date Khách hàng ${timeScope.label} (${filteredByDate.length} khách):`
        : `Danh sách Khách hàng hợp nhất trên hệ thống (${merged.length} khách tổng cộng · ${ctx.workspaceCustomers.length} khách lưu lịch Date KH):`;

    return {
      reply: [
        header,
        ...(filteredByDate.length > 0
          ? filteredByDate
              .slice(0, 10)
              .map(
                (c) =>
                  `• ${c.name}${c.phone ? ` (${c.phone})` : ''} · Date: ${formatISODateVN(c.customerDate) || 'Chưa đặt'} · ${c.invoiceCount} đơn (Chi ${formatVND(c.totalSpent)}${c.totalDiscountReceived > 0 ? `, Giảm ${formatVND(c.totalDiscountReceived)}` : ''})`
              )
          : ['- Chưa có khách hàng nào khớp thời gian này.']),
      ].join('\n'),
      orderAction: {
        ...action,
        navigateTarget: 'plan_customers',
        autoNavigate: directNav.isExplicitOpen,
      },
    };
  }

  // 3F. BÁO GIÁ ĐÃ LƯU & TRA CỨU ĐƠN HÀNG / SỐ ĐIỆN THOẠI / HÔM NAY CÓ MẤY ĐƠN
  const phoneLookupMatch = trimmed.match(/\b(0\d{8,10})\b/);
  const explicitInvoiceLookup = findTargetSavedInvoice(
    trimmed,
    folded,
    ctx.savedInvoices
  );
  const isAskingOrdersOrTodaySummary =
    effectiveTarget === 'saved' ||
    Boolean(explicitInvoiceLookup) ||
    Boolean(phoneLookupMatch) ||
    /\b(?:may\s*don|bao\s*nhieu\s*don|may\s*khach|co\s*don\s*nao|don\s*hom\s*nay|don\s*hom\s*qua|bao\s*gia\s*hom\s*nay|tim\s*don|tra\s*cuu\s*don|tinh\s*hinh\s*hom\s*nay|tom\s*tat\s*hom\s*nay)\b/i.test(
      folded
    ) ||
    (timeScope.kind !== 'unspecified' &&
      /\b(?:don|khach|bao\s*gia|bill|tinh\s*hinh|tom\s*tat)\b/i.test(folded));

  if (isAskingOrdersOrTodaySummary) {
    if (explicitInvoiceLookup) {
      const inv = explicitInvoiceLookup;
      const audit = auditInvoiceVoucher(inv, ctx.store.footerNote);
      const settled = isInvoiceRemainingSettled(inv);
      const uncollected = getUncollectedRemainingAmount(inv);
      return {
        reply: [
          `Chi tiết đơn đã lưu ${inv.code} (${formatDateOnlyVN(inv.createdAt)}):`,
          `- Khách hàng: ${inv.customer.name || 'Khách lẻ'}${inv.customer.phone ? ` (${inv.customer.phone})` : ''}`,
          `- Giai đoạn: ${getReportStageLabel(inv.reportStage)}${settled ? ` · Đã thu phần còn lại ngày ${formatISODateVN(getInvoiceRemainingPaidDate(inv))}` : ''}`,
          `- Sản phẩm (${inv.items.length} dòng): ${inv.items.map((i) => `${i.name} ×${i.quantity}`).join(', ')}`,
          `- Thanh toán: Tổng ${formatVND(inv.totals.subtotal)} | Giảm ${formatVND(inv.totals.discountAmount)}${audit.isQualifiedVoucher ? ` (Trừ Quỹ Voucher -${formatVND(audit.voucherDeductAmount)})` : ''} | Ship ${formatVND(inv.totals.shippingFee)} | Đã cọc Đợt 1 ${formatVND(inv.totals.depositAmount)} | ${settled ? `Đã tất toán Đợt 2 (${formatVND(inv.totals.remainingAmount)}) — Còn phải thu 0đ` : `Còn phải thu Đợt 2 ${formatVND(uncollected)}`}`,
        ].join('\n'),
        orderAction: {
          ...action,
          navigateTarget: 'saved',
          autoNavigate: directNav.isExplicitOpen,
        },
      };
    }

    if (phoneLookupMatch) {
      const digits = phoneLookupMatch[1];
      const byPhone = ctx.savedInvoices.filter((inv) =>
        inv.customer.phone.replace(/\D/g, '').includes(digits)
      );
      return {
        reply:
          byPhone.length > 0
            ? [
                `Tìm thấy ${byPhone.length} báo giá của SĐT ${digits}:`,
                ...byPhone
                  .slice(0, 8)
                  .map(
                    (inv) =>
                      `• ${inv.code} (${formatDateOnlyVN(inv.createdAt)}) · ${inv.customer.name || 'Khách lẻ'} · Tổng ${formatVND(inv.totals.subtotal)} · ${isInvoiceRemainingSettled(inv) ? `Đã tất toán (${formatISODateVN(getInvoiceRemainingPaidDate(inv))})` : `Còn lại ${formatVND(getUncollectedRemainingAmount(inv))}`} [${getReportStageLabel(inv.reportStage)}]`
                  ),
              ].join('\n')
            : `Hiện chưa tìm thấy báo giá đã lưu nào có SĐT ${digits}.`,
        orderAction: {
          ...action,
          navigateTarget: 'saved',
          autoNavigate: directNav.isExplicitOpen,
        },
      };
    }

    // Executive snapshot when asking "tình hình hôm nay" / "đơn hôm nay" / "báo giá đã lưu"
    const effectiveMatch =
      timeScope.kind === 'unspecified' ? () => true : timeScope.matchDate;
    const activeRev = getSynchronizedActiveRevenueEntries(ctx);
    const revWindow = computeRevenueWindowStats(
      activeRev,
      ctx.savedInvoices,
      ctx.products,
      ctx.store.footerNote,
      effectiveMatch
    );

    const periodTitle =
      timeScope.kind === 'unspecified'
        ? `Tổng ${ctx.savedInvoices.length} báo giá đã lưu đồng bộ đám mây`
        : `Tổng hợp báo giá & đơn hàng ${timeScope.label}`;

    const orderLines = revWindow.matchedInvoices.slice(0, 8).map(
      (inv) =>
        `• ${inv.code} (${formatDateOnlyVN(inv.createdAt)}) · ${inv.customer.name || 'Khách lẻ'} · Tổng ${formatVND(inv.totals.subtotal)} · ${isInvoiceRemainingSettled(inv) ? `Đã tất toán (${formatISODateVN(getInvoiceRemainingPaidDate(inv))})` : `Còn lại ${formatVND(getUncollectedRemainingAmount(inv))}`} [${getReportStageLabel(inv.reportStage)}]`
    );

    const lines = [
      `${periodTitle}:`,
      `- Số phiếu báo giá đã lưu: ${revWindow.totalInvoicesCount} phiếu (${revWindow.successfulInvoicesCount} đơn đã chốt/cọc, ${revWindow.pendingInvoicesCount} phiếu đang Báo giá/Chăm sóc)`,
      `- Doanh thu đơn thành công${timeScope.shortLabel ? ` (${timeScope.shortLabel})` : ''}: ${formatVND(revWindow.totalRevenue)} (Thiết kế: ${formatVND(revWindow.designAmount)} | In: ${formatVND(revWindow.printAmount)})`,
      `- Đã thu khách: ${formatVND(revWindow.collectedCashSum)} (Cọc đợt 1: ${formatVND(revWindow.depositSum)}) | Còn phải thu: ${formatVND(revWindow.remainingSum)}${revWindow.voucherDeductSum > 0 ? ` | Trừ Quỹ Voucher: -${formatVND(revWindow.voucherDeductSum)}` : ''}`,
      ...(orderLines.length > 0
        ? ['Danh sách đơn tương ứng:', ...orderLines]
        : ['- Chưa có báo giá nào được lưu trong khoảng thời gian này.']),
    ];

    return {
      reply: lines.join('\n'),
      orderAction: {
        ...action,
        navigateTarget: 'saved',
        autoNavigate: directNav.isExplicitOpen,
      },
    };
  }

  // 3G. BẢNG GIÁ IN ẤN / HỎI GIÁ SẢN PHẨM
  if (
    effectiveTarget === 'catalog' ||
    /\b(?:bang\s*gia|gia\s*in|bao\s*nhieu\s*tien|may\s*tien|gia\s*ep\s*nhua|gia\s*plastic|gia\s*formex|gia\s*decal|ep\s*nhua\s*a[345]|formex\s*a[345])\b/i.test(
      folded
    )
  ) {
    const sizeFilter = extractSize(folded);
    const sidesFilter = extractSides(folded);
    const filtered = ctx.products.filter((p) => {
      if (sizeFilter && p.size?.toUpperCase() !== sizeFilter) return false;
      if (sidesFilter && p.sides && !p.sides.includes(sidesFilter)) return false;
      const pf = foldVi(`${p.name} ${p.category}`);
      if (/\bformex\b/i.test(folded) && !/\bep\s*nhua\b/i.test(folded)) {
        return pf.includes('formex') || pf.includes('decal');
      }
      if (/\bep\s*nhua|plastic\b/i.test(folded) && !/\bformex\b/i.test(folded)) {
        return pf.includes('ep nhua') || pf.includes('plastic');
      }
      return true;
    });

    const listToShow = filtered.length > 0 ? filtered : ctx.products;
    const lines = [
      `Bảng giá hiện hành tại ${ctx.store.companyName || 'ATD Color'}${sizeFilter ? ` (Khổ ${sizeFilter})` : ''}:`,
      ...listToShow
        .slice(0, 14)
        .map((p) => `- ${p.name}: ${formatVND(p.price)} / ${p.unit}`),
      'Bạn có thể nhắn lệnh trực tiếp để lên đơn (VD: "đặt 2 ép nhựa A4 2 mặt giảm 10k và ok") hoặc bấm "Xem bảng giá" ở đầu mục Chọn & Báo giá để sao chép ảnh gửi khách.',
    ];

    return {
      reply: lines.join('\n'),
      orderAction: {
        ...action,
        navigateTarget: effectiveTarget === 'catalog' ? 'catalog' : 'workspace',
        autoNavigate: directNav.isExplicitOpen,
      },
    };
  }

  // 3H. CÀI ĐẶT CHUNG / THÔNG TIN CÔNG TY
  if (
    effectiveTarget === 'settings' ||
    /\b(?:cong\s*ty|dia\s*chi|so\s*dien\s*thoai|zalo|tiktok|nguoi\s*lap|chu\s*ky|logo)\b/i.test(
      folded
    )
  ) {
    return {
      reply: [
        `Thông tin đơn vị cài đặt trên hệ thống:`,
        `- Tên đơn vị: ${ctx.store.companyName || 'ATD Color'}`,
        `- Người lập báo giá: ${ctx.store.preparerName || '(Chưa nhập)'} (Chữ ký: ${ctx.hasSignature ? 'Đã tải ảnh' : 'Chưa tải ảnh'})`,
        `- SĐT / Zalo: ${ctx.store.phone || '(Chưa nhập)'} | Địa chỉ: ${ctx.store.address || '(Chưa nhập)'}`,
        `- Website/Email: ${ctx.store.email || '(Chưa nhập)'} | TikTok: ${ctx.store.tiktok || '(Chưa nhập)'}`,
        `- Logo góc trái bảng giá & hóa đơn: ${ctx.hasLogo ? 'Đã cài đặt' : 'Chưa tải ảnh'}`,
      ].join('\n'),
      orderAction: {
        ...action,
        navigateTarget: 'settings',
        autoNavigate: directNav.isExplicitOpen,
      },
    };
  }

  // 3I. BILL ĐANG MỞ TRÊN MÀN HÌNH / XEM BẢN IN
  if (
    effectiveTarget === 'invoice' ||
    effectiveTarget === 'workspace' ||
    /\b(?:bill\s*hien\s*tai|bill\s*dang\s*mo|don\s*hien\s*tai|con\s*lai\s*bao\s*nhieu|tren\s*bill)\b/i.test(
      folded
    )
  ) {
    const draftAudit = auditInvoiceVoucher(
      {
        reportStage: ctx.draftInvoiceStage,
        discountAmount: ctx.totals.discountAmount,
        depositAmount: ctx.totals.depositAmount,
        totals: ctx.totals,
        customer: ctx.customer,
        items: ctx.quoteItems,
        designIllustration: ctx.designIllustration,
        invoiceNote: ctx.invoiceNote,
      },
      ctx.store.footerNote
    );

    const itemLines =
      ctx.quoteItems.length > 0
        ? ctx.quoteItems.map(
            (it, i) =>
              `  ${i + 1}. ${it.name} — ${it.quantity} ${it.unit} × ${formatVND(it.unitPrice)} = ${formatVND(it.quantity * it.unitPrice)}`
          )
        : ['  - Hiện chưa có sản phẩm nào trên bill.'];

    return {
      reply: [
        `Thông tin bill đang mở trên màn hình (${ctx.editingInvoiceCode ? `Liên kết mã ${ctx.editingInvoiceCode}` : 'Bill mới chưa lưu'}):`,
        `- Khách hàng: ${ctx.customer.name || 'Khách lẻ'}${ctx.customer.phone ? ` (${ctx.customer.phone})` : ''} | Giai đoạn: ${getReportStageLabel(ctx.draftInvoiceStage)}`,
        `- Sản phẩm (${ctx.quoteItems.length} dòng · tổng SL ${ctx.totals.totalQuantity}):`,
        ...itemLines,
        `- Tổng tiền hàng: ${formatVND(ctx.totals.subtotal)} | Giảm giá: ${formatVND(ctx.totals.discountAmount)}${draftAudit.isQualifiedVoucher ? ` (Trừ Quỹ Voucher -${formatVND(draftAudit.voucherDeductAmount)})` : ''} | Ship: ${formatVND(ctx.totals.shippingFee)} | Đã cọc: ${formatVND(ctx.totals.depositAmount)} | CÒN LẠI: ${formatVND(ctx.totals.remainingAmount)}`,
      ].join('\n'),
      orderAction: {
        ...action,
        navigateTarget: effectiveTarget === 'invoice' ? 'invoice' : 'workspace',
        autoNavigate: directNav.isExplicitOpen,
      },
    };
  }

  // 3J. TỔNG QUAN TRỰC TIẾP TOÀN HỆ THỐNG (ĐỒNG BỘ CẢ HÔM NAY & THÁNG NÀY)
  const activeRevEntries = getSynchronizedActiveRevenueEntries(ctx);
  const revToday = computeRevenueWindowStats(
    activeRevEntries,
    ctx.savedInvoices,
    ctx.products,
    ctx.store.footerNote,
    (d) => d === todayISO
  );
  const revMonth = computeRevenueWindowStats(
    activeRevEntries,
    ctx.savedInvoices,
    ctx.products,
    ctx.store.footerNote,
    (d) => d.slice(0, 7) === currentMonthKey
  );
  const voucherMonth = computeVoucherMonthStats(
    ctx.savedInvoices,
    ctx.voucherBudgets,
    ctx.store.footerNote,
    currentMonthKey
  );

  const billBrief =
    ctx.quoteItems.length > 0
      ? `${ctx.quoteItems.length} món (Tổng ${formatVND(ctx.totals.subtotal)}, Giảm ${formatVND(ctx.totals.discountAmount)}, Còn lại ${formatVND(ctx.totals.remainingAmount)})`
      : 'Đang trống (sẵn sàng lên đơn mới)';

  return {
    reply: [
      `Trợ lý ${ctx.store.companyName || 'ATD Color'} đang đồng bộ trực tiếp với mục "${TAB_LABELS[ctx.activeTab]}" và toàn bộ dữ liệu trên web:`,
      `- Doanh thu hôm nay (${formatISODateVN(todayISO)}): ${formatVND(revToday.totalRevenue)} (${revToday.orderCount} đơn thành công — Thiết kế ${formatVND(revToday.designAmount)} | In ${formatVND(revToday.printAmount)})${revToday.pendingInvoicesCount > 0 ? ` · ${revToday.pendingInvoicesCount} báo giá chờ chốt` : ''}`,
      `- Doanh thu tháng ${currentMonthKey}: ${formatVND(revMonth.totalRevenue)} (${revMonth.orderCount} đơn · ${revMonth.customerCount} khách)`,
      `- Quỹ Voucher tháng ${currentMonthKey}: Còn ${formatVND(voucherMonth.remainingBudget)} / ${formatVND(voucherMonth.budgetAmount)} (giảm khách ≥ 1.000đ tự trừ thẳng vào quỹ)`,
      `- Kho hàng: ${ctx.inventoryAlerts.length > 0 ? `${ctx.inventoryAlerts.length} vật tư cần đặt thêm (Băng keo tính theo cây)` : 'Đủ định mức'}`,
      `- Bill đang mở: ${billBrief}`,
    ].join('\n'),
    orderAction: {
      ...action,
      navigateTarget: effectiveTarget || 'workspace',
      autoNavigate: directNav.isExplicitOpen,
    },
  };
}

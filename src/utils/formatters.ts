import { QuoteItem, QuoteTotals } from '../types';

export function roundMoneyVND(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  const rounded = Math.round(amount);
  return rounded === 0 ? 0 : rounded;
}

export function formatVND(amount: number): string {
  const rounded = roundMoneyVND(amount || 0);
  return `${rounded.toLocaleString('vi-VN')}đ`;
}

export function formatNumberVN(amount: number): string {
  const rounded = roundMoneyVND(amount || 0);
  return rounded.toLocaleString('vi-VN');
}

export function parseNumericInput(raw: string): number {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10) || 0;
}

export function formatDateOnlyVN(isoString: string): string {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  } catch {
    return isoString;
  }
}

export function formatDateTimeVN(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${hh}:${min} - ${dd}/${mm}/${yyyy}`;
  } catch {
    return isoString;
  }
}

export function formatSignatureDateVN(isoString?: string): string {
  try {
    const parsed = isoString ? new Date(isoString) : new Date();
    const valid = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    const dd = String(valid.getDate()).padStart(2, '0');
    const mm = String(valid.getMonth() + 1).padStart(2, '0');
    const yyyy = valid.getFullYear();
    return `Ngày ${dd} tháng ${mm} năm ${yyyy}`;
  } catch {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `Ngày ${dd} tháng ${mm} năm ${now.getFullYear()}`;
  }
}

export function getLocalISODate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Generates customer code using local Year + Month + Day + Hour + Minute
 * Example: 202610280006
 */
export function generateCustomerCode(date = new Date()): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${min}`;
}

export function formatISODateVN(isoDate: string): string {
  if (!isoDate || !isoDate.trim()) return '';
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  return isoDate.trim();
}

export function calculateQuoteTotals(
  items: QuoteItem[],
  discountAmount = 0,
  shippingFee = 0,
  depositAmount = 0
): QuoteTotals {
  const subtotal = items.reduce((sum, item) => {
    const qty = Math.max(0, roundMoneyVND(Number(item.quantity) || 0));
    const price = Math.max(0, roundMoneyVND(Number(item.unitPrice) || 0));
    return sum + qty * price;
  }, 0);
  const totalQuantity = items.reduce(
    (sum, item) => sum + Math.max(0, roundMoneyVND(Number(item.quantity) || 0)),
    0
  );
  const safeDiscount = Math.max(0, roundMoneyVND(Number(discountAmount) || 0));
  const safeShipping = Math.max(0, roundMoneyVND(Number(shippingFee) || 0));
  const safeDeposit = Math.max(0, roundMoneyVND(Number(depositAmount) || 0));
  const remainingAmount = Math.max(
    0,
    roundMoneyVND(subtotal - safeDiscount + safeShipping - safeDeposit)
  );

  return {
    subtotal,
    discountAmount: safeDiscount,
    shippingFee: safeShipping,
    depositAmount: safeDeposit,
    remainingAmount,
    totalQuantity,
  };
}

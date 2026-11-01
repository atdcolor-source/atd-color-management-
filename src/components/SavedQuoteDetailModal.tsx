import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  FileDown,
  Link2,
  Pencil,
  Printer,
  X,
} from 'lucide-react';
import { getReportStageLabel } from '../constants/reportStages';
import { ReportStage, SavedInvoice, StoreSettings } from '../types';
import {
  formatDateOnlyVN,
  formatDateTimeVN,
  formatISODateVN,
  formatSignatureDateVN,
  formatVND,
  getLocalISODate,
} from '../utils/formatters';
import {
  getInvoiceRemainingPaidDate,
  hasCollectibleRemainingBalance,
  isInvoiceRemainingSettled,
  sanitizeOptionalOrderDate,
} from '../utils/revenueSplit';
import { auditInvoiceVoucher } from '../utils/voucherAudit';

interface SavedQuoteDetailModalProps {
  invoice: SavedInvoice | null;
  store: StoreSettings;
  logoDataUrl?: string | null;
  signatureDataUrl?: string | null;
  onClose: () => void;
  onEditInvoice: (invoice: SavedInvoice) => void;
  onOpenPrintInvoice: (invoice: SavedInvoice) => void;
  onCopySavedInvoiceImage: (invoice: SavedInvoice) => Promise<void>;
  onDownloadSavedInvoicePDF: (invoice: SavedInvoice) => Promise<void>;
  onSaveInvoiceStage?: (
    invoice: SavedInvoice,
    stage: ReportStage | '',
    paymentPatch?: { remainingPaid?: boolean; remainingPaidAt?: string }
  ) => void;
}

async function copyTextSafe(text: string): Promise<boolean> {
  try {
    if (
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to hidden textarea copy
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function SavedQuoteDetailModal({
  invoice,
  store,
  logoDataUrl,
  signatureDataUrl,
  onClose,
  onEditInvoice,
  onOpenPrintInvoice,
  onCopySavedInvoiceImage,
  onDownloadSavedInvoicePDF,
  onSaveInvoiceStage,
}: SavedQuoteDetailModalProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [copiedImg, setCopiedImg] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [brokenLogoSrc, setBrokenLogoSrc] = useState<string | null>(null);
  const [brokenSignatureSrc, setBrokenSignatureSrc] = useState<string | null>(
    null
  );
  const [draftPaidDate, setDraftPaidDate] = useState<string>('');
  const canShowLogo = Boolean(logoDataUrl && logoDataUrl !== brokenLogoSrc);
  const canShowSignature = Boolean(
    signatureDataUrl && signatureDataUrl !== brokenSignatureSrc
  );

  useEffect(() => {
    if (!invoice) return;
    setDraftPaidDate(
      sanitizeOptionalOrderDate(invoice.remainingPaidAt) || getLocalISODate(0)
    );
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [invoice, onClose]);

  if (!invoice) return null;

  const voucherAudit = auditInvoiceVoucher(invoice, store.footerNote);
  const isSettled = isInvoiceRemainingSettled(invoice);
  const hasStage2Balance =
    hasCollectibleRemainingBalance(invoice) ||
    Boolean(invoice.remainingPaid) ||
    invoice.reportStage === 'hoan_thanh';
  const effectivePaidDate = isSettled
    ? getInvoiceRemainingPaidDate(invoice)
    : sanitizeOptionalOrderDate(draftPaidDate) || getLocalISODate(0);

  const isEditedAfterCreate =
    Math.abs(
      new Date(invoice.updatedAt).getTime() -
        new Date(invoice.createdAt).getTime()
    ) > 5000;

  const handleCopyImg = async () => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await onCopySavedInvoiceImage(invoice);
      setCopiedImg(true);
      window.setTimeout(() => setCopiedImg(false), 2400);
    } finally {
      setIsBusy(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await onDownloadSavedInvoicePDF(invoice);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCopyLink = async () => {
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const shareUrl = `${baseUrl}?tab=saved&invoice=${encodeURIComponent(invoice.id)}`;
    await copyTextSafe(shareUrl);
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 2400);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Chi tiết báo giá ${invoice.code}`}
      className="no-print fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="modal-panel-enter bg-white rounded-xl max-w-[1140px] w-full max-h-[92vh] flex flex-col overflow-hidden shadow-xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1.5 bg-[#4887EE] shrink-0" />
        {/* Top Action Header */}
        <div className="px-4 sm:px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm sm:text-base font-bold text-slate-900 num-clean">
              Chi tiết báo giá: {invoice.code}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 num-clean mt-0.5">
              <span>Thời gian tạo: {formatDateTimeVN(invoice.createdAt)}</span>
              {isEditedAfterCreate && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Cập nhật: {formatDateTimeVN(invoice.updatedAt)}</span>
                </>
              )}
              {invoice.reportStage && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-[#3674DC]">
                    Phân loại: {getReportStageLabel(invoice.reportStage)}
                  </span>
                </>
              )}
              {voucherAudit.isQualifiedVoucher ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-emerald-700">
                    Giảm khách {formatVND(voucherAudit.voucherDeductAmount)} (Đã
                    trừ Quỹ Voucher)
                  </span>
                </>
              ) : voucherAudit.hasSubThresholdDiscount ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-amber-700">
                    Giảm {formatVND(voucherAudit.rawDiscountAmount)} (&lt;
                    1.000đ · Chưa trừ Quỹ Voucher)
                  </span>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onSaveInvoiceStage && hasStage2Balance && (
              <button
                type="button"
                onClick={() =>
                  onSaveInvoiceStage(
                    invoice,
                    isSettled
                      ? invoice.totals.depositAmount > 0
                        ? 'coc'
                        : 'bao_gia'
                      : 'hoan_thanh',
                    {
                      remainingPaid: !isSettled,
                      remainingPaidAt: effectivePaidDate,
                    }
                  )
                }
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-bold rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 num-clean ${
                  isSettled
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                }`}
              >
                {isSettled && <Check className="w-4 h-4 shrink-0" />}
                <span>
                  {isSettled
                    ? `Đã thu phần còn lại (${formatISODateVN(effectivePaidDate)})`
                    : `Tích đã thu phần còn lại (${formatVND(invoice.totals.remainingAmount)})`}
                </span>
              </button>
            )}

            {onSaveInvoiceStage && !isSettled && (
              <button
                type="button"
                onClick={() =>
                  onSaveInvoiceStage(
                    invoice,
                    invoice.reportStage === 'coc' ? '' : 'coc'
                  )
                }
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-bold rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  invoice.reportStage === 'coc'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-blue-50 text-[#3674DC] border-blue-200 hover:bg-blue-100'
                }`}
              >
                {invoice.reportStage === 'coc' && (
                  <Check className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {invoice.reportStage === 'coc' ? 'Đang để: Cọc' : 'Để là Cọc'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                const target = invoice;
                onClose();
                onEditInvoice(target);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              <Pencil className="w-4 h-4 shrink-0" />
              <span>Chỉnh sửa báo giá</span>
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleCopyImg()}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-bold rounded-lg cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 ${
                copiedImg
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#3674DC] text-white hover:bg-[#2A62C4]'
              }`}
            >
              {copiedImg ? (
                <>
                  <Check className="w-4 h-4 shrink-0" />
                  <span>Đã sao chép ảnh!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 shrink-0" />
                  <span>Sao chép ảnh</span>
                </>
              )}
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleDownloadPdf()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <FileDown className="w-4 h-4 shrink-0" />
              <span>Tải PDF</span>
            </button>

            <button
              type="button"
              onClick={() => void handleCopyLink()}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold rounded-lg border cursor-pointer whitespace-nowrap shrink-0 ${
                copiedLink
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100'
              }`}
            >
              {copiedLink ? (
                <>
                  <Check className="w-4 h-4 shrink-0" />
                  <span>Đã chép link!</span>
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4 shrink-0" />
                  <span>Chép link đơn</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                const target = invoice;
                onClose();
                onOpenPrintInvoice(target);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              <Printer className="w-4 h-4 shrink-0" />
              <span>Mở bản in</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng"
              className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Full Detail Body */}
        <div className="p-5 sm:p-8 overflow-y-auto space-y-4 bg-white">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3.5 border-b border-slate-200">
            <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
              {canShowLogo && (
                <img
                  src={logoDataUrl!}
                  alt={`Logo ${store.companyName || 'ATD Color'}`}
                  referrerPolicy="no-referrer"
                  decoding="async"
                  onError={() => setBrokenLogoSrc(logoDataUrl || null)}
                  className="h-14 sm:h-[72px] w-auto max-w-[140px] sm:max-w-[184px] object-contain object-left shrink-0 select-none"
                />
              )}
              <div className="space-y-1 min-w-0">
                <div className="text-sm text-slate-800 font-semibold">
                  {[store.address, store.phone ? `ĐT: ${store.phone}` : '']
                    .filter(Boolean)
                    .join('  ·  ')}
                </div>
                <div className="text-sm text-slate-600">
                  {[
                    store.email ? `Email: ${store.email}` : '',
                    store.tiktok ? `TikTok: ${store.tiktok}` : '',
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </div>
              </div>
            </div>

            <div className="sm:text-right shrink-0 space-y-1 num-clean">
              <div className="text-sm font-semibold text-slate-800">
                Mã báo giá: {invoice.code}
              </div>
              <div className="text-xs sm:text-sm text-slate-600">
                Thời gian tạo: {formatDateTimeVN(invoice.createdAt)}
              </div>
              {invoice.expectedDemoDate && (
                <div className="text-sm font-extrabold text-red-600">
                  Ngày nhận demo dự kiến:{' '}
                  {formatISODateVN(invoice.expectedDemoDate)}
                </div>
              )}
            </div>
          </div>

          <div className="pt-1 pb-0.5 text-center">
            <h3 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              {store.invoiceTitle || 'PHIẾU ĐẶT HÀNG'}
            </h3>
          </div>

          {/* Customer Information (Always visible in Detail View) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm">
            <div>
              <span className="text-slate-500 font-medium">Khách hàng: </span>
              <span className="font-bold text-slate-900">
                {invoice.customer.name.trim() || 'Khách lẻ'}
              </span>
            </div>
            <div className="num-clean">
              <span className="text-slate-500 font-medium">
                Mã khách hàng:{' '}
              </span>
              <span className="font-bold text-slate-900">
                {invoice.customer.code.trim() || '—'}
              </span>
            </div>
            <div className="num-clean">
              <span className="text-slate-500 font-medium">
                Số điện thoại:{' '}
              </span>
              <span className="font-bold text-slate-900">
                {invoice.customer.phone.trim() || '—'}
              </span>
            </div>
          </div>

          {/* Selected Products List */}
          <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-[#4887EE] text-white text-xs sm:text-sm font-bold">
                  <th className="py-2.5 px-2.5 text-center w-12 border-r border-white/30">
                    STT
                  </th>
                  <th className="py-2.5 px-4">NỘI DUNG & KÍCH THƯỚC</th>
                  <th className="py-2.5 px-3 text-center w-24">SỐ LƯỢNG</th>
                  <th className="py-2.5 px-3 text-right w-36">ĐƠN GIÁ</th>
                  <th className="py-2.5 px-4 text-right w-40">THÀNH TIỀN</th>
                  <th className="py-2.5 px-4 w-56 border-l border-white/30">
                    GHI CHÚ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm sm:text-base">
                {invoice.items.map((item, idx) => (
                  <tr
                    key={item.id}
                    className={idx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'}
                  >
                    <td className="py-2.5 px-2.5 align-top text-center font-bold text-slate-900 num-clean border-r border-slate-200">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-4 align-top font-semibold text-slate-900 whitespace-pre-wrap break-words leading-snug">
                      {item.name}
                    </td>
                    <td className="py-2.5 px-3 align-top text-center font-bold text-slate-900 num-clean">
                      {item.quantity}
                    </td>
                    <td className="py-2.5 px-3 align-top text-right font-semibold text-slate-700 num-clean">
                      {formatVND(item.unitPrice)}
                    </td>
                    <td className="py-2.5 px-4 align-top text-right font-bold text-slate-900 num-clean whitespace-nowrap">
                      {formatVND(item.quantity * item.unitPrice)}
                    </td>
                    <td className="py-2.5 px-4 align-top text-sm text-slate-700 border-l border-slate-200 whitespace-pre-wrap break-words leading-snug">
                      {item.note || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-start pt-2">
            <div className="sm:col-span-7 space-y-3">
              {invoice.designIllustration?.trim() && (
                <div className="px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm">
                  <span className="font-bold text-slate-800">
                    Mẫu Thiết Kế đã đính kèm, ảnh minh họa:{' '}
                  </span>
                  <span className="font-bold text-blue-700">
                    {invoice.designIllustration.trim()}
                  </span>
                </div>
              )}
              {invoice.invoiceNote.trim() && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-xs font-bold text-slate-800 mb-1">
                    Ghi chú:
                  </div>
                  <div className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">
                    {invoice.invoiceNote}
                  </div>
                </div>
              )}
            </div>

            {/* 5-Row Payment Summary + Right-Side Preparer Signature Block */}
            <div className="sm:col-span-5 space-y-4">
              <div className="border border-slate-300 rounded-lg overflow-hidden bg-white num-clean">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
                  <span className="text-sm font-semibold text-slate-700">
                    Tổng giá trị đơn:
                  </span>
                  <span className="text-base font-bold text-slate-900">
                    {formatVND(invoice.totals.subtotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
                  <span className="text-sm font-semibold text-slate-700">
                    Tiền giảm:
                  </span>
                  <span className="text-base font-bold text-rose-600">
                    {invoice.totals.discountAmount > 0
                      ? `-${formatVND(invoice.totals.discountAmount)}`
                      : '0đ'}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
                  <span className="text-sm font-semibold text-slate-700">
                    Tiền ship:
                  </span>
                  <span className="text-base font-bold text-slate-900">
                    {invoice.totals.shippingFee > 0
                      ? formatVND(invoice.totals.shippingFee)
                      : '0đ'}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
                  <span className="text-sm font-semibold text-slate-700">
                    Đã cọc:
                  </span>
                  <span className="text-base font-bold text-blue-700">
                    {formatVND(invoice.totals.depositAmount)}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3.5 bg-[#4887EE] text-white">
                  <div className="min-w-0">
                    <div className="text-sm sm:text-base font-bold">
                      Thanh toán còn lại:
                    </div>
                    {isSettled && invoice.totals.remainingAmount > 0 && (
                      <div className="text-[11px] font-semibold text-white/90">
                        Đã tất toán ngày {formatISODateVN(effectivePaidDate)}
                      </div>
                    )}
                  </div>
                  <span className="text-xl sm:text-2xl font-extrabold">
                    {formatVND(invoice.totals.remainingAmount)}
                  </span>
                </div>

                <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50/90 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-slate-700">
                      Đợt 1 · Thanh toán cọc:
                    </span>
                    <span className="font-semibold text-[#3674DC]">
                      {invoice.totals.depositAmount > 0
                        ? `${formatVND(invoice.totals.depositAmount)} · Ngày ${formatDateOnlyVN(invoice.createdAt)}`
                        : '0đ · Không cọc trước'}
                    </span>
                  </div>

                  {hasStage2Balance ? (
                    <div className="pt-1.5 border-t border-slate-200/80 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-800 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            disabled={!onSaveInvoiceStage}
                            checked={isSettled}
                            onChange={(e) => {
                              if (!onSaveInvoiceStage) return;
                              const checked = e.target.checked;
                              onSaveInvoiceStage(
                                invoice,
                                checked
                                  ? 'hoan_thanh'
                                  : invoice.totals.depositAmount > 0
                                    ? 'coc'
                                    : 'bao_gia',
                                {
                                  remainingPaid: checked,
                                  remainingPaidAt: effectivePaidDate,
                                }
                              );
                            }}
                            className="w-4 h-4 rounded border-slate-300 accent-emerald-600 cursor-pointer shrink-0"
                          />
                          <span>
                            Đợt 2 · Đã thu phần còn lại (
                            {formatVND(invoice.totals.remainingAmount)})
                          </span>
                        </label>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">
                            Ngày thu:
                          </span>
                          <input
                            type="date"
                            aria-label="Ngày thanh toán phần còn lại"
                            value={effectivePaidDate}
                            onChange={(e) => {
                              const nextDate = e.target.value;
                              setDraftPaidDate(nextDate);
                              if (isSettled && onSaveInvoiceStage && nextDate) {
                                onSaveInvoiceStage(invoice, 'hoan_thanh', {
                                  remainingPaid: true,
                                  remainingPaidAt: nextDate,
                                });
                              }
                            }}
                            className="h-7 px-2 text-xs font-bold text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#4887EE] cursor-pointer"
                          />
                        </div>
                      </div>
                      <div
                        className={`text-[11px] leading-snug ${
                          isSettled
                            ? 'text-emerald-800 font-semibold'
                            : 'text-slate-500'
                        }`}
                      >
                        {isSettled
                          ? `Đã tất toán đủ · Phần còn lại tính vào doanh thu ngày ${formatISODateVN(effectivePaidDate)}.`
                          : 'Tích để xác nhận Hoàn thành & cộng phần còn lại vào doanh thu của ngày/tháng thu đợt 2.'}
                      </div>
                    </div>
                  ) : (
                    <div className="pt-1.5 border-t border-slate-200/80 text-xs font-semibold text-emerald-700">
                      Đợt 2 · Đã thanh toán đủ 100% ngay đợt 1 (Còn lại 0đ)
                    </div>
                  )}
                </div>
              </div>

              {(store.preparerName.trim() || canShowSignature) && (
                <div className="pt-1 text-center space-y-0.5 num-clean">
                  <div className="text-xs sm:text-sm italic text-slate-600">
                    {formatSignatureDateVN(invoice.createdAt)}
                  </div>
                  <div className="text-sm sm:text-base font-bold text-slate-900">
                    Người lập báo giá
                  </div>
                  <div className="text-xs italic text-slate-500">
                    (Chữ ký, ghi rõ họ tên)
                  </div>
                  {canShowSignature ? (
                    <div className="pt-1.5 pb-1 flex justify-center">
                      <img
                        src={signatureDataUrl!}
                        alt={`Chữ ký ${store.preparerName || 'Người lập báo giá'}`}
                        referrerPolicy="no-referrer"
                        decoding="async"
                        onError={() =>
                          setBrokenSignatureSrc(signatureDataUrl || null)
                        }
                        className="h-16 sm:h-[72px] w-auto max-w-[220px] object-contain mx-auto select-none"
                      />
                    </div>
                  ) : (
                    <div className="h-6" />
                  )}
                  {store.preparerName.trim() && (
                    <div className="text-base sm:text-lg font-bold text-slate-900">
                      {store.preparerName}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

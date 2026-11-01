import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookmarkCheck,
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileDown,
  FolderOpen,
  GripVertical,
  Printer,
  Save,
  Trash2,
} from 'lucide-react';
import { REPORT_STAGE_OPTIONS } from '../constants/reportStages';
import {
  CustomerInfo,
  QuoteItem,
  QuoteTotals,
  ReportStage,
  StoreSettings,
} from '../types';
import {
  formatDateOnlyVN,
  formatISODateVN,
  formatSignatureDateVN,
  formatVND,
  getLocalISODate,
} from '../utils/formatters';
import {
  auditInvoiceVoucher,
  QUICK_DISCOUNT_PRESETS,
} from '../utils/voucherAudit';
import { useRowReorder } from '../utils/useRowReorder';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import { DesignIllustrationSelector } from './DesignIllustrationSelector';
import { MoneyInput, QuantityInput } from './MoneyInput';

interface InvoicePreviewProps {
  createdAt: string;
  expectedDemoDate: string;
  onChangeExpectedDemoDate: (date: string) => void;
  store: StoreSettings;
  logoDataUrl?: string | null;
  signatureDataUrl?: string | null;
  customer: CustomerInfo;
  onChangeCustomer: (customer: CustomerInfo) => void;
  items: QuoteItem[];
  onUpdateItem: (id: string, patch: Partial<QuoteItem>) => void;
  onRemoveItem: (id: string) => void;
  onDuplicateItem: (id: string) => void;
  onMoveItem: (fromIndex: number, toIndex: number) => void;
  discountAmount: number;
  onChangeDiscountAmount: (amount: number) => void;
  shippingFee: number;
  onChangeShippingFee: (amount: number) => void;
  depositAmount: number;
  onChangeDepositAmount: (amount: number) => void;
  designIllustration: string;
  onChangeDesignIllustration: (value: string) => void;
  invoiceNote: string;
  onChangeInvoiceNote: (note: string) => void;
  reportStage: ReportStage | '';
  onChangeReportStage: (stage: ReportStage | '') => void;
  remainingPaid: boolean;
  remainingPaidAt: string;
  onChangeRemainingPaid: (paid: boolean, paidAt?: string) => void;
  totals: QuoteTotals;
  savedCount: number;
  editingInvoiceCode: string | null;
  saveSuccess: boolean;
  isSaving: boolean;
  cloudError: string | null;
  onSaveInvoice: () => void;
  onOpenSavedTab: () => void;
  onBackToWorkspace: () => void;
  onCopyImage: () => void;
  onDownloadPNG: () => void;
  onDownloadPDF: () => void;
  onOpenCalculator?: () => void;
  copySuccess: boolean;
  isExporting: boolean;
}

export function InvoicePreview({
  createdAt,
  expectedDemoDate,
  onChangeExpectedDemoDate,
  store,
  logoDataUrl,
  signatureDataUrl,
  customer,
  onChangeCustomer,
  items,
  onUpdateItem,
  onRemoveItem,
  onDuplicateItem,
  onMoveItem,
  discountAmount,
  onChangeDiscountAmount,
  shippingFee,
  onChangeShippingFee,
  depositAmount,
  onChangeDepositAmount,
  designIllustration,
  onChangeDesignIllustration,
  invoiceNote,
  onChangeInvoiceNote,
  reportStage,
  onChangeReportStage,
  remainingPaid,
  remainingPaidAt,
  onChangeRemainingPaid,
  totals,
  savedCount,
  editingInvoiceCode,
  saveSuccess,
  isSaving,
  cloudError,
  onSaveInvoice,
  onOpenSavedTab,
  onBackToWorkspace,
  onCopyImage,
  onDownloadPNG,
  onDownloadPDF,
  onOpenCalculator,
  copySuccess,
  isExporting,
}: InvoicePreviewProps) {
  const { tbodyRef, draggingId, startRowDrag } = useRowReorder(
    items.length,
    onMoveItem
  );
  const hasCustomer = Boolean(
    customer.name.trim() || customer.code.trim() || customer.phone.trim()
  );
  const formattedDemoDate = formatISODateVN(expectedDemoDate);
  const [brokenLogoSrc, setBrokenLogoSrc] = useState<string | null>(null);
  const [brokenSignatureSrc, setBrokenSignatureSrc] = useState<string | null>(
    null
  );
  const canShowLogo = Boolean(logoDataUrl && logoDataUrl !== brokenLogoSrc);
  const canShowSignature = Boolean(
    signatureDataUrl && signatureDataUrl !== brokenSignatureSrc
  );

  const effectivePaidDate = remainingPaidAt || getLocalISODate(0);

  const draftVoucherAudit = useMemo(
    () =>
      auditInvoiceVoucher(
        {
          reportStage,
          remainingPaid,
          discountAmount,
          depositAmount,
          totals,
          customer,
          items,
          designIllustration,
          invoiceNote,
        },
        store.footerNote
      ),
    [
      reportStage,
      remainingPaid,
      discountAmount,
      depositAmount,
      totals,
      customer,
      items,
      designIllustration,
      invoiceNote,
      store.footerNote,
    ]
  );

  return (
    <div className="max-w-[1160px] mx-auto space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onBackToWorkspace}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-slate-900 cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span>Quay lại chọn sản phẩm</span>
          </button>

          {editingInvoiceCode && (
            <span className="text-xs sm:text-sm text-slate-500 num-clean">
              · Đang mở:{' '}
              <strong className="text-blue-700">{editingInvoiceCode}</strong>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={items.length === 0 || isSaving}
            onClick={onSaveInvoice}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              saveSuccess
                ? 'bg-emerald-600 text-white'
                : 'bg-[#4887EE] hover:bg-[#3674DC] text-white'
            }`}
          >
            {isSaving ? (
              <>
                <Save className="w-4 h-4 shrink-0 animate-pulse" />
                <span>Đang lưu báo giá...</span>
              </>
            ) : saveSuccess ? (
              <>
                <BookmarkCheck className="w-4 h-4 shrink-0" />
                <span>Đã lưu báo giá!</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4 shrink-0" />
                <span>
                  {editingInvoiceCode ? 'Lưu cập nhật' : 'Lưu báo giá'}
                </span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={items.length === 0 || isExporting}
            onClick={onCopyImage}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              copySuccess
                ? 'bg-emerald-600 text-white'
                : 'bg-[#3674DC] hover:bg-[#2A62C4] text-white'
            }`}
          >
            {copySuccess ? (
              <>
                <Check className="w-4 h-4 shrink-0" />
                <span>Đã sao chép ảnh ngang!</span>
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
            disabled={items.length === 0 || isExporting}
            onClick={onDownloadPNG}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>Tải ảnh</span>
          </button>

          <button
            type="button"
            disabled={items.length === 0 || isExporting}
            onClick={onDownloadPDF}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
          >
            <FileDown className="w-4 h-4 shrink-0" />
            <span>Tải PDF (Ngang)</span>
          </button>

          <button
            type="button"
            disabled={items.length === 0}
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
          >
            <Printer className="w-4 h-4 shrink-0" />
            <span>In ngang</span>
          </button>

          <button
            type="button"
            onClick={onOpenSavedTab}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean"
          >
            <FolderOpen className="w-4 h-4 shrink-0" />
            <span>
              {savedCount > 0 ? `Báo giá đã lưu (${savedCount})` : 'Báo giá đã lưu'}
            </span>
          </button>

          {onOpenCalculator && (
            <button
              type="button"
              onClick={onOpenCalculator}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Calculator className="w-4 h-4 shrink-0 text-blue-600" />
              <span>Máy tính</span>
            </button>
          )}
        </div>
      </div>

      {(saveSuccess || copySuccess) && (
        <div className="no-print view-smooth-enter px-4 py-2.5 text-sm font-extrabold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl">
          Chúc Sale Tuấn Đạt chốt thành công nha.
        </div>
      )}

      {cloudError && (
        <div className="no-print px-4 py-2.5 text-xs sm:text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl">
          {cloudError}
        </div>
      )}

      <div
        id="reference-invoice-sheet"
        className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs"
      >
        <div className="h-1.5 bg-[#4887EE]" />

        <div className="p-5 sm:p-8 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3.5 border-b border-slate-200">
            <div className="flex items-center gap-4 min-w-0">
              {canShowLogo && (
                <img
                  src={logoDataUrl!}
                  alt={`Logo ${store.companyName || 'ATD Color'}`}
                  referrerPolicy="no-referrer"
                  decoding="async"
                  onError={() => setBrokenLogoSrc(logoDataUrl || null)}
                  className="h-16 sm:h-[76px] w-auto max-w-[144px] sm:max-w-[190px] object-contain object-left shrink-0 select-none"
                />
              )}
              <div className="space-y-1 min-w-0">
                <div className="text-sm sm:text-base text-slate-800 font-semibold">
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

            <div className="sm:text-right shrink-0 space-y-1">
              <div className="text-sm font-semibold text-slate-700 num-clean">
                Ngày lập: {formatDateOnlyVN(createdAt)}
              </div>

              {formattedDemoDate && (
                <div className="hidden print:block text-sm font-extrabold text-red-600 num-clean">
                  Ngày nhận demo dự kiến: {formattedDemoDate}
                </div>
              )}

              <div className="no-print flex sm:justify-end items-center gap-1.5 pt-0.5">
                {expectedDemoDate ? (
                  <>
                    <span className="text-xs sm:text-sm font-extrabold text-red-600 whitespace-nowrap shrink-0">
                      Ngày nhận demo dự kiến:
                    </span>
                    <input
                      type="date"
                      value={expectedDemoDate}
                      onChange={(e) => onChangeExpectedDemoDate(e.target.value)}
                      aria-label="Ngày nhận demo dự kiến"
                      className="h-7 px-2 text-xs sm:text-sm font-extrabold text-red-600 bg-red-50 border border-red-300 rounded num-clean focus:outline-none focus:border-red-600"
                    />
                    <button
                      type="button"
                      onClick={() => onChangeExpectedDemoDate('')}
                      className="text-xs text-slate-400 hover:text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Ẩn
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => onChangeExpectedDemoDate(getLocalISODate(1))}
                    className="text-xs font-bold text-red-600 hover:text-red-700 underline underline-offset-2 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    + Thêm ngày nhận demo dự kiến
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="pt-1 pb-0.5 text-center">
            <h3 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              {store.invoiceTitle || 'PHIẾU ĐẶT HÀNG'}
            </h3>
          </div>

          {/* 3-Column Customer Row (Khách hàng | Mã khách hàng | SĐT) */}
          <div
            className={`${
              !hasCustomer ? 'no-print' : ''
            } grid grid-cols-1 sm:grid-cols-3 gap-3 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-600 shrink-0">
                Khách hàng:
              </span>
              <input
                type="text"
                value={customer.name}
                onChange={(e) =>
                  onChangeCustomer({ ...customer, name: e.target.value })
                }
                placeholder="Nhập tên khách..."
                className="w-full text-sm sm:text-base font-semibold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-600 shrink-0">
                Mã khách hàng:
              </span>
              <input
                type="text"
                value={customer.code}
                onChange={(e) =>
                  onChangeCustomer({ ...customer, code: e.target.value })
                }
                placeholder="Tự tạo khi Lưu..."
                className="w-full text-sm sm:text-base font-bold text-slate-900 num-clean bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-900 focus:outline-none placeholder:font-normal"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-600 shrink-0">
                SĐT:
              </span>
              <input
                type="tel"
                value={customer.phone}
                onChange={(e) =>
                  onChangeCustomer({ ...customer, phone: e.target.value })
                }
                placeholder="Nhập số điện thoại..."
                className="w-full text-sm sm:text-base font-semibold text-slate-900 num-clean bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          {items.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-slate-200 rounded-lg">
              <p className="text-base font-medium text-slate-600">
                Chưa có sản phẩm nào trong hóa đơn.
              </p>
              <button
                type="button"
                onClick={onBackToWorkspace}
                className="mt-3 px-4 py-2 text-sm font-semibold text-white bg-[#4887EE] rounded-lg hover:bg-[#3674DC] cursor-pointer whitespace-nowrap shrink-0"
              >
                Chọn sản phẩm ngay
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="no-print flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                {items.length > 1 ? (
                  <>
                    <span className="inline-flex items-center gap-1">
                      <GripVertical className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>
                        Giữ ô <strong>STT</strong> kéo lên/xuống để đổi vị trí
                      </span>
                    </span>
                    <span aria-hidden="true">·</span>
                  </>
                ) : null}
                <span className="inline-flex items-center gap-1">
                  <Copy className="w-3.5 h-3.5 text-[#4887EE] shrink-0" />
                  <span>
                    Bấm nút <strong>Sao chép</strong> tại cột <strong>STT</strong> để nhân bản cả hàng xuống dưới
                  </span>
                </span>
              </div>
              <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
                <table
                  className={`w-full text-left border-collapse min-w-[845px] print:min-w-0 ${
                    draggingId ? 'select-none cursor-grabbing' : ''
                  }`}
                >
                  <thead>
                    <tr className="bg-[#4887EE] text-white text-xs sm:text-sm font-bold">
                      <th className="py-2.5 px-2 print:px-2.5 text-center w-24 print:w-12 border-r border-white/30">
                        STT
                      </th>
                      <th className="py-2.5 px-4">NỘI DUNG & KÍCH THƯỚC</th>
                      <th className="py-2.5 px-2 text-center w-24">SỐ LƯỢNG</th>
                      <th className="py-2.5 px-3 text-right w-40">ĐƠN GIÁ</th>
                      <th className="py-2.5 px-4 text-right w-40">THÀNH TIỀN</th>
                      <th className="py-2.5 px-4 w-60 min-w-[200px] print:min-w-0 border-l border-white/30">
                        GHI CHÚ
                      </th>
                      <th className="no-print py-2.5 px-2 w-9" aria-label="Xóa" />
                    </tr>
                  </thead>
                  <tbody
                    ref={tbodyRef}
                    className="divide-y divide-slate-200 text-sm sm:text-base"
                  >
                    {items.map((item, idx) => {
                      const lineTotal = item.quantity * item.unitPrice;
                      const isDragging = draggingId === item.id;
                      return (
                        <tr
                          key={item.id}
                          data-item-id={item.id}
                          className={
                            isDragging
                              ? 'bg-blue-50/90 ring-2 ring-inset ring-blue-500 relative z-10'
                              : idx % 2 === 1
                                ? 'bg-slate-50/60'
                                : 'bg-white'
                          }
                        >
                          <td
                            data-tin-sound={items.length > 1 ? 'true' : undefined}
                            onPointerDown={
                              items.length > 1
                                ? (e) => startRowDrag(e, item.id)
                                : undefined
                            }
                            title={
                              items.length > 1
                                ? 'Giữ và kéo lên/xuống để đổi vị trí sản phẩm'
                                : undefined
                            }
                            className={`py-2.5 px-1.5 print:py-2.5 print:px-2.5 align-top text-center font-bold text-slate-900 num-clean border-r border-slate-200 ${
                              items.length > 1
                                ? 'cursor-grab active:cursor-grabbing touch-none select-none hover:bg-slate-100/80'
                                : ''
                            }`}
                          >
                            <span className="hidden print:inline">
                              {idx + 1}
                            </span>
                            <div className="no-print">
                              {items.length > 1 ? (
                                <div className="flex items-center justify-between gap-1 pt-0.5">
                                  <span className="inline-flex items-center gap-0.5 pl-0.5 text-slate-400">
                                    <GripVertical className="w-4 h-4 shrink-0" />
                                    <span className="text-slate-900 font-bold text-sm min-w-[16px] text-center">
                                      {idx + 1}
                                    </span>
                                  </span>
                                  <div
                                    className="inline-flex items-center gap-0.5"
                                    onPointerDown={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => onDuplicateItem(item.id)}
                                      title="Sao chép cả hàng này xuống dưới để nhập thông tin khác"
                                      aria-label={`Sao chép hàng ${idx + 1}`}
                                      className="w-6 h-6 flex items-center justify-center rounded border border-blue-200 bg-blue-50/80 text-[#4887EE] hover:text-white hover:bg-[#4887EE] transition-colors cursor-pointer shrink-0"
                                    >
                                      <Copy className="w-3.5 h-3.5" />
                                    </button>
                                    <div className="flex flex-col">
                                      <button
                                        type="button"
                                        disabled={idx === 0}
                                        onClick={() => onMoveItem(idx, idx - 1)}
                                        title="Đưa sản phẩm lên trên"
                                        aria-label="Đưa sản phẩm lên trên"
                                        className="w-5 h-4 flex items-center justify-center rounded text-slate-400 hover:text-slate-900 hover:bg-slate-200 cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
                                      >
                                        <ChevronUp className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={idx === items.length - 1}
                                        onClick={() => onMoveItem(idx, idx + 1)}
                                        title="Đưa sản phẩm xuống dưới"
                                        aria-label="Đưa sản phẩm xuống dưới"
                                        className="w-5 h-4 flex items-center justify-center rounded text-slate-400 hover:text-slate-900 hover:bg-slate-200 cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
                                      >
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div
                                  className="inline-flex items-center justify-center gap-1.5 pt-0.5"
                                  onPointerDown={(e) => e.stopPropagation()}
                                >
                                  <span className="text-slate-900 font-bold text-sm">
                                    {idx + 1}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => onDuplicateItem(item.id)}
                                    title="Sao chép cả hàng này xuống dưới để nhập thông tin khác"
                                    aria-label={`Sao chép hàng ${idx + 1}`}
                                    className="w-6 h-6 flex items-center justify-center rounded border border-blue-200 bg-blue-50/80 text-[#4887EE] hover:text-white hover:bg-[#4887EE] transition-colors cursor-pointer shrink-0"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 align-top font-semibold text-slate-900">
                            <div className="hidden print:block font-semibold text-slate-900 whitespace-pre-wrap break-words leading-snug">
                              {item.name}
                            </div>
                            <AutoResizeTextarea
                              value={item.name}
                              onChange={(nextName) =>
                                onUpdateItem(item.id, { name: nextName })
                              }
                              ariaLabel="Tên sản phẩm"
                              minHeightPx={30}
                              className="no-print font-semibold text-slate-900 border-b border-transparent hover:border-slate-300 focus:border-slate-900 py-1"
                            />
                          </td>
                          <td className="py-2.5 px-2 align-top text-center">
                            <span className="hidden print:inline font-bold text-slate-900 num-clean">
                              {item.quantity}
                            </span>
                            <div className="no-print flex justify-center">
                              <QuantityInput
                                value={item.quantity}
                                min={1}
                                onChange={(nextQty) =>
                                  onUpdateItem(item.id, { quantity: nextQty })
                                }
                                ariaLabel="Số lượng"
                                className="w-16 h-8 bg-slate-50 border border-slate-200 rounded focus:bg-white focus:border-slate-900"
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-3 align-top text-right">
                            <span className="hidden print:inline font-semibold text-slate-700 num-clean">
                              {formatVND(item.unitPrice)}
                            </span>
                            <div className="no-print flex justify-end">
                              <MoneyInput
                                value={item.unitPrice}
                                onChange={(nextPrice) =>
                                  onUpdateItem(item.id, { unitPrice: nextPrice })
                                }
                                placeholder="0"
                                ariaLabel="Đơn giá"
                                textColorClass="text-blue-700"
                                className="w-36 h-8 text-sm sm:text-base bg-slate-50 border border-slate-200 rounded focus-within:bg-white focus-within:border-slate-900"
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-4 align-top text-right font-bold text-slate-900 num-clean whitespace-nowrap">
                            <span className="inline-block print:pt-0 pt-1">
                              {formatVND(lineTotal)}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 align-top border-l border-slate-200">
                            <div className="hidden print:block text-sm text-slate-700 whitespace-pre-wrap break-words leading-snug">
                              {item.note || ''}
                            </div>
                            <AutoResizeTextarea
                              value={item.note || ''}
                              onChange={(nextNote) =>
                                onUpdateItem(item.id, { note: nextNote })
                              }
                              placeholder="Ghi thông tin (Enter xuống dòng)..."
                              ariaLabel="Ghi chú sản phẩm"
                              minHeightPx={30}
                              className="no-print text-sm text-slate-700 border-b border-slate-200/80 hover:border-slate-400 focus:border-slate-900 py-1 placeholder:text-slate-400"
                            />
                          </td>
                          <td className="no-print py-2.5 px-2 align-top text-center">
                            <button
                              type="button"
                              onClick={() => onRemoveItem(item.id)}
                              aria-label="Xóa dòng"
                              className="p-1 mt-0.5 text-slate-400 hover:text-rose-600 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                    );
                  })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-start pt-2">
            <div className="sm:col-span-7 space-y-4">
              <DesignIllustrationSelector
                value={designIllustration}
                onChange={onChangeDesignIllustration}
                showPrintVersion
              />

              <div
                className={`${
                  !invoiceNote.trim() ? 'no-print' : ''
                } p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1`}
              >
                <div className="text-xs sm:text-sm font-bold text-slate-800">
                  Ghi chú:
                </div>
                <div className="hidden print:block text-sm text-slate-700 whitespace-pre-line leading-relaxed">
                  {invoiceNote}
                </div>
                <textarea
                  rows={6}
                  value={invoiceNote}
                  onChange={(e) => onChangeInvoiceNote(e.target.value)}
                  placeholder="Nhập ghi chú trên hóa đơn (để trống nếu không cần hiện)..."
                  className="no-print w-full text-sm leading-relaxed text-slate-700 bg-transparent focus:outline-none resize-y"
                />
              </div>
            </div>

            {/* 5-Row Payment Summary + Right-Side Preparer Signature Block */}
            <div className="sm:col-span-5 space-y-4">
              <div className="border border-slate-300 rounded-lg overflow-hidden bg-white">
              <div className="no-print flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 bg-slate-50/80">
                <label
                  htmlFor="preview-report-stage"
                  className="text-xs sm:text-sm font-semibold text-slate-700 whitespace-nowrap shrink-0"
                >
                  Trạng thái đơn:
                </label>
                <div className="flex items-center gap-1.5">
                  <select
                    id="preview-report-stage"
                    value={reportStage}
                    onChange={(e) =>
                      onChangeReportStage(e.target.value as ReportStage | '')
                    }
                    className="h-8 px-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#4887EE] cursor-pointer"
                  >
                    <option value="">Chưa phân loại</option>
                    {REPORT_STAGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeReportStage(reportStage === 'coc' ? '' : 'coc')
                    }
                    className={`h-8 px-2.5 inline-flex items-center gap-1 text-xs font-bold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      reportStage === 'coc'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                    }`}
                  >
                    {reportStage === 'coc' && (
                      <Check className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>
                      {reportStage === 'coc' ? 'Đang để: Cọc' : 'Để là Cọc'}
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
                <span className="text-sm sm:text-base font-semibold text-slate-700">
                  Tổng giá trị đơn:
                </span>
                <span className="text-base sm:text-lg font-bold text-slate-900 num-clean">
                  {formatVND(totals.subtotal)}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200">
                <div className="flex flex-wrap items-center gap-1 min-w-0">
                  <span className="text-sm sm:text-base font-semibold text-slate-700 whitespace-nowrap shrink-0 mr-0.5">
                    Tiền giảm:
                  </span>
                  {QUICK_DISCOUNT_PRESETS.map((presetAmt) => {
                    const activePreset = discountAmount === presetAmt;
                    return (
                      <button
                        key={presetAmt}
                        type="button"
                        onClick={() =>
                          onChangeDiscountAmount(activePreset ? 0 : presetAmt)
                        }
                        className={`no-print px-1.5 py-0.5 text-[11px] font-semibold rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                          activePreset
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50'
                        }`}
                      >
                        -{Math.round(presetAmt / 1000)}k
                      </button>
                    );
                  })}
                </div>
                <span className="hidden print:inline text-base font-bold text-rose-600 num-clean">
                  {totals.discountAmount > 0
                    ? `-${formatVND(totals.discountAmount)}`
                    : '0đ'}
                </span>
                <MoneyInput
                  value={discountAmount}
                  onChange={onChangeDiscountAmount}
                  placeholder="Từ 1.000đ"
                  ariaLabel="Tiền giảm"
                  textColorClass="text-rose-600"
                  className="no-print w-36 sm:w-40 h-8 text-sm sm:text-base bg-slate-50 border border-slate-200 rounded focus-within:bg-white focus-within:border-slate-900"
                />
              </div>

              <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200">
                <span className="text-sm sm:text-base font-semibold text-slate-700">
                  Tiền ship:
                </span>
                <span className="hidden print:inline text-base font-bold text-slate-900 num-clean">
                  {totals.shippingFee > 0
                    ? formatVND(totals.shippingFee)
                    : '0đ'}
                </span>
                <MoneyInput
                  value={shippingFee}
                  onChange={onChangeShippingFee}
                  placeholder="0"
                  ariaLabel="Tiền ship"
                  textColorClass="text-slate-900"
                  className="no-print w-40 h-8 text-sm sm:text-base bg-slate-50 border border-slate-200 rounded focus-within:bg-white focus-within:border-slate-900"
                />
              </div>

              <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200">
                <span className="text-sm sm:text-base font-semibold text-slate-700">
                  Đã cọc:
                </span>
                <span className="hidden print:inline text-base font-bold text-blue-700 num-clean">
                  {totals.depositAmount > 0
                    ? formatVND(totals.depositAmount)
                    : '0đ'}
                </span>
                <MoneyInput
                  value={depositAmount}
                  onChange={onChangeDepositAmount}
                  placeholder="0"
                  ariaLabel="Đã cọc"
                  textColorClass="text-blue-700"
                  className="no-print w-40 h-8 text-sm sm:text-base bg-slate-50 border border-slate-200 rounded focus-within:bg-white focus-within:border-slate-900"
                />
              </div>

              <div className="flex items-center justify-between px-4 py-3.5 bg-[#4887EE] text-white">
                <div className="min-w-0">
                  <div className="text-sm sm:text-base font-bold">
                    Thanh toán còn lại:
                  </div>
                  {remainingPaid && totals.remainingAmount > 0 && (
                    <div className="text-[11px] font-semibold text-white/90 num-clean">
                      Đã tất toán ngày {formatISODateVN(effectivePaidDate)}
                    </div>
                  )}
                </div>
                <span className="text-xl sm:text-2xl font-extrabold num-clean">
                  {formatVND(totals.remainingAmount)}
                </span>
              </div>

              {totals.subtotal > 0 && (
                <div className="no-print px-4 py-2.5 border-t border-slate-200 bg-slate-50/90 space-y-2 num-clean">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-slate-700">
                      Đợt 1 · Thanh toán cọc:
                    </span>
                    <span className="font-semibold text-[#3674DC]">
                      {totals.depositAmount > 0
                        ? `${formatVND(totals.depositAmount)} · Ngày ${formatDateOnlyVN(createdAt)}`
                        : '0đ · Không cọc trước'}
                    </span>
                  </div>

                  {totals.remainingAmount > 0 || remainingPaid ? (
                    <div className="pt-1.5 border-t border-slate-200/80 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-800 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={remainingPaid}
                            onChange={(e) =>
                              onChangeRemainingPaid(
                                e.target.checked,
                                effectivePaidDate
                              )
                            }
                            className="w-4 h-4 rounded border-slate-300 accent-emerald-600 cursor-pointer shrink-0"
                          />
                          <span>
                            Đợt 2 · Đã thu phần còn lại (
                            {formatVND(totals.remainingAmount)})
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
                            onChange={(e) =>
                              onChangeRemainingPaid(
                                remainingPaid,
                                e.target.value
                              )
                            }
                            className="h-7 px-2 text-xs font-bold text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#4887EE] cursor-pointer"
                          />
                        </div>
                      </div>
                      <div
                        className={`text-[11px] leading-snug ${
                          remainingPaid
                            ? 'text-emerald-800 font-semibold'
                            : 'text-slate-500'
                        }`}
                      >
                        {remainingPaid
                          ? `Đơn tự chuyển sang Hoàn thành · Phần còn lại ghi nhận vào doanh thu ngày ${formatISODateVN(effectivePaidDate)} khi lưu.`
                          : 'Tích khi khách tất toán phần còn lại (hoặc chọn Hoàn thành) để tính vào doanh thu của ngày/tháng thu đợt 2.'}
                      </div>
                    </div>
                  ) : (
                    <div className="pt-1.5 border-t border-slate-200/80 text-xs font-semibold text-emerald-700">
                      Đợt 2 · Đã thanh toán đủ 100% ngay đợt 1 (Còn lại 0đ)
                    </div>
                  )}
                </div>
              )}

              {(draftVoucherAudit.isQualifiedVoucher ||
                draftVoucherAudit.hasSubThresholdDiscount ||
                draftVoucherAudit.isCoc) && (
                <div
                  className={`no-print px-4 py-2 border-t text-xs font-medium num-clean ${
                    draftVoucherAudit.isQualifiedVoucher
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : draftVoucherAudit.hasSubThresholdDiscount
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  {draftVoucherAudit.isQualifiedVoucher
                    ? `Phát sinh giảm khách ${formatVND(draftVoucherAudit.voucherDeductAmount)} (≥ 1.000đ) · Tự động trừ ${formatVND(draftVoucherAudit.voucherDeductAmount)} vào Quỹ Voucher khi lưu.`
                    : draftVoucherAudit.hasSubThresholdDiscount
                      ? `Mức giảm ${formatVND(draftVoucherAudit.rawDiscountAmount)} nhỏ hơn 1.000đ · Phát sinh giảm từ 1.000đ trở lên mới tính trừ vào Quỹ Voucher.`
                      : 'Đơn đã Cọc (chưa phát sinh giảm khách từ 1.000đ) · Không trừ Quỹ Voucher.'}
                </div>
              )}
              </div>

              {(store.preparerName.trim() || canShowSignature) && (
                <div className="pt-1 text-center space-y-0.5 num-clean">
                  <div className="text-xs sm:text-sm italic text-slate-600">
                    {formatSignatureDateVN(createdAt)}
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
                        className="h-16 sm:h-[72px] print:h-16 w-auto max-w-[220px] object-contain mx-auto select-none"
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

import { useMemo, useState } from 'react';
import {
  BookmarkCheck,
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  FolderOpen,
  GripVertical,
  Minus,
  Plus,
  RotateCcw,
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
  formatDateTimeVN,
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

interface LiveQuoteSidebarProps {
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
  onResetQuote: () => void;
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
  onSaveAsNewInvoice: () => void;
  onViewEditingInvoice?: () => void;
  onOpenSavedTab: () => void;
  onCopyImage: () => void;
  onDownloadImage: () => void;
  onOpenPrintView: () => void;
  onOpenCalculator?: () => void;
  copySuccess: boolean;
  isCopying: boolean;
}

const DEMO_QUICK_OPTIONS = [
  { label: 'Hôm nay', offset: 0 },
  { label: 'Ngày mai', offset: 1 },
  { label: '+2 ngày', offset: 2 },
  { label: '+3 ngày', offset: 3 },
];

export function LiveQuoteSidebar({
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
  onResetQuote,
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
  onSaveAsNewInvoice,
  onViewEditingInvoice,
  onOpenSavedTab,
  onCopyImage,
  onDownloadImage,
  onOpenPrintView,
  onOpenCalculator,
  copySuccess,
  isCopying,
}: LiveQuoteSidebarProps) {
  const { tbodyRef, draggingId, startRowDrag } = useRowReorder(
    items.length,
    onMoveItem
  );
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
    <div
      id="workspace-invoice-editor"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs"
    >
      <div className="h-1.5 bg-[#4887EE]" />

      {/* Active Saved Quote Editing Banner */}
      {editingInvoiceCode && (
        <div className="px-4 sm:px-6 py-2.5 bg-blue-50/80 border-b border-blue-200 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs sm:text-sm font-semibold text-slate-800 num-clean">
            <span>Đang mở báo giá đã lưu: </span>
            <span className="font-extrabold text-blue-700">
              {editingInvoiceCode}
            </span>
            <span className="text-slate-500 font-medium">
              {' '}
              · Tạo lúc {formatDateTimeVN(createdAt)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={items.length === 0 || isSaving}
              onClick={onSaveInvoice}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-md cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-40"
            >
              <Save className="w-3.5 h-3.5 shrink-0" />
              <span>Lưu cập nhật</span>
            </button>

            <button
              type="button"
              disabled={items.length === 0 || isSaving}
              onClick={onSaveAsNewInvoice}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-40"
            >
              <span>Lưu thành báo giá mới</span>
            </button>

            {onViewEditingInvoice && (
              <button
                type="button"
                onClick={onViewEditingInvoice}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md cursor-pointer whitespace-nowrap shrink-0"
              >
                <Eye className="w-3.5 h-3.5 shrink-0" />
                <span>Xem chi tiết</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenSavedTab}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md cursor-pointer whitespace-nowrap shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5 shrink-0" />
              <span>Danh sách đã lưu</span>
            </button>

            <button
              type="button"
              onClick={onResetQuote}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-md cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>Tạo báo giá mới</span>
            </button>
          </div>
        </div>
      )}

      <div className="p-4 sm:p-6 space-y-4">
        {/* 1. Landscape Invoice Header: Company Logo at Corner + Contact Info + Dates on Top, Large Centered PHIẾU ĐẶT HÀNG Below */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3.5 border-b border-slate-200">
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
            <div className="min-w-0 space-y-1">
              <p className="text-xs sm:text-sm text-slate-800 font-semibold">
                {[store.address, store.phone ? `ĐT: ${store.phone}` : '']
                  .filter(Boolean)
                  .join('  ·  ')}
              </p>
              <p className="text-xs sm:text-sm text-slate-500">
                {[
                  store.email ? `Email: ${store.email}` : '',
                  store.tiktok ? `TikTok: ${store.tiktok}` : '',
                ]
                  .filter(Boolean)
                  .join('  ·  ')}
              </p>
            </div>
          </div>

          <div className="md:text-right space-y-1.5 shrink-0">
            <div className="flex md:justify-end items-center gap-3">
              <div className="text-xs sm:text-sm font-semibold text-slate-700 num-clean">
                Ngày lập: {formatDateOnlyVN(createdAt)}
              </div>
              {items.length > 0 && !editingInvoiceCode && (
                <button
                  type="button"
                  onClick={onResetQuote}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Làm mới</span>
                </button>
              )}
            </div>

            {/* Ngày nhận demo dự kiến - RED */}
            <div className="flex flex-wrap md:justify-end items-center gap-1.5 pt-0.5">
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
              {DEMO_QUICK_OPTIONS.map((opt) => {
                const iso = getLocalISODate(opt.offset);
                const active = expectedDemoDate === iso;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => onChangeExpectedDemoDate(iso)}
                    className={`h-7 px-2 text-[11px] font-semibold rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-red-300 hover:text-red-600'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
              {expectedDemoDate && (
                <button
                  type="button"
                  onClick={() => onChangeExpectedDemoDate('')}
                  className="text-xs text-slate-400 hover:text-slate-700 px-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Ẩn
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Large Centered PHIẾU ĐẶT HÀNG directly below ATD Color info */}
        <div className="pt-1 pb-0.5 text-center">
          <h3 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            {store.invoiceTitle || 'PHIẾU ĐẶT HÀNG'}
          </h3>
        </div>

        {/* 2. Compact 3-Column Customer Info (Khách hàng | Mã khách hàng | Số điện thoại) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-center gap-2 px-3 h-9 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs font-semibold text-slate-500 whitespace-nowrap shrink-0">
              Khách hàng:
            </span>
            <input
              type="text"
              value={customer.name}
              onChange={(e) =>
                onChangeCustomer({ ...customer, name: e.target.value })
              }
              placeholder="Nhập tên khách..."
              className="w-full text-sm font-semibold text-slate-900 bg-transparent focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 px-3 h-9 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs font-semibold text-slate-500 whitespace-nowrap shrink-0">
              Mã khách hàng:
            </span>
            <input
              type="text"
              value={customer.code}
              onChange={(e) =>
                onChangeCustomer({ ...customer, code: e.target.value })
              }
              placeholder="Tự tạo khi bấm Lưu..."
              className="w-full text-sm font-bold text-slate-900 num-clean bg-transparent focus:outline-none placeholder:font-normal"
            />
          </div>

          <div className="flex items-center gap-2 px-3 h-9 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs font-semibold text-slate-500 whitespace-nowrap shrink-0">
              Số điện thoại:
            </span>
            <input
              type="tel"
              value={customer.phone}
              onChange={(e) =>
                onChangeCustomer({ ...customer, phone: e.target.value })
              }
              placeholder="Nhập SĐT..."
              className="w-full text-sm font-semibold text-slate-900 num-clean bg-transparent focus:outline-none"
            />
          </div>
        </div>

        {/* 3. Wide Landscape 6-Column Table (with multi-line GHI CHÚ next to THÀNH TIỀN) */}
        {items.length === 0 ? (
          <div className="py-8 px-4 text-center border border-dashed border-slate-200 rounded-lg">
            <p className="text-sm sm:text-base font-medium text-slate-600">
              Chưa có sản phẩm nào trong hóa đơn
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Bấm chọn sản phẩm, Thiết kế (Menu / Poster) hoặc Sản phẩm khác ở trên để thêm vào hóa đơn
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
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
                  Bấm nút <strong>Sao chép</strong> tại cột <strong>STT</strong> để nhân bản cả hàng xuống dưới (nhập thêm thông tin khác)
                </span>
              </span>
            </div>
            <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
              <table
                className={`w-full text-left border-collapse min-w-[875px] ${
                  draggingId ? 'select-none cursor-grabbing' : ''
                }`}
              >
                <thead>
                  <tr className="bg-[#4887EE] text-white text-xs font-bold">
                    <th className="py-2.5 px-2 text-center w-24 border-r border-white/30">
                      STT
                    </th>
                    <th className="py-2.5 px-3.5">NỘI DUNG & KÍCH THƯỚC</th>
                    <th className="py-2.5 px-2 text-center w-28">SỐ LƯỢNG</th>
                    <th className="py-2.5 px-3 text-right w-40">ĐƠN GIÁ (TỰ CHỈNH)</th>
                    <th className="py-2.5 px-3.5 text-right w-36">THÀNH TIỀN</th>
                    <th className="py-2.5 px-3.5 w-60 min-w-[200px] border-l border-white/30">
                      GHI CHÚ
                    </th>
                    <th className="py-2.5 px-2 w-9" aria-label="Xóa" />
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
                          className={`py-2.5 px-1.5 align-top font-bold text-slate-900 num-clean border-r border-slate-200 ${
                            items.length > 1
                              ? 'cursor-grab active:cursor-grabbing touch-none select-none hover:bg-slate-100/80'
                              : 'text-center'
                          }`}
                        >
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
                        </td>
                        <td className="py-2.5 px-3.5 align-top">
                          <AutoResizeTextarea
                            value={item.name}
                            onChange={(nextName) =>
                              onUpdateItem(item.id, { name: nextName })
                            }
                            ariaLabel="Tên sản phẩm và kích thước"
                            minHeightPx={30}
                            className="font-semibold text-slate-900 border-b border-transparent hover:border-slate-300 focus:border-slate-900 py-1"
                          />
                        </td>

                        <td className="py-2.5 px-2 align-top">
                          <div className="flex items-center justify-center">
                            <div className="inline-flex items-center border border-slate-200 rounded-md bg-white">
                              <button
                                type="button"
                                aria-label="Giảm"
                                onClick={() => {
                                  if (item.quantity <= 1) {
                                    onRemoveItem(item.id);
                                  } else {
                                    onUpdateItem(item.id, {
                                      quantity: item.quantity - 1,
                                    });
                                  }
                                }}
                                className="w-7 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-100 cursor-pointer"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <QuantityInput
                                value={item.quantity}
                                min={1}
                                onChange={(nextQty) =>
                                  onUpdateItem(item.id, { quantity: nextQty })
                                }
                                ariaLabel="Số lượng"
                                className="w-11 h-8 text-sm"
                              />
                              <button
                                type="button"
                                aria-label="Tăng"
                                onClick={() =>
                                  onUpdateItem(item.id, {
                                    quantity: item.quantity + 1,
                                  })
                                }
                                className="w-7 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-100 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </td>

                        <td className="py-2.5 px-3 align-top">
                          <div className="flex justify-end">
                            <MoneyInput
                              value={item.unitPrice}
                              onChange={(nextPrice) =>
                                onUpdateItem(item.id, { unitPrice: nextPrice })
                              }
                              placeholder="Nhập giá"
                              ariaLabel="Đơn giá"
                              textColorClass="text-blue-700"
                              className="w-36 h-8 text-sm sm:text-base bg-white border border-slate-300 rounded-md focus-within:border-slate-900"
                            />
                          </div>
                        </td>

                        <td className="py-2.5 px-3.5 align-top text-right font-bold text-slate-900 num-clean whitespace-nowrap">
                          <span className="inline-block pt-1">
                            {formatVND(lineTotal)}
                          </span>
                        </td>

                        <td className="py-2.5 px-3.5 align-top border-l border-slate-200">
                          <AutoResizeTextarea
                            value={item.note || ''}
                            onChange={(nextNote) =>
                              onUpdateItem(item.id, { note: nextNote })
                            }
                            placeholder="Ghi thông tin (Enter xuống dòng)..."
                            ariaLabel="Ghi chú sản phẩm"
                            minHeightPx={30}
                            className="text-xs sm:text-sm text-slate-700 border-b border-slate-200/80 hover:border-slate-400 focus:border-slate-900 py-1 placeholder:text-slate-400"
                          />
                        </td>

                        <td className="py-2.5 px-2 align-top text-center">
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

        {/* 4. Landscape 2-Column Footer */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start pt-1">
          <div className="lg:col-span-7 space-y-3">
            {/* Above Ghi chú: Mẫu Thiết Kế đã đính kèm, ảnh minh họa */}
            <DesignIllustrationSelector
              value={designIllustration}
              onChange={onChangeDesignIllustration}
            />

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label
                  htmlFor="landscape-invoice-note"
                  className="text-xs font-bold text-slate-700"
                >
                  Ghi chú chung trên hóa đơn:
                </label>
                <div className="flex items-center gap-3 shrink-0">
                  {invoiceNote !== store.footerNote && (
                    <button
                      type="button"
                      onClick={() => onChangeInvoiceNote(store.footerNote)}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800 cursor-pointer whitespace-nowrap"
                    >
                      Khôi phục mặc định
                    </button>
                  )}
                  {invoiceNote && (
                    <button
                      type="button"
                      onClick={() => onChangeInvoiceNote('')}
                      className="text-xs text-slate-400 hover:text-slate-700 cursor-pointer whitespace-nowrap"
                    >
                      Xóa ghi chú
                    </button>
                  )}
                </div>
              </div>
              <textarea
                id="landscape-invoice-note"
                rows={6}
                value={invoiceNote}
                onChange={(e) => onChangeInvoiceNote(e.target.value)}
                placeholder="Nhập ghi chú chung cuối hóa đơn (để trống nếu không cần hiện)..."
                className="w-full px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed text-slate-800 bg-slate-50/90 border border-slate-200 rounded-lg transition-colors duration-150 hover:border-slate-300 focus:bg-white focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 resize-y"
              />
            </div>

            <div className="space-y-2.5 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={items.length === 0 || isSaving}
                  onClick={onSaveInvoice}
                  className={`h-10 inline-flex items-center gap-2 px-4 text-sm font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
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
                        {editingInvoiceCode
                          ? 'Lưu cập nhật báo giá'
                          : 'Lưu báo giá'}
                      </span>
                    </>
                  )}
                </button>

                {editingInvoiceCode && (
                  <button
                    type="button"
                    disabled={items.length === 0 || isSaving}
                    onClick={onSaveAsNewInvoice}
                    className="h-10 inline-flex items-center gap-1.5 px-3.5 text-xs sm:text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span>Lưu thành báo giá mới</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={items.length === 0 || isCopying}
                  onClick={onCopyImage}
                  className={`h-10 inline-flex items-center gap-2 px-4 text-sm font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
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
                      <span>Sao chép ảnh hóa đơn</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={items.length === 0}
                  onClick={onDownloadImage}
                  className="h-10 inline-flex items-center gap-1.5 px-3.5 text-xs sm:text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span>Tải ảnh</span>
                </button>

                <button
                  type="button"
                  onClick={onOpenPrintView}
                  className="h-10 inline-flex items-center gap-1.5 px-3.5 text-xs sm:text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Eye className="w-4 h-4 shrink-0" />
                  <span>Xem bản in / PDF</span>
                </button>

                {onOpenCalculator && (
                  <button
                    type="button"
                    onClick={onOpenCalculator}
                    className="h-10 inline-flex items-center gap-1.5 px-3.5 text-xs sm:text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Calculator className="w-4 h-4 shrink-0 text-blue-600" />
                    <span>Máy tính</span>
                  </button>
                )}
              </div>

              {(saveSuccess || copySuccess) && (
                <div className="view-smooth-enter flex flex-col gap-1.5 px-3.5 py-2.5 text-xs sm:text-sm text-emerald-950 bg-emerald-50 border border-emerald-200 rounded-lg num-clean">
                  <div className="font-extrabold text-emerald-800 text-sm sm:text-base">
                    Chúc Sale Tuấn Đạt chốt thành công nha.
                  </div>
                  {saveSuccess && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-emerald-900">
                      <span>
                        Đã lưu báo giá kèm thông tin khách hàng, sản phẩm đã chọn và thời gian tạo ({formatDateTimeVN(createdAt)}).
                      </span>
                      <div className="flex items-center gap-3">
                        {onViewEditingInvoice && (
                          <button
                            type="button"
                            onClick={onViewEditingInvoice}
                            className="font-bold text-emerald-800 hover:text-emerald-950 underline cursor-pointer whitespace-nowrap"
                          >
                            Xem chi tiết
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={onOpenSavedTab}
                          className="font-bold text-emerald-800 hover:text-emerald-950 underline cursor-pointer whitespace-nowrap"
                        >
                          Mở danh sách đã lưu ({savedCount})
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {cloudError && (
                <div className="px-3 py-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg">
                  {cloudError}
                </div>
              )}
            </div>
          </div>

          {/* 5-Row Payment Summary + Right-Side Preparer Signature Block */}
          <div className="lg:col-span-5 space-y-4">
            <div className="border border-slate-300 rounded-lg overflow-hidden bg-white">
            <div className="no-print flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 bg-slate-50/80">
              <label
                htmlFor="sidebar-report-stage"
                className="text-xs sm:text-sm font-semibold text-slate-700 whitespace-nowrap shrink-0"
              >
                Trạng thái đơn:
              </label>
              <div className="flex items-center gap-1.5">
                <select
                  id="sidebar-report-stage"
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
              <span className="text-sm font-semibold text-slate-700">
                Tổng giá trị đơn:
              </span>
              <span className="text-base sm:text-lg font-bold text-slate-900 num-clean">
                {formatVND(totals.subtotal)}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-slate-200 bg-slate-50/50">
              <div className="flex flex-wrap items-center gap-1 min-w-0">
                <label
                  htmlFor="sidebar-discount-input"
                  className="text-sm font-semibold text-slate-700 whitespace-nowrap shrink-0 mr-0.5"
                >
                  Tiền giảm:
                </label>
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
              <MoneyInput
                id="sidebar-discount-input"
                value={discountAmount}
                onChange={onChangeDiscountAmount}
                placeholder="Từ 1.000đ"
                textColorClass="text-rose-600"
                className="w-36 sm:w-40 h-8 text-sm sm:text-base bg-white border border-slate-300 rounded-md focus-within:border-slate-900"
              />
            </div>

            <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-slate-200 bg-slate-50/50">
              <label
                htmlFor="sidebar-shipping-input"
                className="text-sm font-semibold text-slate-700 whitespace-nowrap shrink-0"
              >
                Tiền ship:
              </label>
              <MoneyInput
                id="sidebar-shipping-input"
                value={shippingFee}
                onChange={onChangeShippingFee}
                placeholder="0"
                textColorClass="text-slate-900"
                className="w-40 h-8 text-sm sm:text-base bg-white border border-slate-300 rounded-md focus-within:border-slate-900"
              />
            </div>

            <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-slate-200 bg-slate-50/50">
              <label
                htmlFor="sidebar-deposit-input"
                className="text-sm font-semibold text-slate-700 whitespace-nowrap shrink-0"
              >
                Đã cọc:
              </label>
              <MoneyInput
                id="sidebar-deposit-input"
                value={depositAmount}
                onChange={onChangeDepositAmount}
                placeholder="0"
                textColorClass="text-blue-700"
                className="w-40 h-8 text-sm sm:text-base bg-white border border-slate-300 rounded-md focus-within:border-slate-900"
              />
            </div>

            <div className="flex items-center justify-between px-4 py-3 bg-[#4887EE] text-white">
              <div className="min-w-0">
                <div className="text-sm sm:text-base font-bold">
                  Thanh toán còn lại:
                </div>
                {remainingPaid && totals.remainingAmount > 0 && (
                  <div className="text-[11px] font-semibold text-white/90 num-clean">
                    Đã thu đủ phần còn lại ({formatISODateVN(effectivePaidDate)})
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
                            onChangeRemainingPaid(remainingPaid, e.target.value)
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

          {/* Mobile Quick Save Bar right below Payment Summary so phone users can tap Save immediately */}
          <div className="lg:hidden grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              disabled={items.length === 0 || isSaving}
              onClick={onSaveInvoice}
              className={`h-11 inline-flex items-center justify-center gap-2 px-3 text-sm font-bold rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                saveSuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#4887EE] hover:bg-[#3674DC] text-white'
              }`}
            >
              {isSaving ? (
                <>
                  <Save className="w-4 h-4 shrink-0 animate-pulse" />
                  <span>Đang lưu...</span>
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
              disabled={items.length === 0 || isCopying}
              onClick={onCopyImage}
              className={`h-11 inline-flex items-center justify-center gap-2 px-3 text-sm font-bold rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                copySuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#3674DC] hover:bg-[#2A62C4] text-white'
              }`}
            >
              {copySuccess ? (
                <>
                  <Check className="w-4 h-4 shrink-0" />
                  <span>Đã chép ảnh!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 shrink-0" />
                  <span>Sao chép ảnh</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

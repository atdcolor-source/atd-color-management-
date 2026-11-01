import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  Eye,
  FolderOpen,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import {
  getReportStageLabel,
  REPORT_STAGE_OPTIONS,
} from '../constants/reportStages';
import { ReportStage, SavedInvoice } from '../types';
import {
  formatDateTimeVN,
  formatISODateVN,
  formatVND,
  getLocalISODate,
} from '../utils/formatters';
import {
  getInvoiceRemainingPaidDate,
  getUncollectedRemainingAmount,
  hasCollectibleRemainingBalance,
  isInvoiceRemainingSettled,
  sanitizeOptionalOrderDate,
} from '../utils/revenueSplit';

interface SavedInvoicesViewProps {
  accountUsername: string;
  invoices: SavedInvoice[];
  activeEditingId: string | null;
  isLoadingCloud: boolean;
  unsyncedCount: number;
  cloudError: string | null;
  legacyQuoteCount: number;
  isImportingLegacy: boolean;
  onImportLegacyQuotes: () => void;
  onDismissLegacyQuotes: () => void;
  onRetrySync: () => void;
  onSaveInvoiceStage: (
    invoice: SavedInvoice,
    stage: ReportStage,
    paymentPatch?: { remainingPaid?: boolean; remainingPaidAt?: string }
  ) => void;
  onOpenReportsTab: (stage?: ReportStage) => void;
  onViewInvoice: (invoice: SavedInvoice) => void;
  onEditInvoice: (invoice: SavedInvoice) => void;
  onCopySavedInvoiceImage: (invoice: SavedInvoice) => Promise<void>;
  onDeleteInvoice: (id: string) => void;
  onCreateNewInvoice: () => void;
}

type PaymentFilter = 'all' | 'remaining' | 'settled';

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

export function SavedInvoicesView({
  accountUsername,
  invoices,
  activeEditingId,
  isLoadingCloud,
  unsyncedCount,
  cloudError,
  legacyQuoteCount,
  isImportingLegacy,
  onImportLegacyQuotes,
  onDismissLegacyQuotes,
  onRetrySync,
  onSaveInvoiceStage,
  onOpenReportsTab,
  onViewInvoice,
  onEditInvoice,
  onCopySavedInvoiceImage,
  onDeleteInvoice,
  onCreateNewInvoice,
}: SavedInvoicesViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedArchiveLink, setCopiedArchiveLink] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draftStages, setDraftStages] = useState<Record<string, ReportStage>>(
    {}
  );
  const [draftPaidDates, setDraftPaidDates] = useState<Record<string, string>>(
    {}
  );
  const [justSavedStageId, setJustSavedStageId] = useState<string | null>(null);
  const savedStageTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (savedStageTimerRef.current !== null) {
        window.clearTimeout(savedStageTimerRef.current);
      }
    };
  }, []);

  const { remainingCount, settledCount } = useMemo(() => {
    let rem = 0;
    let set = 0;
    for (const inv of invoices) {
      if (getUncollectedRemainingAmount(inv) > 0) {
        rem += 1;
      } else {
        set += 1;
      }
    }
    return { remainingCount: rem, settledCount: set };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return invoices.filter((inv) => {
      const uncollected = getUncollectedRemainingAmount(inv);
      if (paymentFilter === 'remaining' && uncollected <= 0) {
        return false;
      }
      if (paymentFilter === 'settled' && uncollected > 0) {
        return false;
      }
      if (!q) return true;
      const inCode = inv.code.toLowerCase().includes(q);
      const inName = inv.customer.name.toLowerCase().includes(q);
      const inCustCode = (inv.customer.code || '').toLowerCase().includes(q);
      const inPhone = inv.customer.phone.toLowerCase().includes(q);
      const inItems = inv.items.some(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.note || '').toLowerCase().includes(q)
      );
      const inDesign = (inv.designIllustration || '').toLowerCase().includes(q);
      return inCode || inName || inCustCode || inPhone || inItems || inDesign;
    });
  }, [invoices, searchQuery, paymentFilter]);

  const handleCopyArchiveLink = async () => {
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const shareUrl = `${baseUrl}?tab=saved`;
    await copyTextSafe(shareUrl);
    setCopiedArchiveLink(true);
    window.setTimeout(() => setCopiedArchiveLink(false), 2600);
  };

  const handleCopyClick = async (invoice: SavedInvoice) => {
    if (busyId) return;
    setBusyId(invoice.id);
    try {
      await onCopySavedInvoiceImage(invoice);
      setCopiedId(invoice.id);
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === invoice.id ? null : prev));
      }, 2400);
    } finally {
      setBusyId(null);
    }
  };

  const getSelectedStageForInvoice = (inv: SavedInvoice): ReportStage => {
    return (
      draftStages[inv.id] ||
      (inv.reportStage ? (inv.reportStage as ReportStage) : 'bao_gia')
    );
  };

  const getEffectivePaidDate = (inv: SavedInvoice): string => {
    if (isInvoiceRemainingSettled(inv)) {
      return (
        sanitizeOptionalOrderDate(draftPaidDates[inv.id]) ||
        getInvoiceRemainingPaidDate(inv)
      );
    }
    return (
      sanitizeOptionalOrderDate(draftPaidDates[inv.id]) || getLocalISODate(0)
    );
  };

  const flashSavedStage = (invoiceId: string) => {
    setJustSavedStageId(invoiceId);
    if (savedStageTimerRef.current !== null) {
      window.clearTimeout(savedStageTimerRef.current);
    }
    savedStageTimerRef.current = window.setTimeout(() => {
      setJustSavedStageId((curr) => (curr === invoiceId ? null : curr));
      savedStageTimerRef.current = null;
    }, 2600);
  };

  const handleSaveStageClick = (inv: SavedInvoice) => {
    const chosenStage = getSelectedStageForInvoice(inv);
    if (chosenStage === 'hoan_thanh') {
      onSaveInvoiceStage(inv, chosenStage, {
        remainingPaid: true,
        remainingPaidAt: getEffectivePaidDate(inv),
      });
    } else {
      onSaveInvoiceStage(inv, chosenStage);
    }
    setDraftStages((prev) => {
      if (!(inv.id in prev)) return prev;
      const next = { ...prev };
      delete next[inv.id];
      return next;
    });
    flashSavedStage(inv.id);
  };

  const handleToggleRemainingPaid = (inv: SavedInvoice, checked: boolean) => {
    const effectiveDate =
      sanitizeOptionalOrderDate(draftPaidDates[inv.id]) ||
      sanitizeOptionalOrderDate(inv.remainingPaidAt) ||
      getLocalISODate(0);
    const fallbackUnsettledStage: ReportStage =
      inv.reportStage && inv.reportStage !== 'hoan_thanh'
        ? (inv.reportStage as ReportStage)
        : inv.totals.depositAmount > 0
          ? 'coc'
          : 'bao_gia';
    const nextStage: ReportStage = checked
      ? 'hoan_thanh'
      : fallbackUnsettledStage;

    onSaveInvoiceStage(inv, nextStage, {
      remainingPaid: checked,
      remainingPaidAt: checked ? effectiveDate : '',
    });
    setDraftStages((prev) => {
      if (!(inv.id in prev)) return prev;
      const next = { ...prev };
      delete next[inv.id];
      return next;
    });
    flashSavedStage(inv.id);
  };

  const handleChangeRemainingPaidDate = (
    inv: SavedInvoice,
    rawDate: string
  ) => {
    const clean = sanitizeOptionalOrderDate(rawDate);
    if (!clean) return;
    setDraftPaidDates((prev) => ({
      ...prev,
      [inv.id]: clean,
    }));
    if (isInvoiceRemainingSettled(inv)) {
      onSaveInvoiceStage(inv, 'hoan_thanh', {
        remainingPaid: true,
        remainingPaidAt: clean,
      });
      flashSavedStage(inv.id);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Shared-Link Cloud Sync Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-slate-900">
              Danh sách báo giá đã lưu
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5 num-clean">
              Tổng cộng {invoices.length} báo giá đã lưu kèm thông tin khách hàng, sản phẩm và thời gian tạo · Chọn báo giá bất kỳ để xem chi tiết hoặc chỉnh sửa
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopyArchiveLink()}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                copiedArchiveLink
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-blue-50 hover:bg-blue-100 text-[#3674DC] border-blue-200'
              }`}
            >
              {copiedArchiveLink ? (
                <>
                  <Check className="w-4 h-4 shrink-0" />
                  <span>Đã sao chép link danh sách!</span>
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4 shrink-0" />
                  <span>Sao chép link danh sách</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onCreateNewInvoice}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Tạo báo giá mới</span>
            </button>
          </div>
        </div>

        {legacyQuoteCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-800 num-clean">
            <span>
              Phát hiện <strong>{legacyQuoteCount} báo giá cũ</strong> đã lưu trước khi tạo tài khoản. Bạn có muốn chuyển vào tài khoản <strong>@{accountUsername}</strong> không?
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isImportingLegacy}
                onClick={onImportLegacyQuotes}
                className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                {isImportingLegacy
                  ? 'Đang chuyển...'
                  : `Gộp ${legacyQuoteCount} báo giá vào tài khoản`}
              </button>
              <button
                type="button"
                disabled={isImportingLegacy}
                onClick={onDismissLegacyQuotes}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-md cursor-pointer whitespace-nowrap"
              >
                Bỏ qua
              </button>
            </div>
          </div>
        )}

        {cloudError && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs sm:text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg">
            <span>{cloudError}</span>
            <button
              type="button"
              onClick={onRetrySync}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-amber-900 bg-white border border-amber-300 hover:bg-amber-100 rounded-md cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <span>Thử lại ngay</span>
            </button>
          </div>
        )}

        {/* Search & Filter Controls */}
        {invoices.length > 0 && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm theo tên khách hàng, mã khách hàng, SĐT, mã báo giá hoặc sản phẩm..."
                className="w-full h-10 pl-9 pr-3 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-900"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto overflow-x-auto max-w-full">
              <button
                type="button"
                onClick={() => setPaymentFilter('all')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                  paymentFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tất cả ({invoices.length})
              </button>
              <button
                type="button"
                onClick={() => setPaymentFilter('remaining')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                  paymentFilter === 'remaining'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Còn thanh toán ({remainingCount})
              </button>
              <button
                type="button"
                onClick={() => setPaymentFilter('settled')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                  paymentFilter === 'settled'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Đã tất toán ({settledCount})
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Loading Skeleton State */}
      {isLoadingCloud && invoices.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="h-12 bg-slate-100 rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : invoices.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-14 px-6 text-center">
          <FolderOpen className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h2 className="text-base sm:text-lg font-bold text-slate-900">
            Chưa có báo giá nào được lưu
          </h2>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
            Sau khi chọn sản phẩm và nhập thông tin khách hàng, bấm nút Lưu báo giá để lưu cố định thông tin khách hàng, sản phẩm đã chọn và thời gian tạo vào đây.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={onCreateNewInvoice}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Chọn sản phẩm & Tạo báo giá</span>
            </button>
          </div>
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-10 px-6 text-center">
          <p className="text-sm font-medium text-slate-600">
            Không tìm thấy báo giá nào khớp với từ khóa tìm kiếm.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setPaymentFilter('all');
            }}
            className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-800 underline cursor-pointer"
          >
            Xóa bộ lọc tìm kiếm
          </button>
        </div>
      ) : (
        <>
          {/* Mobile Phone Card List (< md) — Click card to view detail */}
          <div className="md:hidden space-y-3">
            {filteredInvoices.map((inv) => {
              const isEditingThis = activeEditingId === inv.id;
              const demoVN = formatISODateVN(inv.expectedDemoDate);
              const isEditedAfterCreate =
                Math.abs(
                  new Date(inv.updatedAt).getTime() -
                    new Date(inv.createdAt).getTime()
                ) > 5000;
              const settled = isInvoiceRemainingSettled(inv);
              const uncollected = getUncollectedRemainingAmount(inv);
              const paidDateVN = formatISODateVN(
                getInvoiceRemainingPaidDate(inv)
              );
              const showStage2Control =
                hasCollectibleRemainingBalance(inv) ||
                Boolean(inv.remainingPaid) ||
                inv.reportStage === 'hoan_thanh';

              return (
                <div
                  key={inv.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onViewInvoice(inv)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onViewInvoice(inv);
                    }
                  }}
                  className={`bg-white border rounded-xl p-4 space-y-3 shadow-2xs transition-colors cursor-pointer ${
                    isEditingThis
                      ? 'border-blue-400 bg-blue-50/30'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        <span className="font-extrabold text-slate-900 text-sm num-clean">
                          {inv.code}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span
                          className={
                            inv.syncedToCloud
                              ? 'text-emerald-700 font-medium'
                              : 'text-blue-700 font-medium'
                          }
                        >
                          {inv.syncedToCloud
                            ? 'Đã lưu đám mây'
                            : 'Đang đồng bộ...'}
                        </span>
                        {isEditingThis && (
                          <>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span className="font-bold text-blue-700">
                              Đang chỉnh sửa
                            </span>
                          </>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-1 num-clean space-y-0.5">
                        <div>
                          Thời gian tạo: {formatDateTimeVN(inv.createdAt)}
                        </div>
                        {isEditedAfterCreate && (
                          <div>
                            Cập nhật: {formatDateTimeVN(inv.updatedAt)}
                          </div>
                        )}
                        {demoVN && (
                          <div className="font-bold text-red-600">
                            Demo: {demoVN}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0 num-clean">
                      <div className="text-[11px] text-slate-500">Còn lại</div>
                      {settled ? (
                        <>
                          <div className="text-base font-extrabold text-emerald-700">
                            0đ
                          </div>
                          <div className="text-[11px] font-semibold text-emerald-700">
                            Đã tất toán{' '}
                            {inv.totals.remainingAmount > 0
                              ? paidDateVN
                              : 'đợt 1'}
                          </div>
                        </>
                      ) : (
                        <div className="text-base font-extrabold text-slate-900">
                          {formatVND(uncollected)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-xs space-y-0.5">
                    <div className="font-bold text-slate-900 text-sm">
                      {inv.customer.name.trim() || 'Khách lẻ'}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-slate-600 num-clean">
                      {inv.customer.code.trim() && (
                        <span>
                          Mã KH: <strong>{inv.customer.code}</strong>
                        </span>
                      )}
                      {inv.customer.phone.trim() && (
                        <span>SĐT: {inv.customer.phone}</span>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-slate-700 space-y-0.5">
                    <div className="line-clamp-2 font-medium">
                      {inv.items
                        .map((i) => `${i.name} (x${i.quantity})`)
                        .join(', ')}
                    </div>
                    <div className="text-slate-500 num-clean">
                      {inv.items.length} sản phẩm · Tạm tính:{' '}
                      {formatVND(inv.totals.subtotal)}
                      {inv.totals.discountAmount > 0 &&
                        ` · Giảm ${formatVND(inv.totals.discountAmount)}`}
                      {inv.totals.shippingFee > 0 &&
                        ` · Ship ${formatVND(inv.totals.shippingFee)}`}
                      {` · Cọc ${formatVND(inv.totals.depositAmount)}`}
                      {settled &&
                        inv.totals.remainingAmount > 0 &&
                        ` · Đợt 2: ${formatVND(inv.totals.remainingAmount)}`}
                    </div>
                  </div>

                  <div
                    className="space-y-2.5 pt-2 border-t border-slate-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {showStage2Control && (
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200/80 rounded-lg px-2.5 py-2 num-clean">
                        <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={settled}
                            onChange={(e) =>
                              handleToggleRemainingPaid(inv, e.target.checked)
                            }
                            className="w-4 h-4 rounded border-slate-300 accent-emerald-600 cursor-pointer shrink-0"
                          />
                          <span>
                            Đã thu phần còn lại
                            {inv.totals.remainingAmount > 0
                              ? ` (${formatVND(inv.totals.remainingAmount)})`
                              : ''}
                          </span>
                        </label>

                        <div className="inline-flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500 font-medium">
                            Ngày thu:
                          </span>
                          <input
                            type="date"
                            aria-label={`Ngày thu phần còn lại cho ${inv.code}`}
                            value={getEffectivePaidDate(inv)}
                            onChange={(e) =>
                              handleChangeRemainingPaidDate(inv, e.target.value)
                            }
                            className="h-7 px-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#4887EE] cursor-pointer num-clean"
                          />
                        </div>
                      </div>
                    )}

                    {/* Phân loại + Nút Lưu (chạy vào tab Báo cáo) */}
                    <div className="flex flex-col gap-1.5 bg-slate-50 border border-slate-200/80 rounded-lg p-2.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-slate-700">
                          Phân loại:
                        </span>
                        {inv.reportStage ? (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenReportsTab(inv.reportStage as ReportStage)
                            }
                            className="inline-flex items-center gap-0.5 text-xs font-semibold text-[#3674DC] hover:underline cursor-pointer whitespace-nowrap"
                          >
                            <span>
                              Đang ở: {getReportStageLabel(inv.reportStage)}
                            </span>
                            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                          </button>
                        ) : (
                          <span className="text-slate-500">
                            Chọn tab cần lưu
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          aria-label={`Phân loại báo cáo cho ${inv.code}`}
                          value={getSelectedStageForInvoice(inv)}
                          onChange={(e) =>
                            setDraftStages((prev) => ({
                              ...prev,
                              [inv.id]: e.target.value as ReportStage,
                            }))
                          }
                          className="h-9 flex-1 min-w-0 px-2.5 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#4887EE] cursor-pointer"
                        >
                          {REPORT_STAGE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleSaveStageClick(inv)}
                          className={`inline-flex items-center justify-center gap-1 h-9 px-3.5 text-xs font-bold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            justSavedStageId === inv.id
                              ? 'bg-emerald-600 text-white'
                              : inv.reportStage &&
                                  getSelectedStageForInvoice(inv) ===
                                    inv.reportStage
                                ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : 'bg-[#4887EE] hover:bg-[#3674DC] text-white'
                          }`}
                        >
                          {justSavedStageId === inv.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 shrink-0" />
                              <span>Đã lưu</span>
                            </>
                          ) : (
                            <>
                              <Save className="w-3.5 h-3.5 shrink-0" />
                              <span>Lưu</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {confirmDeleteId === inv.id ? (
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className="text-xs font-semibold text-rose-700">
                          Xóa vĩnh viễn báo giá này?
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteInvoice(inv.id);
                              setConfirmDeleteId(null);
                            }}
                            className="px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md cursor-pointer whitespace-nowrap"
                          >
                            Xác nhận xóa
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer whitespace-nowrap"
                          >
                            Hủy
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onViewInvoice(inv)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5 shrink-0" />
                            <span>Xem chi tiết</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onEditInvoice(inv)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-md cursor-pointer whitespace-nowrap"
                          >
                            <Pencil className="w-3.5 h-3.5 shrink-0" />
                            <span>Chỉnh sửa</span>
                          </button>

                          <button
                            type="button"
                            disabled={busyId === inv.id}
                            onClick={() => void handleCopyClick(inv)}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
                              copiedId === inv.id
                                ? 'bg-emerald-600 text-white'
                                : 'bg-[#3674DC] text-white hover:bg-[#2A62C4]'
                            }`}
                          >
                            {copiedId === inv.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 shrink-0" />
                                <span>Đã chép</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5 shrink-0" />
                                <span>Ảnh</span>
                              </>
                            )}
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(inv.id)}
                          aria-label="Xóa báo giá"
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Saved Quotes Table (md+) — Click any row to view details */}
          <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[1080px]">
                <thead>
                  <tr className="bg-[#4887EE] text-white text-xs font-bold">
                    <th className="py-3 px-4 w-48">MÃ BÁO GIÁ & THỜI GIAN TẠO</th>
                    <th className="py-3 px-3 w-48">THÔNG TIN KHÁCH HÀNG</th>
                    <th className="py-3 px-3">DANH SÁCH SẢN PHẨM ĐÃ CHỌN</th>
                    <th className="py-3 px-3 text-right w-36">TỔNG / SHIP / CỌC</th>
                    <th className="py-3 px-3 text-right w-48">CÒN LẠI & ĐỢT 2</th>
                    <th className="py-3 px-3 w-56">PHÂN LOẠI</th>
                    <th className="py-3 px-4 text-right w-60">THAO TÁC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {filteredInvoices.map((inv, idx) => {
                    const isEditingThis = activeEditingId === inv.id;
                    const demoVN = formatISODateVN(inv.expectedDemoDate);
                    const isEditedAfterCreate =
                      Math.abs(
                        new Date(inv.updatedAt).getTime() -
                          new Date(inv.createdAt).getTime()
                      ) > 5000;
                    const settled = isInvoiceRemainingSettled(inv);
                    const uncollected = getUncollectedRemainingAmount(inv);
                    const paidDateVN = formatISODateVN(
                      getInvoiceRemainingPaidDate(inv)
                    );
                    const showStage2Control =
                      hasCollectibleRemainingBalance(inv) ||
                      Boolean(inv.remainingPaid) ||
                      inv.reportStage === 'hoan_thanh';

                    return (
                      <tr
                        key={inv.id}
                        tabIndex={0}
                        onClick={() => onViewInvoice(inv)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onViewInvoice(inv);
                          }
                        }}
                        className={`transition-colors cursor-pointer ${
                          isEditingThis
                            ? 'bg-blue-50/60 hover:bg-blue-50'
                            : idx % 2 === 1
                              ? 'bg-slate-50/40 hover:bg-slate-100/70'
                              : 'bg-white hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-4 align-top">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-slate-900 num-clean">
                              {inv.code}
                            </span>
                            {!inv.syncedToCloud && (
                              <span className="text-[11px] font-medium text-blue-600">
                                · Đang đồng bộ...
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5 num-clean">
                            Tạo: {formatDateTimeVN(inv.createdAt)}
                          </div>
                          {isEditedAfterCreate && (
                            <div className="text-[11px] text-slate-400 mt-0.5 num-clean">
                              Sửa: {formatDateTimeVN(inv.updatedAt)}
                            </div>
                          )}
                          {isEditingThis && (
                            <div className="text-xs font-bold text-blue-700 mt-0.5">
                              Đang chỉnh sửa
                            </div>
                          )}
                          {demoVN && (
                            <div className="text-xs font-bold text-red-600 mt-0.5 num-clean">
                              Demo: {demoVN}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 align-top">
                          <div className="font-semibold text-slate-900">
                            {inv.customer.name.trim() || 'Khách lẻ'}
                          </div>
                          {inv.customer.code.trim() && (
                            <div className="text-xs font-semibold text-slate-700 mt-0.5 num-clean">
                              Mã KH: {inv.customer.code}
                            </div>
                          )}
                          {inv.customer.phone.trim() && (
                            <div className="text-xs text-slate-500 mt-0.5 num-clean">
                              SĐT: {inv.customer.phone}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 align-top">
                          <div className="text-sm text-slate-800 line-clamp-2">
                            {inv.items
                              .map((i) => `${i.name} (x${i.quantity})`)
                              .join(', ')}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 num-clean">
                            {inv.items.length} sản phẩm · Tổng SL:{' '}
                            {inv.totals.totalQuantity}
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top text-right num-clean">
                          <div className="font-semibold text-slate-900">
                            {formatVND(
                              Math.max(
                                0,
                                inv.totals.subtotal -
                                  inv.totals.discountAmount +
                                  inv.totals.shippingFee
                              )
                            )}
                          </div>
                          {(inv.totals.discountAmount > 0 ||
                            inv.totals.shippingFee > 0) && (
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Tạm tính {formatVND(inv.totals.subtotal)}
                            </div>
                          )}
                          <div className="text-xs text-slate-500 mt-0.5">
                            {inv.totals.discountAmount > 0 && (
                              <span>
                                Giảm {formatVND(inv.totals.discountAmount)} ·{' '}
                              </span>
                            )}
                            {inv.totals.shippingFee > 0 && (
                              <span>
                                Ship {formatVND(inv.totals.shippingFee)} ·{' '}
                              </span>
                            )}
                            <span>Cọc {formatVND(inv.totals.depositAmount)}</span>
                          </div>
                        </td>

                        <td
                          className="py-3 px-3 align-top text-right num-clean"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {settled ? (
                            <div>
                              <div className="font-extrabold text-emerald-700 text-base">
                                0đ
                              </div>
                              <div className="text-[11px] font-semibold text-emerald-700 mt-0.5">
                                Đã tất toán{' '}
                                {inv.totals.remainingAmount > 0
                                  ? paidDateVN
                                  : 'đợt 1'}
                              </div>
                              {inv.totals.remainingAmount > 0 && (
                                <div className="text-[11px] text-slate-500 mt-0.5">
                                  Đợt 2: {formatVND(inv.totals.remainingAmount)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="font-extrabold text-slate-900 text-base">
                              {formatVND(uncollected)}
                            </div>
                          )}

                          {showStage2Control && (
                            <div className="mt-1.5 pt-1.5 border-t border-slate-100 flex flex-col items-end gap-1">
                              <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 cursor-pointer select-none whitespace-nowrap">
                                <input
                                  type="checkbox"
                                  checked={settled}
                                  onChange={(e) =>
                                    handleToggleRemainingPaid(
                                      inv,
                                      e.target.checked
                                    )
                                  }
                                  className="w-3.5 h-3.5 rounded border-slate-300 accent-emerald-600 cursor-pointer shrink-0"
                                />
                                <span>Đã thu phần còn lại</span>
                              </label>
                              <input
                                type="date"
                                aria-label={`Ngày thu phần còn lại cho ${inv.code}`}
                                value={getEffectivePaidDate(inv)}
                                onChange={(e) =>
                                  handleChangeRemainingPaidDate(
                                    inv,
                                    e.target.value
                                  )
                                }
                                className="h-7 px-1.5 text-[11px] font-semibold text-slate-800 bg-slate-50 hover:bg-white border border-slate-200 rounded focus:outline-none focus:border-[#4887EE] cursor-pointer num-clean"
                              />
                            </div>
                          )}
                        </td>

                        {/* Cột PHÂN LOẠI (kế bên THAO TÁC) + Nút Lưu */}
                        <td
                          className="py-3 px-3 align-top"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1.5">
                            <select
                              aria-label={`Phân loại báo cáo cho ${inv.code}`}
                              value={getSelectedStageForInvoice(inv)}
                              onChange={(e) =>
                                setDraftStages((prev) => ({
                                  ...prev,
                                  [inv.id]: e.target.value as ReportStage,
                                }))
                              }
                              className="h-8 flex-1 min-w-[122px] px-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#4887EE] cursor-pointer"
                            >
                              {REPORT_STAGE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              onClick={() => handleSaveStageClick(inv)}
                              title="Lưu vào tab phân loại đã chọn trong mục Báo cáo"
                              className={`inline-flex items-center justify-center gap-1 h-8 px-2.5 text-xs font-bold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                justSavedStageId === inv.id
                                  ? 'bg-emerald-600 text-white'
                                  : inv.reportStage &&
                                      getSelectedStageForInvoice(inv) ===
                                        inv.reportStage
                                    ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                                    : 'bg-[#4887EE] hover:bg-[#3674DC] text-white'
                              }`}
                            >
                              {justSavedStageId === inv.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 shrink-0" />
                                  <span>Đã lưu</span>
                                </>
                              ) : (
                                <>
                                  <Save className="w-3.5 h-3.5 shrink-0" />
                                  <span>Lưu</span>
                                </>
                              )}
                            </button>
                          </div>

                          <div className="mt-1 flex items-center gap-1.5 text-[11px] leading-tight">
                            {inv.reportStage ? (
                              <>
                                <span className="text-slate-600">
                                  Đang ở:{' '}
                                  <strong className="text-slate-900">
                                    {getReportStageLabel(inv.reportStage)}
                                  </strong>
                                </span>
                                <span
                                  aria-hidden="true"
                                  className="text-slate-300"
                                >
                                  ·
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenReportsTab(
                                      inv.reportStage as ReportStage
                                    )
                                  }
                                  className="font-semibold text-[#3674DC] hover:underline cursor-pointer whitespace-nowrap"
                                >
                                  Mở tab
                                </button>
                              </>
                            ) : (
                              <span className="text-slate-400">
                                Chọn tab & bấm Lưu
                              </span>
                            )}
                          </div>
                        </td>

                        <td
                          className="py-3 px-4 align-top text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {confirmDeleteId === inv.id ? (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteInvoice(inv.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="px-2.5 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Xác nhận xóa
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Hủy
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => onViewInvoice(inv)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <Eye className="w-3.5 h-3.5 shrink-0" />
                                <span>Xem chi tiết</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => onEditInvoice(inv)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <Pencil className="w-3.5 h-3.5 shrink-0" />
                                <span>Chỉnh sửa</span>
                              </button>

                              <button
                                type="button"
                                disabled={busyId === inv.id}
                                onClick={() => void handleCopyClick(inv)}
                                title="Sao chép ảnh hóa đơn ngang"
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                                  copiedId === inv.id
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-[#3674DC] text-white hover:bg-[#2A62C4]'
                                }`}
                              >
                                {copiedId === inv.id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 shrink-0" />
                                    <span>Đã chép</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5 shrink-0" />
                                    <span>Ảnh</span>
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(inv.id)}
                                aria-label="Xóa báo giá"
                                className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

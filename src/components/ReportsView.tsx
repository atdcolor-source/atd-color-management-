import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  Copy,
  Eye,
  FolderOpen,
  Link2,
  Pencil,
  Plus,
  Save,
  Search,
  X,
} from 'lucide-react';
import {
  getReportStageLabel,
  REPORT_STAGE_OPTIONS,
} from '../constants/reportStages';
import {
  ReportStage,
  ReportSubView,
  RevenueEntry,
  SavedInvoice,
} from '../types';
import {
  formatDateTimeVN,
  formatISODateVN,
  formatVND,
  getLocalISODate,
} from '../utils/formatters';
import {
  countDistinctOrdersInEntries,
  getCollectedCashAmount,
  getInvoiceRemainingPaidDate,
  getUncollectedRemainingAmount,
  hasCollectibleRemainingBalance,
  isInvoiceRemainingSettled,
  sanitizeOptionalOrderDate,
} from '../utils/revenueSplit';
import { MonthlyRevenueSection } from './MonthlyRevenueSection';

export type ReportStageFilter = ReportStage | 'all';
type DateRangeFilter = 'all' | 'today' | '7d' | 'month';

interface ReportsViewProps {
  activeSubView: ReportSubView;
  onSelectSubView: (view: ReportSubView) => void;
  revenueEntries: RevenueEntry[];
  onAddManualRevenueEntry: (draft: {
    orderDate: string;
    customerName: string;
    customerPhone: string;
    invoiceCode: string;
    designAmount: number;
    printAmount: number;
    note: string;
  }) => void;
  onUpdateRevenueEntry: (updated: RevenueEntry) => void;
  onDeleteRevenueEntry: (entry: RevenueEntry) => void;
  onRestoreRevenueEntry: (entry: RevenueEntry) => void;
  invoices: SavedInvoice[];
  activeStage: ReportStageFilter;
  onSelectStage: (stage: ReportStageFilter) => void;
  activeEditingId: string | null;
  isLoadingCloud: boolean;
  onSaveInvoiceStage: (
    invoice: SavedInvoice,
    stage: ReportStage | '',
    paymentPatch?: { remainingPaid?: boolean; remainingPaidAt?: string }
  ) => void;
  onViewInvoice: (invoice: SavedInvoice) => void;
  onEditInvoice: (invoice: SavedInvoice) => void;
  onCopySavedInvoiceImage: (invoice: SavedInvoice) => Promise<void>;
  onOpenSavedTab: () => void;
  onCreateNewInvoice: () => void;
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
    textarea.className = 'fixed opacity-0 pointer-events-none';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function matchesDateFilter(isoDateStr: string, filter: DateRangeFilter): boolean {
  if (filter === 'all') return true;
  const d = new Date(isoDateStr);
  if (Number.isNaN(d.getTime())) return true;
  const now = new Date();

  if (filter === 'today') {
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }
  if (filter === '7d') {
    const sevenDaysAgo = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 6
    );
    return d.getTime() >= sevenDaysAgo.getTime();
  }
  if (filter === 'month') {
    return (
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    );
  }
  return true;
}

export function ReportsView({
  activeSubView,
  onSelectSubView,
  revenueEntries,
  onAddManualRevenueEntry,
  onUpdateRevenueEntry,
  onDeleteRevenueEntry,
  onRestoreRevenueEntry,
  invoices,
  activeStage,
  onSelectStage,
  activeEditingId,
  isLoadingCloud,
  onSaveInvoiceStage,
  onViewInvoice,
  onEditInvoice,
  onCopySavedInvoiceImage,
  onOpenSavedTab,
  onCreateNewInvoice,
}: ReportsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<DateRangeFilter>('all');
  const [draftStages, setDraftStages] = useState<Record<string, ReportStage>>(
    {}
  );
  const [draftPaidDates, setDraftPaidDates] = useState<Record<string, string>>(
    {}
  );
  const [justSavedId, setJustSavedId] = useState<string | null>(null);
  const [movedNotice, setMovedNotice] = useState<{
    code: string;
    customerName: string;
    targetStage: ReportStage;
  } | null>(null);
  const [confirmUnclassifyId, setConfirmUnclassifyId] = useState<string | null>(
    null
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedReportLink, setCopiedReportLink] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const savedTimerRef = useRef<number | null>(null);
  const movedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
      if (movedTimerRef.current !== null) {
        window.clearTimeout(movedTimerRef.current);
      }
    };
  }, []);

  const classifiedInvoices = useMemo(
    () => invoices.filter((inv) => Boolean(inv.reportStage)),
    [invoices]
  );

  const stageCounts = useMemo(() => {
    const counts: Record<ReportStage, number> = {
      bao_gia: 0,
      cham_soc: 0,
      coc: 0,
      chot_in: 0,
      chot_thiet_ke: 0,
      hoan_thanh: 0,
    };
    for (const inv of classifiedInvoices) {
      if (inv.reportStage && inv.reportStage in counts) {
        counts[inv.reportStage as ReportStage] += 1;
      }
    }
    return counts;
  }, [classifiedInvoices]);

  const unclassifiedCount = invoices.length - classifiedInvoices.length;

  const filteredInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return classifiedInvoices.filter((inv) => {
      if (activeStage !== 'all' && inv.reportStage !== activeStage) {
        return false;
      }
      if (!matchesDateFilter(inv.createdAt, dateFilter)) {
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
      return inCode || inName || inCustCode || inPhone || inItems;
    });
  }, [classifiedInvoices, activeStage, dateFilter, searchQuery]);

  const summary = useMemo(() => {
    let subtotal = 0;
    let netOrderTotal = 0;
    let depositTotal = 0;
    let collectedTotal = 0;
    let uncollectedRemainingTotal = 0;
    let uncollectedCount = 0;
    let totalQuantity = 0;

    for (const inv of filteredInvoices) {
      subtotal += inv.totals.subtotal;
      const netVal = Math.max(
        0,
        inv.totals.subtotal - inv.totals.discountAmount + inv.totals.shippingFee
      );
      netOrderTotal += netVal;
      depositTotal += inv.totals.depositAmount;
      collectedTotal += getCollectedCashAmount(inv);
      const uncollected = getUncollectedRemainingAmount(inv);
      uncollectedRemainingTotal += uncollected;
      if (uncollected > 0) {
        uncollectedCount += 1;
      }
      totalQuantity += inv.totals.totalQuantity;
    }

    return {
      orderCount: filteredInvoices.length,
      totalQuantity,
      subtotal,
      netOrderTotal,
      depositTotal,
      collectedTotal,
      collectedStage2Total: Math.max(0, collectedTotal - depositTotal),
      uncollectedRemainingTotal,
      uncollectedCount,
    };
  }, [filteredInvoices]);

  const activeStageLabel =
    activeStage === 'all'
      ? 'Tất cả phân loại'
      : getReportStageLabel(activeStage);

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

  const flashSavedAndMaybeNotifyMove = (
    inv: SavedInvoice,
    previousStage: string,
    targetStage: ReportStage
  ) => {
    setJustSavedId(inv.id);
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = window.setTimeout(() => {
      setJustSavedId((curr) => (curr === inv.id ? null : curr));
      savedTimerRef.current = null;
    }, 2400);

    if (
      activeStage !== 'all' &&
      targetStage !== activeStage &&
      previousStage === activeStage
    ) {
      setMovedNotice({
        code: inv.code,
        customerName: inv.customer.name.trim() || 'Khách lẻ',
        targetStage,
      });
      if (movedTimerRef.current !== null) {
        window.clearTimeout(movedTimerRef.current);
      }
      movedTimerRef.current = window.setTimeout(() => {
        setMovedNotice(null);
        movedTimerRef.current = null;
      }, 4500);
    }
  };

  const handleSaveStageClick = (inv: SavedInvoice) => {
    const chosenStage = getSelectedStageForInvoice(inv);
    const previousStage = inv.reportStage || '';
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

    flashSavedAndMaybeNotifyMove(inv, previousStage, chosenStage);
  };

  const handleToggleRemainingPaid = (inv: SavedInvoice, checked: boolean) => {
    const previousStage = inv.reportStage || '';
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

    flashSavedAndMaybeNotifyMove(inv, previousStage, nextStage);
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
      const previousStage = inv.reportStage || '';
      onSaveInvoiceStage(inv, 'hoan_thanh', {
        remainingPaid: true,
        remainingPaidAt: clean,
      });
      flashSavedAndMaybeNotifyMove(inv, previousStage, 'hoan_thanh');
    }
  };

  const handleCopyReportLink = async () => {
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const stageQuery =
      activeStage !== 'all' ? `&stage=${encodeURIComponent(activeStage)}` : '';
    const shareUrl = `${baseUrl}?tab=reports&view=pipeline${stageQuery}`;
    await copyTextSafe(shareUrl);
    setCopiedReportLink(true);
    window.setTimeout(() => setCopiedReportLink(false), 2400);
  };

  const handleCopyInvoiceClick = async (invoice: SavedInvoice) => {
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

  const invoicesById = useMemo(() => {
    const map = new Map<string, SavedInvoice>();
    for (const inv of invoices) {
      map.set(inv.id, inv);
    }
    return map;
  }, [invoices]);

  const activeRevenueCount = useMemo(
    () => countDistinctOrdersInEntries(revenueEntries),
    [revenueEntries]
  );

  return (
    <div className="space-y-5">
      {/* Top Sub-Section Switcher inside Báo cáo */}
      <div className="bg-white border border-slate-200 rounded-xl p-2 flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Chọn chế độ xem trong mục Báo cáo"
          className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full"
        >
          <button
            role="tab"
            aria-selected={activeSubView === 'monthly_revenue'}
            type="button"
            onClick={() => onSelectSubView('monthly_revenue')}
            className={`px-4 py-2 text-xs sm:text-sm rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
              activeSubView === 'monthly_revenue'
                ? 'bg-[#4887EE] text-white font-bold shadow-xs'
                : 'text-slate-700 hover:text-slate-900 hover:bg-white/80 font-semibold'
            }`}
          >
            Báo cáo doanh thu các tháng ({activeRevenueCount})
          </button>

          <button
            role="tab"
            aria-selected={activeSubView === 'pipeline'}
            type="button"
            onClick={() => onSelectSubView('pipeline')}
            className={`px-4 py-2 text-xs sm:text-sm rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
              activeSubView === 'pipeline'
                ? 'bg-[#4887EE] text-white font-bold shadow-xs'
                : 'text-slate-700 hover:text-slate-900 hover:bg-white/80 font-semibold'
            }`}
          >
            Tiến độ & Phân loại khách hàng ({classifiedInvoices.length})
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenSavedTab}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean"
        >
          <FolderOpen className="w-3.5 h-3.5 shrink-0" />
          <span>
            Báo giá đã lưu{invoices.length > 0 ? ` (${invoices.length})` : ''}
          </span>
        </button>
      </div>

      {activeSubView === 'monthly_revenue' ? (
        <MonthlyRevenueSection
          entries={revenueEntries}
          invoicesById={invoicesById}
          isLoadingCloud={isLoadingCloud}
          onAddManualEntry={onAddManualRevenueEntry}
          onUpdateEntry={onUpdateRevenueEntry}
          onDeleteEntry={onDeleteRevenueEntry}
          onRestoreEntry={onRestoreRevenueEntry}
          onViewLinkedInvoice={onViewInvoice}
          onOpenSavedTab={onOpenSavedTab}
        />
      ) : (
        <>
          {/* Header & Filter Tabs ("Tab bộ lọc") */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-slate-900">
                  Báo cáo tiến độ & phân loại khách hàng
                </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5 num-clean">
              Liên kết trực tiếp với Báo giá đã lưu · {classifiedInvoices.length}{' '}
              đơn đã phân loại
              {unclassifiedCount > 0
                ? ` · Còn ${unclassifiedCount} báo giá chưa phân loại`
                : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopyReportLink()}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                copiedReportLink
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-blue-50 hover:bg-blue-100 text-[#3674DC] border-blue-200'
              }`}
            >
              {copiedReportLink ? (
                <>
                  <Check className="w-4 h-4 shrink-0" />
                  <span>Đã sao chép link!</span>
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4 shrink-0" />
                  <span>Sao chép link báo cáo</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onOpenSavedTab}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean"
            >
              <FolderOpen className="w-4 h-4 shrink-0" />
              <span>
                Báo giá đã lưu{invoices.length > 0 ? ` (${invoices.length})` : ''}
              </span>
            </button>
          </div>
        </div>

        {/* 5 Filter Tabs ("Tab bộ lọc: Báo giá · Chăm sóc · Chốt in · Chốt thiết kế · Hoàn thành") + Tất cả */}
        <div
          role="tablist"
          aria-label="Bộ lọc phân loại báo cáo"
          className="flex items-center gap-1.5 p-1.5 bg-slate-100 rounded-xl overflow-x-auto"
        >
          {REPORT_STAGE_OPTIONS.map((opt) => {
            const isActive = activeStage === opt.value;
            const count = stageCounts[opt.value];
            return (
              <button
                key={opt.value}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => onSelectStage(opt.value)}
                className={`px-3.5 py-2 text-xs sm:text-sm rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                  isActive
                    ? 'bg-[#4887EE] text-white font-bold shadow-xs'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-white/80 font-semibold'
                }`}
              >
                {opt.label} ({count})
              </button>
            );
          })}

          <button
            role="tab"
            aria-selected={activeStage === 'all'}
            type="button"
            onClick={() => onSelectStage('all')}
            className={`px-3.5 py-2 text-xs sm:text-sm rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
              activeStage === 'all'
                ? 'bg-[#4887EE] text-white font-bold shadow-xs'
                : 'text-slate-700 hover:text-slate-900 hover:bg-white/80 font-semibold'
            }`}
          >
            Tất cả ({classifiedInvoices.length})
          </button>
        </div>

        {/* Search & Date Range Filter */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-0.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Tìm khách hàng, SĐT, mã đơn hoặc sản phẩm trong mục "${activeStageLabel}"...`}
              className="w-full h-10 pl-9 pr-3 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-900"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto overflow-x-auto max-w-full">
            {(
              [
                { id: 'all', label: 'Tất cả ngày' },
                { id: 'today', label: 'Hôm nay' },
                { id: '7d', label: '7 ngày qua' },
                { id: 'month', label: 'Tháng này' },
              ] as { id: DateRangeFilter; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setDateFilter(opt.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  dateFilter === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Real Quantitative Summary Strip for Active Filter Tab */}
      <div className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 num-clean">
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Số đơn mục {activeStageLabel}
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
            {summary.orderCount} đơn
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Tổng SL: {summary.totalQuantity} sản phẩm
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Tổng giá trị đơn hàng
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
            {formatVND(summary.netOrderTotal)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Tạm tính hàng: {formatVND(summary.subtotal)}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Tổng tiền khách đã thu
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-[#3674DC] mt-1">
            {formatVND(summary.collectedTotal)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Cọc đợt 1: {formatVND(summary.depositTotal)}
            {summary.collectedStage2Total > 0
              ? ` · Thu đợt 2: ${formatVND(summary.collectedStage2Total)}`
              : ''}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Tổng còn phải thu
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
            {formatVND(summary.uncollectedRemainingTotal)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {summary.uncollectedCount} đơn còn chờ thu phần còn lại
          </div>
        </div>
      </div>

      {/* Stage Transition Confirmation Notice */}
      {movedNotice && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs sm:text-sm text-emerald-900 num-clean">
          <span>
            Đã lưu và chuyển đơn <strong>{movedNotice.code}</strong> (
            {movedNotice.customerName}) sang tab{' '}
            <strong>{getReportStageLabel(movedNotice.targetStage)}</strong>.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onSelectStage(movedNotice.targetStage);
                setMovedNotice(null);
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>
                Xem tab {getReportStageLabel(movedNotice.targetStage)}
              </span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>
            <button
              type="button"
              onClick={() => setMovedNotice(null)}
              aria-label="Đóng thông báo"
              className="p-1 text-emerald-700 hover:text-emerald-950 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Loading / Empty / Populated Data Views */}
      {isLoadingCloud && invoices.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="h-12 bg-slate-100 rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-12 px-6 text-center">
          <BarChart3 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          {searchQuery.trim() || dateFilter !== 'all' ? (
            <>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Không tìm thấy đơn nào khớp bộ lọc trong mục &ldquo;
                {activeStageLabel}&rdquo;
              </h2>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setDateFilter('all');
                }}
                className="mt-3 text-xs font-semibold text-[#3674DC] hover:underline cursor-pointer"
              >
                Xóa từ khóa & bộ lọc ngày
              </button>
            </>
          ) : (
            <>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Chưa có khách hàng nào trong tab &ldquo;{activeStageLabel}&rdquo;
              </h2>
              <p className="text-sm text-slate-500 mt-1 max-w-lg mx-auto">
                Tại mục <strong>Báo giá đã lưu</strong>, mỗi khách hàng đều có ô{' '}
                <strong>Phân loại</strong> (kế bên chỗ Thao tác). Chọn{' '}
                <strong>
                  {activeStage === 'all' ? 'tab cần lưu' : activeStageLabel}
                </strong>{' '}
                rồi bấm <strong>Lưu</strong> để đơn tự động chạy vào đây.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                {invoices.length > 0 ? (
                  <button
                    type="button"
                    onClick={onOpenSavedTab}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean"
                  >
                    <FolderOpen className="w-4 h-4 shrink-0" />
                    <span>Mở Báo giá đã lưu ({invoices.length})</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onCreateNewInvoice}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span>Tạo báo giá mới</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Mobile Phone Card List (< md) */}
          <div className="md:hidden space-y-3">
            {filteredInvoices.map((inv) => {
              const isEditingThis = activeEditingThisId(activeEditingId, inv.id);
              const demoVN = formatISODateVN(inv.expectedDemoDate);
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
                        <span className="font-semibold text-[#3674DC]">
                          {getReportStageLabel(inv.reportStage)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 num-clean space-y-0.5">
                        <div>Tạo: {formatDateTimeVN(inv.createdAt)}</div>
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

                    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/80 rounded-lg p-2">
                      <span className="text-xs font-bold text-slate-700 shrink-0">
                        Phân loại:
                      </span>
                      <select
                        aria-label={`Đổi phân loại cho ${inv.code}`}
                        value={getSelectedStageForInvoice(inv)}
                        onChange={(e) =>
                          setDraftStages((prev) => ({
                            ...prev,
                            [inv.id]: e.target.value as ReportStage,
                          }))
                        }
                        className="h-8 flex-1 min-w-0 px-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#4887EE] cursor-pointer"
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
                        className={`inline-flex items-center justify-center gap-1 h-8 px-3 text-xs font-bold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          justSavedId === inv.id
                            ? 'bg-emerald-600 text-white'
                            : getSelectedStageForInvoice(inv) === inv.reportStage
                              ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-[#4887EE] hover:bg-[#3674DC] text-white'
                        }`}
                      >
                        {justSavedId === inv.id ? (
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

                    {confirmUnclassifyId === inv.id ? (
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className="text-xs font-semibold text-slate-700">
                          Gỡ khỏi Báo cáo (vẫn giữ đơn đã lưu)?
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              onSaveInvoiceStage(inv, '');
                              setConfirmUnclassifyId(null);
                            }}
                            className="px-2.5 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md cursor-pointer whitespace-nowrap"
                          >
                            Gỡ
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmUnclassifyId(null)}
                            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer whitespace-nowrap"
                          >
                            Hủy
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2">
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
                            onClick={() => void handleCopyInvoiceClick(inv)}
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
                          onClick={() => setConfirmUnclassifyId(inv.id)}
                          title="Gỡ khỏi Báo cáo (vẫn giữ nguyên trong Báo giá đã lưu)"
                          aria-label="Gỡ khỏi Báo cáo"
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Reports Table (md+) */}
          <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[1080px]">
                <thead>
                  <tr className="bg-[#4887EE] text-white text-xs font-bold">
                    <th className="py-3 px-4 w-48">MÃ ĐƠN & THỜI GIAN</th>
                    <th className="py-3 px-3 w-48">KHÁCH HÀNG</th>
                    <th className="py-3 px-3">SẢN PHẨM ĐÃ CHỌN</th>
                    <th className="py-3 px-3 text-right w-36">TỔNG / SHIP / CỌC</th>
                    <th className="py-3 px-3 text-right w-48">CÒN LẠI & ĐỢT 2</th>
                    <th className="py-3 px-3 w-56">PHÂN LOẠI</th>
                    <th className="py-3 px-4 text-right w-60">THAO TÁC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {filteredInvoices.map((inv, idx) => {
                    const isEditingThis = activeEditingThisId(
                      activeEditingId,
                      inv.id
                    );
                    const demoVN = formatISODateVN(inv.expectedDemoDate);
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
                          <div className="font-bold text-slate-900 num-clean">
                            {inv.code}
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5 num-clean">
                            Tạo: {formatDateTimeVN(inv.createdAt)}
                          </div>
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
                              aria-label={`Đổi phân loại cho ${inv.code}`}
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
                              title="Lưu để chuyển sang tab phân loại đã chọn"
                              className={`inline-flex items-center justify-center gap-1 h-8 px-2.5 text-xs font-bold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                justSavedId === inv.id
                                  ? 'bg-emerald-600 text-white'
                                  : getSelectedStageForInvoice(inv) ===
                                      inv.reportStage
                                    ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                                    : 'bg-[#4887EE] hover:bg-[#3674DC] text-white'
                              }`}
                            >
                              {justSavedId === inv.id ? (
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

                          <div className="mt-1 text-[11px] text-slate-500">
                            Tab hiện tại:{' '}
                            <strong className="text-slate-800">
                              {getReportStageLabel(inv.reportStage)}
                            </strong>
                          </div>
                        </td>

                        <td
                          className="py-3 px-4 align-top text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {confirmUnclassifyId === inv.id ? (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  onSaveInvoiceStage(inv, '');
                                  setConfirmUnclassifyId(null);
                                }}
                                className="px-2.5 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Gỡ khỏi báo cáo
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmUnclassifyId(null)}
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
                                onClick={() => void handleCopyInvoiceClick(inv)}
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
                                onClick={() => setConfirmUnclassifyId(inv.id)}
                                title="Gỡ khỏi Báo cáo (vẫn giữ nguyên ở Báo giá đã lưu)"
                                aria-label="Gỡ khỏi Báo cáo"
                                className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md cursor-pointer"
                              >
                                <X className="w-4 h-4" />
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
        </>
      )}
    </div>
  );
}

function activeEditingThisId(
  activeEditingId: string | null,
  invoiceId: string
): boolean {
  return Boolean(activeEditingId && activeEditingId === invoiceId);
}

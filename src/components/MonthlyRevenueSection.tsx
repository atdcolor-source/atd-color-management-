import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { RevenueEntry, SavedInvoice } from '../types';
import {
  formatISODateVN,
  formatVND,
  getLocalISODate,
} from '../utils/formatters';
import {
  clampRevenuePart,
  countDistinctCustomersInEntries,
  countDistinctOrdersInEntries,
  getCurrentMonthKeyLocal,
  getInvoiceRemainingPaidDate,
  getMonthDateRangeVN,
  getRevenueEntryPaymentBadge,
  getUncollectedRemainingAmount,
  isInvoiceRemainingSettled,
  isRemainingStageRevenueEntry,
  normalizeOrderDateString,
  shiftMonthKey,
  stripStagePrefixFromRevenueNote,
} from '../utils/revenueSplit';
import { MoneyInput } from './MoneyInput';

interface MonthlyRevenueSectionProps {
  entries: RevenueEntry[];
  invoicesById: Map<string, SavedInvoice>;
  isLoadingCloud: boolean;
  onAddManualEntry: (draft: {
    orderDate: string;
    customerName: string;
    customerPhone: string;
    invoiceCode: string;
    designAmount: number;
    printAmount: number;
    note: string;
  }) => void;
  onUpdateEntry: (updated: RevenueEntry) => void;
  onDeleteEntry: (entry: RevenueEntry) => void;
  onRestoreEntry: (entry: RevenueEntry) => void;
  onViewLinkedInvoice: (invoice: SavedInvoice) => void;
  onOpenSavedTab: () => void;
}

interface MonthAggregateRow {
  monthKey: string;
  monthLabel: string;
  rangeVN: string;
  customerCount: number;
  orderCount: number;
  entryCount: number;
  designAmount: number;
  printAmount: number;
  totalRevenue: number;
}

export function MonthlyRevenueSection({
  entries,
  invoicesById,
  isLoadingCloud,
  onAddManualEntry,
  onUpdateEntry,
  onDeleteEntry,
  onRestoreEntry,
  onViewLinkedInvoice,
  onOpenSavedTab,
}: MonthlyRevenueSectionProps) {
  const currentMonthKey = useMemo(() => getCurrentMonthKeyLocal(), []);
  const [selectedMonthKey, setSelectedMonthKey] =
    useState<string>(currentMonthKey);
  const [reportDisplayDateISO, setReportDisplayDateISO] = useState<string>(() =>
    getLocalISODate(0)
  );
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Manual add form state
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [newOrderDate, setNewOrderDate] = useState<string>(() =>
    getLocalISODate(0)
  );
  const [newCustomerName, setNewCustomerName] = useState<string>('');
  const [newCustomerPhone, setNewCustomerPhone] = useState<string>('');
  const [newInvoiceCode, setNewInvoiceCode] = useState<string>('');
  const [newDesignAmount, setNewDesignAmount] = useState<number>(0);
  const [newPrintAmount, setNewPrintAmount] = useState<number>(0);
  const [newNote, setNewNote] = useState<string>('');
  const [addFormError, setAddFormError] = useState<string | null>(null);

  // Inline row edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editOrderDate, setEditOrderDate] = useState<string>('');
  const [editCustomerName, setEditCustomerName] = useState<string>('');
  const [editCustomerPhone, setEditCustomerPhone] = useState<string>('');
  const [editInvoiceCode, setEditInvoiceCode] = useState<string>('');
  const [editDesignAmount, setEditDesignAmount] = useState<number>(0);
  const [editPrintAmount, setEditPrintAmount] = useState<number>(0);
  const [editNote, setEditNote] = useState<string>('');

  // 2-step staff-initiated delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showDeletedList, setShowDeletedList] = useState<boolean>(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const activeEntries = useMemo(
    () => entries.filter((e) => !e.isDeleted),
    [entries]
  );

  const deletedEntriesInSelectedMonth = useMemo(
    () =>
      entries.filter((e) => e.isDeleted && e.monthKey === selectedMonthKey),
    [entries, selectedMonthKey]
  );

  // Build permanent multi-month overview table (always includes selectedMonthKey + currentMonthKey + all stored months)
  const monthlyRows = useMemo<MonthAggregateRow[]>(() => {
    const grouped = new Map<string, RevenueEntry[]>();
    grouped.set(currentMonthKey, []);
    grouped.set(selectedMonthKey, []);

    for (const entry of activeEntries) {
      const list = grouped.get(entry.monthKey);
      if (list) {
        list.push(entry);
      } else {
        grouped.set(entry.monthKey, [entry]);
      }
    }

    const sortedKeys = Array.from(grouped.keys()).sort((a, b) =>
      b.localeCompare(a)
    );

    return sortedKeys.map((mk) => {
      const list = grouped.get(mk) || [];
      const range = getMonthDateRangeVN(mk);
      let designAmount = 0;
      let printAmount = 0;
      for (const item of list) {
        designAmount += item.designAmount;
        printAmount += item.printAmount;
      }
      return {
        monthKey: mk,
        monthLabel: range.monthLabel,
        rangeVN: range.rangeVN,
        customerCount: countDistinctCustomersInEntries(list),
        orderCount: countDistinctOrdersInEntries(list),
        entryCount: list.length,
        designAmount,
        printAmount,
        totalRevenue: designAmount + printAmount,
      };
    });
  }, [activeEntries, currentMonthKey, selectedMonthKey]);

  const allTimeTotals = useMemo(() => {
    let designAmount = 0;
    let printAmount = 0;
    for (const e of activeEntries) {
      designAmount += e.designAmount;
      printAmount += e.printAmount;
    }
    return {
      customerCount: countDistinctCustomersInEntries(activeEntries),
      orderCount: countDistinctOrdersInEntries(activeEntries),
      entryCount: activeEntries.length,
      designAmount,
      printAmount,
      totalRevenue: designAmount + printAmount,
    };
  }, [activeEntries]);

  const selectedMonthRange = useMemo(
    () => getMonthDateRangeVN(selectedMonthKey),
    [selectedMonthKey]
  );

  const entriesInSelectedMonth = useMemo(
    () => activeEntries.filter((e) => e.monthKey === selectedMonthKey),
    [activeEntries, selectedMonthKey]
  );

  const selectedMonthStats = useMemo(() => {
    let designAmount = 0;
    let printAmount = 0;
    for (const e of entriesInSelectedMonth) {
      designAmount += e.designAmount;
      printAmount += e.printAmount;
    }
    const totalRevenue = designAmount + printAmount;
    const designPct =
      totalRevenue > 0 ? Math.round((designAmount * 100) / totalRevenue) : 0;
    const printPct = totalRevenue > 0 ? 100 - designPct : 0;
    return {
      customerCount: countDistinctCustomersInEntries(entriesInSelectedMonth),
      orderCount: countDistinctOrdersInEntries(entriesInSelectedMonth),
      entryCount: entriesInSelectedMonth.length,
      designAmount,
      printAmount,
      totalRevenue,
      designPct,
      printPct,
    };
  }, [entriesInSelectedMonth]);

  const filteredMonthEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entriesInSelectedMonth;
    return entriesInSelectedMonth.filter((e) => {
      return (
        e.customerName.toLowerCase().includes(q) ||
        e.customerPhone.toLowerCase().includes(q) ||
        e.customerCode.toLowerCase().includes(q) ||
        e.invoiceCode.toLowerCase().includes(q) ||
        e.note.toLowerCase().includes(q) ||
        formatISODateVN(e.orderDate).includes(q)
      );
    });
  }, [entriesInSelectedMonth, searchQuery]);

  const flashNotice = (msg: string) => {
    setSavedNotice(msg);
    window.setTimeout(() => {
      setSavedNotice((curr) => (curr === msg ? null : curr));
    }, 3200);
  };

  const handleOpenAddForm = () => {
    const defaultDate =
      selectedMonthKey === currentMonthKey
        ? getLocalISODate(0)
        : `${selectedMonthKey}-01`;
    setNewOrderDate(defaultDate);
    setNewCustomerName('');
    setNewCustomerPhone('');
    setNewInvoiceCode('');
    setNewDesignAmount(0);
    setNewPrintAmount(0);
    setNewNote('');
    setAddFormError(null);
    setShowAddForm(true);
  };

  const handleSubmitNewEntry = (e: React.FormEvent) => {
    e.preventDefault();
    const safeDesign = clampRevenuePart(newDesignAmount);
    const safePrint = clampRevenuePart(newPrintAmount);
    if (safeDesign + safePrint <= 0) {
      setAddFormError(
        'Vui lòng nhập Tiền thiết kế hoặc Tiền in lớn hơn 0đ để ghi nhận doanh thu.'
      );
      return;
    }
    const normalizedDate = normalizeOrderDateString(newOrderDate);
    onAddManualEntry({
      orderDate: normalizedDate,
      customerName: newCustomerName.trim() || 'Khách lẻ',
      customerPhone: newCustomerPhone.trim(),
      invoiceCode: newInvoiceCode.trim(),
      designAmount: safeDesign,
      printAmount: safePrint,
      note: newNote.trim(),
    });
    setSelectedMonthKey(normalizedDate.slice(0, 7));
    setShowAddForm(false);
    setAddFormError(null);
    flashNotice('Đã lưu vĩnh viễn khoản doanh thu mới vào báo cáo tháng.');
  };

  const startEditingEntry = (entry: RevenueEntry) => {
    setEditingId(entry.id);
    setConfirmDeleteId(null);
    setEditOrderDate(entry.orderDate);
    setEditCustomerName(entry.customerName);
    setEditCustomerPhone(entry.customerPhone);
    setEditInvoiceCode(entry.invoiceCode);
    setEditDesignAmount(entry.designAmount);
    setEditPrintAmount(entry.printAmount);
    setEditNote(entry.note);
  };

  const cancelEditingEntry = () => {
    setEditingId(null);
  };

  const saveEditedEntry = (entry: RevenueEntry) => {
    const safeOrderDate = normalizeOrderDateString(
      editOrderDate,
      entry.orderDate
    );
    const safeDesign = clampRevenuePart(editDesignAmount);
    const safePrint = clampRevenuePart(editPrintAmount);
    const updated: RevenueEntry = {
      ...entry,
      orderDate: safeOrderDate,
      monthKey: safeOrderDate.slice(0, 7),
      customerName: editCustomerName.trim().slice(0, 120) || 'Khách lẻ',
      customerPhone: editCustomerPhone.trim().slice(0, 30),
      invoiceCode: editInvoiceCode.trim().slice(0, 40),
      designAmount: safeDesign,
      printAmount: safePrint,
      totalRevenue: safeDesign + safePrint,
      isManualOverride: true,
      note: editNote.trim().slice(0, 500),
      updatedAt: new Date().toISOString(),
    };
    onUpdateEntry(updated);
    setSelectedMonthKey(updated.monthKey);
    setEditingId(null);
    flashNotice(
      `Đã cập nhật và lưu vĩnh viễn doanh thu của "${updated.customerName}".`
    );
  };

  const reportDisplayDateVN =
    formatISODateVN(reportDisplayDateISO) ||
    formatISODateVN(getLocalISODate(0));

  return (
    <div className="space-y-5">
      {/* 1. Reporting Month & Date/Month/Year Display Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">
              Báo cáo doanh thu các tháng — {selectedMonthRange.monthLabel}
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-slate-700 num-clean">
              <span>
                Kỳ ngày/tháng/năm báo cáo:{' '}
                <strong className="text-slate-900">
                  {selectedMonthRange.rangeVN}
                </strong>
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span>
                Ngày/tháng/năm hiển thị:{' '}
                <strong className="text-[#3674DC]">{reportDisplayDateVN}</strong>
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Đợt 1 ghi nhận tiền cọc theo ngày cọc · Đợt 2 ghi nhận phần còn
              lại đúng vào ngày/tháng xác nhận Hoàn thành (tích đã thu phần còn
              lại) · Hệ thống lưu trữ vĩnh viễn, không tự động xóa.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleOpenAddForm}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Thêm doanh thu thủ công</span>
            </button>
          </div>
        </div>

        {/* Month Navigation + Display Date Control */}
        <div className="pt-3 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">
              Chọn tháng xem:
            </span>
            <div className="inline-flex items-center bg-slate-100 rounded-lg p-1 gap-1">
              <button
                type="button"
                onClick={() =>
                  setSelectedMonthKey((prev) => shiftMonthKey(prev, -1))
                }
                aria-label="Tháng trước"
                className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-md transition-colors cursor-pointer shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <input
                type="month"
                aria-label="Chọn tháng năm báo cáo"
                value={selectedMonthKey}
                onChange={(e) => {
                  if (/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) {
                    setSelectedMonthKey(e.target.value);
                  }
                }}
                className="h-8 px-2.5 text-xs sm:text-sm font-bold text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-[#4887EE] num-clean cursor-pointer"
              />

              <button
                type="button"
                onClick={() =>
                  setSelectedMonthKey((prev) => shiftMonthKey(prev, 1))
                }
                aria-label="Tháng sau"
                className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-md transition-colors cursor-pointer shrink-0"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {selectedMonthKey !== currentMonthKey && (
              <button
                type="button"
                onClick={() => setSelectedMonthKey(currentMonthKey)}
                className="px-3 py-1.5 text-xs font-semibold text-[#3674DC] bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Về tháng hiện tại
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="report-display-date-input"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 whitespace-nowrap"
            >
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>Ngày/tháng/năm hiển thị:</span>
            </label>
            <input
              id="report-display-date-input"
              type="date"
              value={reportDisplayDateISO}
              onChange={(e) => {
                if (e.target.value) {
                  setReportDisplayDateISO(e.target.value);
                }
              }}
              className="h-8 px-2.5 text-xs font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-[#4887EE] num-clean cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Inline Add Manual Revenue Entry Form */}
      {showAddForm && (
        <form
          onSubmit={handleSubmitNewEntry}
          className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Thêm khoản doanh thu thủ công (Lưu vĩnh viễn)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Dùng khi cần bổ sung đơn lẻ hoặc doanh thu tháng cũ chưa tạo
                báo giá trên hệ thống.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              aria-label="Đóng biểu mẫu"
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Ngày / Tháng / Năm
              </label>
              <input
                type="date"
                required
                value={newOrderDate}
                onChange={(e) => setNewOrderDate(e.target.value)}
                className="w-full h-9 px-2.5 text-sm font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-[#4887EE] num-clean"
              />
            </div>

            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tên khách hàng
              </label>
              <input
                type="text"
                maxLength={120}
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                placeholder="VD: Chị Lan Quán Trà Sữa"
                className="w-full h-9 px-3 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-[#4887EE]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Số điện thoại
              </label>
              <input
                type="text"
                maxLength={30}
                value={newCustomerPhone}
                onChange={(e) => setNewCustomerPhone(e.target.value)}
                placeholder="09xx..."
                className="w-full h-9 px-3 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-[#4887EE] num-clean"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tiền thiết kế
              </label>
              <MoneyInput
                value={newDesignAmount}
                onChange={setNewDesignAmount}
                placeholder="0"
                ariaLabel="Tiền thiết kế"
                className="w-full h-9 bg-slate-50 border border-slate-200 rounded-lg focus-within:bg-white focus-within:border-[#4887EE] text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tiền in
              </label>
              <MoneyInput
                value={newPrintAmount}
                onChange={setNewPrintAmount}
                placeholder="0"
                ariaLabel="Tiền in"
                className="w-full h-9 bg-slate-50 border border-slate-200 rounded-lg focus-within:bg-white focus-within:border-[#4887EE] text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mã đơn (tùy chọn)
              </label>
              <input
                type="text"
                maxLength={40}
                value={newInvoiceCode}
                onChange={(e) => setNewInvoiceCode(e.target.value)}
                placeholder="VD: BG-0099"
                className="w-full h-9 px-3 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-[#4887EE] num-clean"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Ghi chú chi tiết sản phẩm / hạng mục
              </label>
              <input
                type="text"
                maxLength={500}
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="VD: Thiết kế Menu A4 + Ép nhựa 10 tờ"
                className="w-full h-9 px-3 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-[#4887EE]"
              />
            </div>
          </div>

          {addFormError && (
            <p className="text-xs font-semibold text-rose-600">{addFormError}</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <div className="text-xs sm:text-sm text-slate-700 num-clean">
              Tổng cộng ghi nhận:{' '}
              <strong className="text-slate-900 text-base">
                {formatVND(
                  clampRevenuePart(newDesignAmount) +
                    clampRevenuePart(newPrintAmount)
                )}
              </strong>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-xs sm:text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Save className="w-4 h-4 shrink-0" />
                <span>Lưu vào doanh thu tháng</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {savedNotice && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs sm:text-sm text-emerald-900">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{savedNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setSavedNotice(null)}
            aria-label="Đóng thông báo"
            className="p-1 text-emerald-700 hover:text-emerald-950 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. 4-Column Single-Elevation KPI Strip for Selected Month */}
      <div className="bg-white border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 num-clean">
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Số lượng khách hàng đặt hàng
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
            {selectedMonthStats.customerCount} khách hàng
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Từ {selectedMonthStats.orderCount} đơn thành công
            {selectedMonthStats.entryCount > selectedMonthStats.orderCount
              ? ` (${selectedMonthStats.entryCount} đợt thu)`
              : ''}{' '}
            · {selectedMonthRange.monthLabel}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Doanh thu Tiền thiết kế
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-[#3674DC] mt-1">
            {formatVND(selectedMonthStats.designAmount)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Tách từ đơn thành công · Tỷ trọng {selectedMonthStats.designPct}%
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Doanh thu Tiền in
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-emerald-700 mt-1">
            {formatVND(selectedMonthStats.printAmount)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Tách từ đơn thành công · Tỷ trọng {selectedMonthStats.printPct}%
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Tổng doanh thu {selectedMonthRange.monthLabel.toLowerCase()}
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
            {formatVND(selectedMonthStats.totalRevenue)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Kỳ {selectedMonthRange.rangeVN}
          </div>
        </div>
      </div>

      {/* 3. Multi-Month Revenue Overview Table (Stored Permanently Across All Months) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900">
              Bảng tổng hợp doanh thu các tháng (Lưu vĩnh viễn)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 num-clean">
              Bấm vào một tháng bất kỳ để xem chi tiết từng khách hàng và đơn
              thành công của tháng đó · Lũy kế toàn bộ:{' '}
              <strong className="text-slate-800">
                {formatVND(allTimeTotals.totalRevenue)}
              </strong>{' '}
              (Thiết kế {formatVND(allTimeTotals.designAmount)} · In{' '}
              {formatVND(allTimeTotals.printAmount)})
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[760px] num-clean">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
                <th className="py-2.5 px-4">
                  THÁNG BÁO CÁO & NGÀY / THÁNG / NĂM
                </th>
                <th className="py-2.5 px-3 text-right">
                  SỐ LƯỢNG KH ĐẶT HÀNG
                </th>
                <th className="py-2.5 px-3 text-right">TIỀN THIẾT KẾ</th>
                <th className="py-2.5 px-3 text-right">TIỀN IN</th>
                <th className="py-2.5 px-4 text-right">TỔNG DOANH THU</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {monthlyRows.map((row) => {
                const isSelected = row.monthKey === selectedMonthKey;
                return (
                  <tr
                    key={row.monthKey}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedMonthKey(row.monthKey)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedMonthKey(row.monthKey);
                      }
                    }}
                    className={`transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50/70 hover:bg-blue-50'
                        : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span
                          className={`font-bold ${
                            isSelected ? 'text-[#3674DC]' : 'text-slate-900'
                          }`}
                        >
                          {row.monthLabel}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="text-xs text-slate-600">
                          {row.rangeVN}
                        </span>
                        {isSelected && (
                          <>
                            <span
                              aria-hidden="true"
                              className="text-slate-300"
                            >
                              ·
                            </span>
                            <span className="text-xs font-semibold text-[#3674DC]">
                              Đang xem
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span className="font-bold text-slate-900">
                        {row.customerCount} khách
                      </span>
                      <span className="text-xs text-slate-500 ml-1.5">
                        ({row.orderCount} đơn
                        {row.entryCount > row.orderCount
                          ? ` · ${row.entryCount} đợt thu`
                          : ''}
                        )
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-[#3674DC]">
                      {formatVND(row.designAmount)}
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-emerald-700">
                      {formatVND(row.printAmount)}
                    </td>
                    <td className="py-3 px-4 text-right font-extrabold text-slate-900">
                      {formatVND(row.totalRevenue)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Detailed Successful Orders Table for Selected Month */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 num-clean">
              Chi tiết đơn hàng thành công — {selectedMonthRange.monthLabel} (
              {selectedMonthRange.rangeVN})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 num-clean">
              Ngày hiển thị báo cáo: {reportDisplayDateVN} · Nhân viên có thể
              chủ động bấm Sửa hoặc Xóa từng dòng (không bao giờ tự động xóa).
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Tìm khách, SĐT, mã đơn trong ${selectedMonthRange.monthLabel}...`}
              className="w-full h-9 pl-9 pr-3 text-xs sm:text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-900"
            />
          </div>
        </div>

        {isLoadingCloud && activeEntries.length === 0 ? (
          <div className="p-5 space-y-3">
            {[0, 1, 2].map((r) => (
              <div
                key={r}
                className="h-11 bg-slate-100 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : filteredMonthEntries.length === 0 ? (
          <div className="py-12 px-6 text-center">
            {searchQuery.trim() ? (
              <>
                <div className="text-sm sm:text-base font-bold text-slate-900">
                  Không tìm thấy dòng doanh thu nào khớp từ khóa &ldquo;
                  {searchQuery}&rdquo;
                </div>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="mt-2.5 text-xs font-semibold text-[#3674DC] hover:underline cursor-pointer"
                >
                  Xóa từ khóa tìm kiếm
                </button>
              </>
            ) : (
              <>
                <div className="text-sm sm:text-base font-bold text-slate-900 num-clean">
                  Chưa có đơn hàng thành công nào trong{' '}
                  {selectedMonthRange.monthLabel} ({selectedMonthRange.rangeVN})
                </div>
                <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-lg mx-auto">
                  Khi đơn hàng phát sinh <strong>tiền cọc (Đợt 1)</strong>, tiền
                  cọc được tính vào doanh thu tháng cọc; khi bấm xác nhận{' '}
                  <strong>Hoàn thành / tích Đã thu phần còn lại (Đợt 2)</strong>
                  , phần còn lại tự động ghi nhận vào đúng ngày/tháng thanh toán
                  và tách rõ <strong>Tiền thiết kế</strong> &{' '}
                  <strong>Tiền in</strong>.
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={onOpenSavedTab}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>Mở Báo giá đã lưu</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenAddForm}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span>Thêm doanh thu thủ công</span>
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[960px] num-clean">
              <thead>
                <tr className="bg-[#4887EE] text-white text-xs font-bold">
                  <th className="py-3 px-4 w-36">NGÀY / THÁNG / NĂM</th>
                  <th className="py-3 px-3 w-56">KHÁCH HÀNG & MÃ ĐƠN</th>
                  <th className="py-3 px-3">HẠNG MỤC / GHI CHÚ</th>
                  <th className="py-3 px-3 text-right w-36">TIỀN THIẾT KẾ</th>
                  <th className="py-3 px-3 text-right w-36">TIỀN IN</th>
                  <th className="py-3 px-3 text-right w-40">TỔNG DOANH THU</th>
                  <th className="py-3 px-4 text-right w-52">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredMonthEntries.map((entry, idx) => {
                  const linkedInvoice = entry.invoiceId
                    ? invoicesById.get(entry.invoiceId)
                    : undefined;
                  const isEditingRow = editingId === entry.id;

                  if (isEditingRow) {
                    return (
                      <tr key={entry.id} className="bg-blue-50/40">
                        <td className="py-3 px-4 align-top">
                          <input
                            type="date"
                            value={editOrderDate}
                            onChange={(e) => setEditOrderDate(e.target.value)}
                            aria-label="Ngày tháng năm đơn hàng"
                            className="w-full h-8 px-2 text-xs font-bold text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#4887EE] num-clean"
                          />
                        </td>
                        <td className="py-3 px-3 align-top space-y-1.5">
                          <input
                            type="text"
                            maxLength={120}
                            value={editCustomerName}
                            onChange={(e) =>
                              setEditCustomerName(e.target.value)
                            }
                            placeholder="Tên khách hàng"
                            className="w-full h-8 px-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#4887EE]"
                          />
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              maxLength={30}
                              value={editCustomerPhone}
                              onChange={(e) =>
                                setEditCustomerPhone(e.target.value)
                              }
                              placeholder="SĐT"
                              className="w-1/2 h-8 px-2 text-xs text-slate-800 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#4887EE]"
                            />
                            <input
                              type="text"
                              maxLength={40}
                              value={editInvoiceCode}
                              onChange={(e) =>
                                setEditInvoiceCode(e.target.value)
                              }
                              placeholder="Mã đơn"
                              className="w-1/2 h-8 px-2 text-xs text-slate-800 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#4887EE]"
                            />
                          </div>
                        </td>
                        <td className="py-3 px-3 align-top">
                          <input
                            type="text"
                            maxLength={500}
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            placeholder="Ghi chú hạng mục..."
                            className="w-full h-8 px-2 text-xs text-slate-800 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#4887EE]"
                          />
                        </td>
                        <td className="py-3 px-3 align-top">
                          <MoneyInput
                            value={editDesignAmount}
                            onChange={setEditDesignAmount}
                            ariaLabel="Sửa tiền thiết kế"
                            className="w-full h-8 bg-white border border-slate-300 rounded-md focus-within:border-[#4887EE] text-xs"
                          />
                        </td>
                        <td className="py-3 px-3 align-top">
                          <MoneyInput
                            value={editPrintAmount}
                            onChange={setEditPrintAmount}
                            ariaLabel="Sửa tiền in"
                            className="w-full h-8 bg-white border border-slate-300 rounded-md focus-within:border-[#4887EE] text-xs"
                          />
                        </td>
                        <td className="py-3 px-3 align-top text-right font-extrabold text-slate-900">
                          {formatVND(
                            clampRevenuePart(editDesignAmount) +
                              clampRevenuePart(editPrintAmount)
                          )}
                        </td>
                        <td className="py-3 px-4 align-top text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => saveEditedEntry(entry)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <Check className="w-3.5 h-3.5 shrink-0" />
                              <span>Lưu</span>
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditingEntry}
                              className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                            >
                              Hủy
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr
                      key={entry.id}
                      className={`transition-colors ${
                        idx % 2 === 1
                          ? 'bg-slate-50/40 hover:bg-slate-100/70'
                          : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3 px-4 align-top">
                        <div className="font-bold text-slate-900">
                          {formatISODateVN(entry.orderDate)}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Tháng {entry.monthKey.slice(5, 7)}/
                          {entry.monthKey.slice(0, 4)}
                        </div>
                      </td>

                      <td className="py-3 px-3 align-top">
                        <div className="font-semibold text-slate-900">
                          {entry.customerName}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          {entry.invoiceCode && (
                            <span className="font-semibold text-slate-700">
                              {entry.invoiceCode}
                            </span>
                          )}
                          {entry.invoiceCode && entry.customerPhone && (
                            <span aria-hidden="true">·</span>
                          )}
                          {entry.customerPhone && (
                            <span>SĐT: {entry.customerPhone}</span>
                          )}
                          {!entry.invoiceId && (
                            <>
                              {(entry.invoiceCode || entry.customerPhone) && (
                                <span aria-hidden="true">·</span>
                              )}
                              <span>Nhập thủ công</span>
                            </>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3 align-top">
                        <div className="text-sm text-slate-700 line-clamp-2">
                          <span
                            className={
                              !entry.invoiceId
                                ? 'text-slate-600 font-semibold'
                                : isRemainingStageRevenueEntry(entry)
                                  ? 'text-emerald-700 font-bold'
                                  : 'text-[#3674DC] font-bold'
                            }
                          >
                            {getRevenueEntryPaymentBadge(entry)}
                          </span>
                          <span
                            aria-hidden="true"
                            className="text-slate-300 mx-1.5"
                          >
                            ·
                          </span>
                          <span>
                            {stripStagePrefixFromRevenueNote(entry.note) ||
                              'Đơn hàng thành công'}
                          </span>
                        </div>
                        {linkedInvoice && !entry.isManualOverride && (
                          <div className="text-[11px] text-slate-500 mt-0.5 num-clean">
                            Báo giá: Tạm tính{' '}
                            {formatVND(linkedInvoice.totals.subtotal)}
                            {linkedInvoice.totals.discountAmount > 0 &&
                              ` · Giảm ${formatVND(linkedInvoice.totals.discountAmount)}`}
                            {linkedInvoice.totals.shippingFee > 0 &&
                              ` · Ship ${formatVND(linkedInvoice.totals.shippingFee)}`}
                            {linkedInvoice.totals.depositAmount > 0 &&
                              ` · Cọc đợt 1 ${formatVND(linkedInvoice.totals.depositAmount)}`}
                            {isInvoiceRemainingSettled(linkedInvoice) ? (
                              <span className="text-emerald-700 font-semibold">
                                {' '}
                                · Đã tất toán đủ (
                                {formatISODateVN(
                                  getInvoiceRemainingPaidDate(linkedInvoice)
                                )}
                                )
                              </span>
                            ) : (
                              <span>
                                {' '}
                                · Chờ thu phần còn lại{' '}
                                {formatVND(
                                  getUncollectedRemainingAmount(linkedInvoice)
                                )}
                              </span>
                            )}
                          </div>
                        )}
                        {entry.isManualOverride && entry.invoiceId && (
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Đã chỉnh sửa số liệu thủ công
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 align-top text-right font-semibold text-[#3674DC]">
                        {formatVND(entry.designAmount)}
                      </td>

                      <td className="py-3 px-3 align-top text-right font-semibold text-emerald-700">
                        {formatVND(entry.printAmount)}
                      </td>

                      <td className="py-3 px-3 align-top text-right font-extrabold text-slate-900">
                        {formatVND(entry.totalRevenue)}
                      </td>

                      <td className="py-3 px-4 align-top text-right">
                        {confirmDeleteId === entry.id ? (
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteEntry(entry);
                                setConfirmDeleteId(null);
                                flashNotice(
                                  `Nhân viên đã xóa khoản doanh thu của "${entry.customerName}".`
                                );
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
                            {linkedInvoice && (
                              <button
                                type="button"
                                onClick={() =>
                                  onViewLinkedInvoice(linkedInvoice)
                                }
                                title="Xem phiếu báo giá gốc"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <Eye className="w-3.5 h-3.5 shrink-0" />
                                <span>Đơn</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => startEditingEntry(entry)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <Pencil className="w-3.5 h-3.5 shrink-0" />
                              <span>Sửa</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(entry.id)}
                              title="Nhân viên chủ động xóa khỏi báo cáo doanh thu"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5 shrink-0" />
                              <span>Xóa</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t border-slate-200 font-bold text-slate-900">
                  <td colSpan={3} className="py-3 px-4 text-xs sm:text-sm">
                    Cộng {selectedMonthRange.monthLabel} (
                    {countDistinctOrdersInEntries(filteredMonthEntries)} đơn
                    {filteredMonthEntries.length >
                    countDistinctOrdersInEntries(filteredMonthEntries)
                      ? ` · ${filteredMonthEntries.length} đợt thu`
                      : ''}{' '}
                    · {countDistinctCustomersInEntries(filteredMonthEntries)}{' '}
                    khách hàng)
                  </td>
                  <td className="py-3 px-3 text-right text-[#3674DC]">
                    {formatVND(
                      filteredMonthEntries.reduce(
                        (s, e) => s + e.designAmount,
                        0
                      )
                    )}
                  </td>
                  <td className="py-3 px-3 text-right text-emerald-700">
                    {formatVND(
                      filteredMonthEntries.reduce(
                        (s, e) => s + e.printAmount,
                        0
                      )
                    )}
                  </td>
                  <td className="py-3 px-3 text-right font-extrabold text-slate-900">
                    {formatVND(
                      filteredMonthEntries.reduce(
                        (s, e) => s + e.totalRevenue,
                        0
                      )
                    )}
                  </td>
                  <td className="py-3 px-4" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Optional Restore Drawer if staff deleted any linked orders in this month */}
        {deletedEntriesInSelectedMonth.length > 0 && (
          <div className="px-4 sm:px-5 py-3 border-t border-slate-200 bg-slate-50/70 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-600 num-clean">
                Có {deletedEntriesInSelectedMonth.length} đơn liên kết đã được
                nhân viên chủ động xóa khỏi {selectedMonthRange.monthLabel}.
              </span>
              <button
                type="button"
                onClick={() => setShowDeletedList((prev) => !prev)}
                className="text-xs font-semibold text-[#3674DC] hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                {showDeletedList
                  ? 'Thu gọn danh sách đã xóa'
                  : 'Xem & khôi phục nếu xóa nhầm'}
              </button>
            </div>

            {showDeletedList && (
              <div className="divide-y divide-slate-200 border-t border-slate-200 pt-1">
                {deletedEntriesInSelectedMonth.map((delItem) => (
                  <div
                    key={delItem.id}
                    className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs num-clean"
                  >
                    <div className="text-slate-700">
                      <span className="font-semibold text-slate-900">
                        {formatISODateVN(delItem.orderDate)}
                      </span>{' '}
                      · <span>{delItem.customerName}</span>
                      {delItem.invoiceCode ? ` (${delItem.invoiceCode})` : ''} ·
                      Tổng {formatVND(delItem.totalRevenue)}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onRestoreEntry(delItem);
                        flashNotice(
                          `Đã khôi phục doanh thu của "${delItem.customerName}".`
                        );
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#3674DC] bg-white hover:bg-blue-50 border border-slate-200 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                      <span>Khôi phục</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

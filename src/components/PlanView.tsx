import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  FilePlus2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { getReportStageLabel } from '../constants/reportStages';
import {
  buildPhoneCustomerId,
  DEFAULT_MONTHLY_VOUCHER_BUDGET,
  formatMonthKeyVN,
  getCurrentLocalMonthKey,
  getInvoiceMonthKey,
  MONTH_KEY_PATTERN,
  normalizePhoneDigits,
  shiftMonthKey,
} from '../services/planStorage';
import {
  CustomerContact,
  PlanSubTab,
  ReportStage,
  SavedInvoice,
  VoucherBudget,
} from '../types';
import {
  formatDateOnlyVN,
  formatDateTimeVN,
  formatISODateVN,
  formatVND,
  getLocalISODate,
} from '../utils/formatters';
import {
  auditInvoiceVoucher,
  InvoiceVoucherAudit,
  MIN_VOUCHER_DISCOUNT_AMOUNT,
} from '../utils/voucherAudit';
import { MoneyInput } from './MoneyInput';

interface PlanViewProps {
  activeSubTab: PlanSubTab;
  onSelectSubTab: (subTab: PlanSubTab) => void;
  invoices: SavedInvoice[];
  voucherBudgets: VoucherBudget[];
  customers: CustomerContact[];
  storeFooterNote?: string;
  onSaveVoucherBudget: (budget: VoucherBudget) => void;
  onSaveInvoiceStage: (invoice: SavedInvoice, stage: ReportStage | '') => void;
  onUpsertCustomer: (customer: CustomerContact) => void;
  onDeleteCustomer: (customerId: string) => void;
  onViewInvoice: (invoice: SavedInvoice) => void;
  onEditInvoice: (invoice: SavedInvoice) => void;
  onCreateNewInvoice: () => void;
  onCreateInvoiceForCustomer: (name: string, phone: string) => void;
}

const VOUCHER_BUDGET_PRESETS = [
  { label: '2.000.000đ', value: 2_000_000 },
  { label: '3.000.000đ', value: 3_000_000 },
  { label: '5.000.000đ', value: 5_000_000 },
  { label: '10.000.000đ', value: 10_000_000 },
];

type CustomerFilterMode = 'all' | 'with_bills' | 'without_bills';
type VoucherLedgerMode =
  | 'qualified'
  | 'discounted_no_coc'
  | 'no_discount'
  | 'all_audit';

interface VoucherLedgerRow {
  invoice: SavedInvoice;
  audit: InvoiceVoucherAudit;
  cumulativeUsed: number;
  remainingAfter: number;
  exceededByAfter: number;
}

interface CrossMonthAuditBucket {
  monthKey: string;
  qualifiedCount: number;
  totalDeductedAmount: number;
  discountedWithoutCocCount: number;
  updatedInSelectedMonthCount: number;
}

interface MergedCustomerRow {
  key: string;
  storedRecord: CustomerContact | null;
  name: string;
  phone: string;
  customerDate: string;
  note: string;
  invoiceCount: number;
  depositedInvoiceCount: number;
  totalSpent: number;
  totalDiscountReceived: number;
  latestActivityAt: string;
}

export function PlanView({
  activeSubTab,
  onSelectSubTab,
  invoices,
  voucherBudgets,
  customers,
  storeFooterNote,
  onSaveVoucherBudget,
  onSaveInvoiceStage,
  onUpsertCustomer,
  onDeleteCustomer,
  onViewInvoice,
  onEditInvoice,
  onCreateNewInvoice,
  onCreateInvoiceForCustomer,
}: PlanViewProps) {
  const currentMonthKey = useMemo(() => getCurrentLocalMonthKey(), []);
  const [selectedMonthKey, setSelectedMonthKey] =
    useState<string>(currentMonthKey);

  const configuredBudget = useMemo(
    () =>
      voucherBudgets.find((item) => item.monthKey === selectedMonthKey) || null,
    [voucherBudgets, selectedMonthKey]
  );

  const savedBudgetAmount = configuredBudget
    ? configuredBudget.budgetAmount
    : DEFAULT_MONTHLY_VOUCHER_BUDGET;
  const savedBudgetNote = configuredBudget ? configuredBudget.note : '';

  const [draftBudgetAmount, setDraftBudgetAmount] =
    useState<number>(savedBudgetAmount);
  const [draftBudgetNote, setDraftBudgetNote] =
    useState<string>(savedBudgetNote);
  const [budgetSavedFlash, setBudgetSavedFlash] = useState<boolean>(false);
  const [voucherLedgerMode, setVoucherLedgerMode] =
    useState<VoucherLedgerMode>('qualified');
  const [voucherSearchQuery, setVoucherSearchQuery] = useState<string>('');
  const [justMarkedCocId, setJustMarkedCocId] = useState<string | null>(null);
  const markCocTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (markCocTimerRef.current !== null) {
        window.clearTimeout(markCocTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setDraftBudgetAmount(savedBudgetAmount);
    setDraftBudgetNote(savedBudgetNote);
  }, [selectedMonthKey, savedBudgetAmount, savedBudgetNote]);

  useEffect(() => {
    if (!budgetSavedFlash) return;
    const timer = window.setTimeout(() => setBudgetSavedFlash(false), 2600);
    return () => window.clearTimeout(timer);
  }, [budgetSavedFlash]);

  const isBudgetDirty =
    !configuredBudget ||
    draftBudgetAmount !== configuredBudget.budgetAmount ||
    draftBudgetNote.trim() !== configuredBudget.note;

  const handleCommitBudget = (overrideAmount?: number) => {
    const nextAmount =
      typeof overrideAmount === 'number'
        ? Math.max(0, Math.round(overrideAmount))
        : Math.max(0, Math.round(draftBudgetAmount || 0));
    setDraftBudgetAmount(nextAmount);
    onSaveVoucherBudget({
      monthKey: selectedMonthKey,
      budgetAmount: nextAmount,
      note: draftBudgetNote.trim().slice(0, 500),
      updatedAt: new Date().toISOString(),
    });
    setBudgetSavedFlash(true);
  };

  const handleQuickMarkCoc = (invoice: SavedInvoice) => {
    onSaveInvoiceStage(invoice, 'coc');
    setJustMarkedCocId(invoice.id);
    if (markCocTimerRef.current !== null) {
      window.clearTimeout(markCocTimerRef.current);
    }
    markCocTimerRef.current = window.setTimeout(() => {
      setJustMarkedCocId((curr) => (curr === invoice.id ? null : curr));
      markCocTimerRef.current = null;
    }, 2600);
  };

  // Pre-compute multi-field audit for 100% of saved invoices
  const invoiceAuditMap = useMemo(() => {
    const map = new Map<string, InvoiceVoucherAudit>();
    for (const inv of invoices) {
      map.set(inv.id, auditInvoiceVoucher(inv, storeFooterNote));
    }
    return map;
  }, [invoices, storeFooterNote]);

  // Cross-month anti-miss audit: detect any discounted (>= 1.000đ) invoices in other months
  const crossMonthAlerts = useMemo<CrossMonthAuditBucket[]>(() => {
    const byMonth = new Map<string, CrossMonthAuditBucket>();
    for (const inv of invoices) {
      const createdMonth = getInvoiceMonthKey(inv.createdAt);
      if (createdMonth === selectedMonthKey) continue;
      const audit =
        invoiceAuditMap.get(inv.id) || auditInvoiceVoucher(inv, storeFooterNote);
      if (!audit.hasValidDiscount) continue;

      const updatedMonth = getInvoiceMonthKey(inv.updatedAt);
      let bucket = byMonth.get(createdMonth);
      if (!bucket) {
        bucket = {
          monthKey: createdMonth,
          qualifiedCount: 0,
          totalDeductedAmount: 0,
          discountedWithoutCocCount: 0,
          updatedInSelectedMonthCount: 0,
        };
        byMonth.set(createdMonth, bucket);
      }

      bucket.qualifiedCount += 1;
      bucket.totalDeductedAmount += audit.voucherDeductAmount;
      if (!audit.isCoc) {
        bucket.discountedWithoutCocCount += 1;
      }

      if (updatedMonth === selectedMonthKey) {
        bucket.updatedInSelectedMonthCount += 1;
      }
    }

    return Array.from(byMonth.values())
      .filter(
        (b) =>
          b.discountedWithoutCocCount > 0 ||
          b.updatedInSelectedMonthCount > 0 ||
          b.qualifiedCount > 0
      )
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, [invoices, selectedMonthKey, invoiceAuditMap, storeFooterNote]);

  // Monthly invoice & voucher deduction reconciliation
  // Rule: Any invoice with customer discount >= 1.000đ immediately deducts its exact discount amount from Quỹ Voucher
  const monthlyVoucherStats = useMemo(() => {
    const monthInvoices = invoices.filter(
      (inv) => getInvoiceMonthKey(inv.createdAt) === selectedMonthKey
    );

    const auditedList = monthInvoices.map((inv) => ({
      invoice: inv,
      audit:
        invoiceAuditMap.get(inv.id) || auditInvoiceVoucher(inv, storeFooterNote),
    }));

    const chronologicalQualified = auditedList
      .filter(({ audit }) => audit.isQualifiedVoucher)
      .sort(
        (a, b) =>
          new Date(a.invoice.createdAt).getTime() -
          new Date(b.invoice.createdAt).getTime()
      );

    let cumulativeUsed = 0;
    const balanceById = new Map<
      string,
      { cumulativeUsed: number; remainingAfter: number; exceededByAfter: number }
    >();

    const qualifiedChronological: VoucherLedgerRow[] =
      chronologicalQualified.map(({ invoice, audit }) => {
        cumulativeUsed += audit.voucherDeductAmount;
        const remainingAfter = Math.max(0, draftBudgetAmount - cumulativeUsed);
        const exceededByAfter = Math.max(0, cumulativeUsed - draftBudgetAmount);
        balanceById.set(invoice.id, {
          cumulativeUsed,
          remainingAfter,
          exceededByAfter,
        });
        return {
          invoice,
          audit,
          cumulativeUsed,
          remainingAfter,
          exceededByAfter,
        };
      });

    const totalUsedDiscount = cumulativeUsed;
    const remainingBudget = Math.max(0, draftBudgetAmount - totalUsedDiscount);
    const overBudgetAmount = Math.max(0, totalUsedDiscount - draftBudgetAmount);

    // Tab 2: Đơn có giảm (đã trừ Quỹ) nhưng chưa để Cọc (để nhân viên theo dõi thu cọc)
    const discountedWithoutCocRows: VoucherLedgerRow[] = auditedList
      .filter(({ audit }) => audit.hasValidDiscount && !audit.isCoc)
      .sort((a, b) => {
        if (
          a.audit.isInAdvancedStageWithoutCoc !==
          b.audit.isInAdvancedStageWithoutCoc
        ) {
          return a.audit.isInAdvancedStageWithoutCoc ? -1 : 1;
        }
        return (
          new Date(b.invoice.createdAt).getTime() -
          new Date(a.invoice.createdAt).getTime()
        );
      })
      .map(({ invoice, audit }) => {
        const bal = balanceById.get(invoice.id);
        return {
          invoice,
          audit,
          cumulativeUsed: bal ? bal.cumulativeUsed : 0,
          remainingAfter: bal ? bal.remainingAfter : remainingBudget,
          exceededByAfter: bal ? bal.exceededByAfter : 0,
        };
      });

    const advancedWithoutCocDiscountedCount = discountedWithoutCocRows.filter(
      (r) => r.audit.isInAdvancedStageWithoutCoc
    ).length;

    // Tab 3: Đơn không phát sinh giảm giá >= 1.000đ (không trừ Quỹ)
    const noDiscountRows: VoucherLedgerRow[] = auditedList
      .filter(({ audit }) => !audit.hasValidDiscount)
      .sort((a, b) => {
        if (a.audit.hasSubThresholdDiscount !== b.audit.hasSubThresholdDiscount) {
          return a.audit.hasSubThresholdDiscount ? -1 : 1;
        }
        return (
          new Date(b.invoice.createdAt).getTime() -
          new Date(a.invoice.createdAt).getTime()
        );
      })
      .map(({ invoice, audit }) => ({
        invoice,
        audit,
        cumulativeUsed: 0,
        remainingAfter: remainingBudget,
        exceededByAfter: 0,
      }));

    // Tab 4: 100% of invoices in the month for full reconciliation
    const allMonthAuditRows: VoucherLedgerRow[] = [...auditedList]
      .sort(
        (a, b) =>
          new Date(b.invoice.createdAt).getTime() -
          new Date(a.invoice.createdAt).getTime()
      )
      .map(({ invoice, audit }) => {
        const bal = balanceById.get(invoice.id);
        return {
          invoice,
          audit,
          cumulativeUsed: bal ? bal.cumulativeUsed : 0,
          remainingAfter: bal ? bal.remainingAfter : remainingBudget,
          exceededByAfter: bal ? bal.exceededByAfter : 0,
        };
      });

    return {
      allMonthInvoicesCount: monthInvoices.length,
      qualifiedCount: qualifiedChronological.length,
      discountedWithoutCocCount: discountedWithoutCocRows.length,
      advancedWithoutCocDiscountedCount,
      noDiscountCount: noDiscountRows.length,
      totalUsedDiscount,
      remainingBudget,
      overBudgetAmount,
      qualifiedRowsNewestFirst: [...qualifiedChronological].reverse(),
      discountedWithoutCocRows,
      noDiscountRows,
      allMonthAuditRows,
    };
  }, [
    invoices,
    selectedMonthKey,
    draftBudgetAmount,
    invoiceAuditMap,
    storeFooterNote,
  ]);

  const activeLedgerSource = useMemo<VoucherLedgerRow[]>(() => {
    switch (voucherLedgerMode) {
      case 'qualified':
        return monthlyVoucherStats.qualifiedRowsNewestFirst;
      case 'discounted_no_coc':
        return monthlyVoucherStats.discountedWithoutCocRows;
      case 'no_discount':
        return monthlyVoucherStats.noDiscountRows;
      case 'all_audit':
        return monthlyVoucherStats.allMonthAuditRows;
    }
  }, [voucherLedgerMode, monthlyVoucherStats]);

  const filteredVoucherLedger = useMemo(() => {
    const q = voucherSearchQuery.trim().toLowerCase();
    if (!q) return activeLedgerSource;
    return activeLedgerSource.filter(({ invoice, audit }) => {
      const hay = [
        invoice.code,
        invoice.customer.name,
        invoice.customer.phone,
        invoice.customer.code,
        invoice.designIllustration,
        invoice.invoiceNote,
        ...invoice.items.map((it) => `${it.name} ${it.note || ''}`),
        ...audit.cocReasons,
        ...audit.discountReasons,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [activeLedgerSource, voucherSearchQuery]);

  // --- Date KH State & Merged Directory ---
  const [custNameInput, setCustNameInput] = useState<string>('');
  const [custPhoneInput, setCustPhoneInput] = useState<string>('');
  const [custDateInput, setCustDateInput] = useState<string>(() =>
    getLocalISODate(0)
  );
  const [custNoteInput, setCustNoteInput] = useState<string>('');
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(
    null
  );
  const [customerFormError, setCustomerFormError] = useState<string | null>(
    null
  );
  const [customerSavedFlash, setCustomerSavedFlash] = useState<boolean>(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState<string>('');
  const [customerFilterMode, setCustomerFilterMode] =
    useState<CustomerFilterMode>('all');
  const [copiedPhoneKey, setCopiedPhoneKey] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!customerSavedFlash) return;
    const timer = window.setTimeout(() => setCustomerSavedFlash(false), 2400);
    return () => window.clearTimeout(timer);
  }, [customerSavedFlash]);

  useEffect(() => {
    if (!copiedPhoneKey) return;
    const timer = window.setTimeout(() => setCopiedPhoneKey(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedPhoneKey]);

  const mergedCustomers = useMemo<MergedCustomerRow[]>(() => {
    const byKey = new Map<string, MergedCustomerRow>();
    const phoneKeyMap = new Map<string, string>();

    // 1. Seed with stored Date KH contacts
    for (const contact of customers) {
      const digits = normalizePhoneDigits(contact.phone);
      const rowKey = digits.length >= 6 ? `ph_${digits}` : `id_${contact.id}`;
      if (digits.length >= 6) {
        phoneKeyMap.set(digits, rowKey);
      }
      byKey.set(rowKey, {
        key: rowKey,
        storedRecord: contact,
        name: contact.name,
        phone: contact.phone,
        customerDate: contact.customerDate,
        note: contact.note,
        invoiceCount: 0,
        depositedInvoiceCount: 0,
        totalSpent: 0,
        totalDiscountReceived: 0,
        latestActivityAt: contact.updatedAt || contact.createdAt,
      });
    }

    // 2. Enrich & auto-include customers from saved bills (invoices sorted newest first)
    const sortedInvoices = [...invoices].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    for (const inv of sortedInvoices) {
      const rawName = (inv.customer.name || '').trim();
      const rawPhone = (inv.customer.phone || '').trim();
      if (!rawName && !rawPhone) continue;

      const digits = normalizePhoneDigits(rawPhone);
      let rowKey = '';
      if (digits.length >= 6) {
        rowKey = phoneKeyMap.get(digits) || `ph_${digits}`;
        phoneKeyMap.set(digits, rowKey);
      } else {
        rowKey = `name_${rawName.toLowerCase()}`;
      }

      const audit =
        invoiceAuditMap.get(inv.id) || auditInvoiceVoucher(inv, storeFooterNote);
      const orderValue = Math.max(
        0,
        (inv.totals?.subtotal ?? 0) -
          (inv.totals?.discountAmount ?? inv.discountAmount ?? 0) +
          (inv.totals?.shippingFee ?? inv.shippingFee ?? 0)
      );
      const disc = audit.isQualifiedVoucher
        ? audit.voucherDeductAmount
        : audit.rawDiscountAmount;
      const hasDeposit = audit.isCoc;

      const existing = byKey.get(rowKey);
      if (existing) {
        existing.invoiceCount += 1;
        if (hasDeposit) {
          existing.depositedInvoiceCount += 1;
        }
        existing.totalSpent += orderValue;
        existing.totalDiscountReceived += disc;
        if (!existing.name && rawName) {
          existing.name = rawName;
        }
        if (!existing.phone && rawPhone) {
          existing.phone = rawPhone;
        }
        if (!existing.customerDate) {
          existing.customerDate = inv.createdAt.slice(0, 10);
        }
        if (
          new Date(inv.createdAt).getTime() >
          new Date(existing.latestActivityAt).getTime()
        ) {
          existing.latestActivityAt = inv.createdAt;
        }
      } else {
        byKey.set(rowKey, {
          key: rowKey,
          storedRecord: null,
          name: rawName || 'Khách hàng',
          phone: rawPhone,
          customerDate: inv.createdAt.slice(0, 10),
          note: '',
          invoiceCount: 1,
          depositedInvoiceCount: hasDeposit ? 1 : 0,
          totalSpent: orderValue,
          totalDiscountReceived: disc,
          latestActivityAt: inv.createdAt,
        });
      }
    }

    return Array.from(byKey.values()).sort(
      (a, b) =>
        new Date(b.latestActivityAt).getTime() -
        new Date(a.latestActivityAt).getTime()
    );
  }, [customers, invoices, invoiceAuditMap, storeFooterNote]);

  const customerCounts = useMemo(() => {
    let withBills = 0;
    let withoutBills = 0;
    for (const row of mergedCustomers) {
      if (row.invoiceCount > 0) withBills += 1;
      else withoutBills += 1;
    }
    return {
      total: mergedCustomers.length,
      withBills,
      withoutBills,
    };
  }, [mergedCustomers]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearchQuery.trim().toLowerCase();
    const qDigits = normalizePhoneDigits(q);
    return mergedCustomers.filter((row) => {
      if (customerFilterMode === 'with_bills' && row.invoiceCount === 0) {
        return false;
      }
      if (customerFilterMode === 'without_bills' && row.invoiceCount > 0) {
        return false;
      }
      if (!q) return true;
      const textMatch = [row.name, row.phone, row.note]
        .join(' ')
        .toLowerCase()
        .includes(q);
      if (textMatch) return true;
      if (qDigits.length >= 3) {
        return normalizePhoneDigits(row.phone).includes(qDigits);
      }
      return false;
    });
  }, [mergedCustomers, customerFilterMode, customerSearchQuery]);

  const resetCustomerForm = () => {
    setEditingCustomerId(null);
    setCustNameInput('');
    setCustPhoneInput('');
    setCustDateInput(getLocalISODate(0));
    setCustNoteInput('');
    setCustomerFormError(null);
  };

  const handleSubmitCustomerForm = (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = custNameInput.trim().slice(0, 120);
    const trimmedPhone = custPhoneInput.trim().slice(0, 30);

    if (!trimmedName || !trimmedPhone) {
      setCustomerFormError('Vui lòng nhập đầy đủ Tên KH và Số điện thoại.');
      return;
    }

    setCustomerFormError(null);
    const nowISO = new Date().toISOString();

    const existingRecord = editingCustomerId
      ? customers.find((c) => c.id === editingCustomerId) || null
      : customers.find(
          (c) =>
            normalizePhoneDigits(c.phone).length >= 6 &&
            normalizePhoneDigits(c.phone) === normalizePhoneDigits(trimmedPhone)
        ) || null;

    const targetId =
      existingRecord?.id ||
      editingCustomerId ||
      buildPhoneCustomerId(trimmedPhone);

    onUpsertCustomer({
      id: targetId,
      name: trimmedName,
      phone: trimmedPhone,
      customerDate: custDateInput.trim().slice(0, 30),
      note: custNoteInput.trim().slice(0, 500),
      createdAt: existingRecord?.createdAt || nowISO,
      updatedAt: nowISO,
    });

    resetCustomerForm();
    setCustomerSavedFlash(true);
  };

  const handleStartEditCustomerRow = (row: MergedCustomerRow) => {
    const targetId =
      row.storedRecord?.id ||
      (row.phone ? buildPhoneCustomerId(row.phone) : `cust_${Date.now()}`);
    setEditingCustomerId(targetId);
    setCustNameInput(row.name);
    setCustPhoneInput(row.phone);
    setCustDateInput(
      /^\d{4}-\d{2}-\d{2}$/.test(row.customerDate)
        ? row.customerDate
        : getLocalISODate(0)
    );
    setCustNoteInput(row.note || '');
    setCustomerFormError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCopyPhone = async (rowKey: string, phone: string) => {
    if (!phone.trim()) return;
    try {
      await navigator.clipboard.writeText(phone.trim());
      setCopiedPhoneKey(rowKey);
    } catch {
      // Ignore clipboard permission failures
    }
  };

  const actionableCrossMonthAlerts = useMemo(
    () =>
      crossMonthAlerts.filter(
        (b) =>
          b.discountedWithoutCocCount > 0 ||
          b.updatedInSelectedMonthCount > 0 ||
          (monthlyVoucherStats.qualifiedCount === 0 && b.qualifiedCount > 0)
      ),
    [crossMonthAlerts, monthlyVoucherStats.qualifiedCount]
  );

  return (
    <div className="space-y-6">
      {/* Top Header & Sub-Tab Switcher (Voucher | Date KH) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
            Kế Hoạch Kinh Doanh & Khách Hàng
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 num-clean">
            <span>
              Quỹ Voucher {formatMonthKeyVN(selectedMonthKey)} còn{' '}
              <strong className="font-semibold text-slate-800">
                {formatVND(monthlyVoucherStats.remainingBudget)}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Đã trừ {formatVND(monthlyVoucherStats.totalUsedDiscount)} (
              {monthlyVoucherStats.qualifiedCount} đơn giảm từ{' '}
              {formatVND(MIN_VOUCHER_DISCOUNT_AMOUNT)})
            </span>
            {monthlyVoucherStats.discountedWithoutCocCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-amber-700">
                  {monthlyVoucherStats.discountedWithoutCocCount} đơn giảm chưa
                  ghi Cọc
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{customerCounts.total} liên hệ trong Date KH</span>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Mục nhỏ trong Kế Hoạch"
          className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto shrink-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'voucher'}
            onClick={() => onSelectSubTab('voucher')}
            className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
              activeSubTab === 'voucher'
                ? 'bg-[#4887EE] text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Voucher ({formatMonthKeyVN(selectedMonthKey)})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'customers'}
            onClick={() => onSelectSubTab('customers')}
            className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
              activeSubTab === 'customers'
                ? 'bg-[#4887EE] text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Date KH ({customerCounts.total})
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: VOUCHER */}
      {activeSubTab === 'voucher' && (
        <div className="space-y-6">
          {/* Cross-Month Anti-Miss Reconciliation Notice */}
          {actionableCrossMonthAlerts.length > 0 && (
            <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 num-clean">
              <div className="text-xs sm:text-sm text-amber-950 space-y-0.5">
                <div className="font-bold text-amber-900">
                  Đối soát đơn giảm giá giữa các tháng
                </div>
                <p className="text-xs text-amber-900/90 leading-relaxed">
                  Phát hiện hóa đơn phát sinh giảm khách (≥ 1.000đ) ở tháng khác
                  — bấm chọn tháng để xem số tiền đã trừ quỹ và đối soát:
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {actionableCrossMonthAlerts.slice(0, 4).map((bucket) => (
                  <button
                    key={bucket.monthKey}
                    type="button"
                    onClick={() => {
                      setSelectedMonthKey(bucket.monthKey);
                      setVoucherLedgerMode('qualified');
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-amber-950 bg-white hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 num-clean"
                  >
                    {formatMonthKeyVN(bucket.monthKey)} ·{' '}
                    {bucket.qualifiedCount} đơn (-
                    {formatVND(bucket.totalDeductedAmount)})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Voucher Budget Control + Live 4-Column KPI Strip */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Top Controls Row: Month Selector + Adjustable Fixed Discount Input */}
            <div className="p-4 sm:p-5 border-b border-slate-200 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                {/* Month Picker */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="voucher-month-picker"
                    className="block text-xs font-semibold text-slate-600"
                  >
                    Tháng áp dụng Quỹ Voucher
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedMonthKey((prev) => shiftMonthKey(prev, -1))
                      }
                      aria-label="Tháng trước"
                      className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer shrink-0"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    <input
                      id="voucher-month-picker"
                      type="month"
                      value={selectedMonthKey}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        if (MONTH_KEY_PATTERN.test(val)) {
                          setSelectedMonthKey(val);
                        }
                      }}
                      className="h-9 px-3 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#4887EE] num-clean"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setSelectedMonthKey((prev) => shiftMonthKey(prev, 1))
                      }
                      aria-label="Tháng sau"
                      className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer shrink-0"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>

                    {selectedMonthKey !== currentMonthKey && (
                      <button
                        type="button"
                        onClick={() => setSelectedMonthKey(currentMonthKey)}
                        className="px-3 py-1.5 text-xs font-semibold text-[#3674DC] bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Về tháng hiện tại
                      </button>
                    )}
                  </div>
                </div>

                {/* Adjustable Fixed Budget Amount + Note + Save */}
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-4 space-y-1.5">
                    <label
                      htmlFor="voucher-fixed-budget"
                      className="block text-xs font-semibold text-slate-600"
                    >
                      Quỹ Voucher cố định trong tháng (đ)
                    </label>
                    <MoneyInput
                      id="voucher-fixed-budget"
                      value={draftBudgetAmount}
                      onChange={setDraftBudgetAmount}
                      placeholder="5.000.000"
                      ariaLabel="Số tiền cố định giảm trong tháng"
                      className="w-full h-9 px-3 text-sm font-bold text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#4887EE]"
                    />
                  </div>

                  <div className="sm:col-span-5 space-y-1.5">
                    <label
                      htmlFor="voucher-budget-note"
                      className="block text-xs font-semibold text-slate-600"
                    >
                      Ghi chú Quỹ Voucher tháng (tuỳ chọn)
                    </label>
                    <input
                      id="voucher-budget-note"
                      type="text"
                      maxLength={500}
                      value={draftBudgetNote}
                      onChange={(e) => setDraftBudgetNote(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCommitBudget();
                        }
                      }}
                      placeholder="VD: Quỹ ưu đãi giảm giá khách hàng trong tháng (từ 1.000đ trở lên)"
                      className="w-full h-9 px-3 text-sm text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#4887EE]"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <button
                      type="button"
                      onClick={() => handleCommitBudget()}
                      className={`w-full h-9 px-4 text-xs sm:text-sm font-semibold rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                        budgetSavedFlash
                          ? 'bg-emerald-600 text-white'
                          : isBudgetDirty
                            ? 'bg-[#4887EE] hover:bg-[#3674DC] text-white'
                            : 'bg-slate-900 hover:bg-slate-800 text-white'
                      }`}
                    >
                      {budgetSavedFlash ? (
                        <>
                          <Check className="w-4 h-4 shrink-0" />
                          <span>Đã lưu quỹ tháng</span>
                        </>
                      ) : (
                        <span>Lưu quỹ cố định</span>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick Preset Buttons + Explicit Rule Summary */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-slate-500 mr-1">
                    Chọn nhanh hạn mức tháng:
                  </span>
                  {VOUCHER_BUDGET_PRESETS.map((preset) => {
                    const isSelected = draftBudgetAmount === preset.value;
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => handleCommitBudget(preset.value)}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                          isSelected
                            ? 'bg-blue-50 text-[#3674DC] border-[#4887EE]'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                <div className="text-xs text-slate-600 num-clean">
                  Quy tắc trừ quỹ: Phát sinh giảm khách từ{' '}
                  <strong>{formatVND(MIN_VOUCHER_DISCOUNT_AMOUNT)}</strong> trở
                  lên trên hóa đơn là tự động trừ thẳng đúng số tiền giảm vào{' '}
                  <strong>Quỹ Voucher</strong>.
                </div>
              </div>
            </div>

            {/* 4-Column Financial & Reconciliation Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50/60">
              <div className="p-4 sm:p-5 space-y-1">
                <div className="text-xs font-medium text-slate-500">
                  Quỹ Voucher cố định ({formatMonthKeyVN(selectedMonthKey)})
                </div>
                <div className="text-xl sm:text-2xl font-bold text-slate-900 num-clean">
                  {formatVND(draftBudgetAmount)}
                </div>
                <div className="text-xs text-slate-500 num-clean">
                  Trừ trực tiếp mọi khoản giảm từ{' '}
                  {formatVND(MIN_VOUCHER_DISCOUNT_AMOUNT)}
                </div>
              </div>

              <div className="p-4 sm:p-5 space-y-1">
                <div className="text-xs font-medium text-slate-500">
                  Đã trừ Quỹ (Giảm khách ≥ 1.000đ)
                </div>
                <div className="text-xl sm:text-2xl font-bold text-rose-600 num-clean">
                  {monthlyVoucherStats.totalUsedDiscount > 0
                    ? `-${formatVND(monthlyVoucherStats.totalUsedDiscount)}`
                    : '0đ'}
                </div>
                <div className="text-xs text-slate-500 num-clean">
                  Tổng tiền giảm của {monthlyVoucherStats.qualifiedCount} đơn
                  phát sinh giảm giá
                </div>
              </div>

              <div className="p-4 sm:p-5 space-y-1 bg-blue-50/40">
                <div className="text-xs font-semibold text-[#3674DC]">
                  Quỹ Voucher còn lại
                </div>
                <div
                  className={`text-xl sm:text-2xl font-extrabold num-clean ${
                    monthlyVoucherStats.overBudgetAmount > 0
                      ? 'text-rose-700'
                      : 'text-[#3674DC]'
                  }`}
                >
                  {formatVND(monthlyVoucherStats.remainingBudget)}
                </div>
                <div className="text-xs text-slate-600 num-clean">
                  {monthlyVoucherStats.overBudgetAmount > 0
                    ? `Vượt mức cố định: +${formatVND(monthlyVoucherStats.overBudgetAmount)}`
                    : `${formatVND(draftBudgetAmount)} - ${formatVND(monthlyVoucherStats.totalUsedDiscount)}`}
                </div>
              </div>

              <div className="p-4 sm:p-5 space-y-1">
                <div className="text-xs font-medium text-slate-500">
                  Theo dõi Cọc trên đơn giảm giá
                </div>
                <div
                  className={`text-xl sm:text-2xl font-bold num-clean ${
                    monthlyVoucherStats.discountedWithoutCocCount > 0
                      ? 'text-amber-700'
                      : 'text-emerald-700'
                  }`}
                >
                  {monthlyVoucherStats.discountedWithoutCocCount > 0
                    ? `${monthlyVoucherStats.discountedWithoutCocCount} đơn chưa Cọc`
                    : 'Đã đối soát đủ'}
                </div>
                <div className="text-xs text-slate-500 num-clean">
                  {monthlyVoucherStats.advancedWithoutCocDiscountedCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => setVoucherLedgerMode('discounted_no_coc')}
                      className="font-semibold text-amber-800 hover:underline cursor-pointer text-left"
                    >
                      Chú ý:{' '}
                      {monthlyVoucherStats.advancedWithoutCocDiscountedCount} đơn
                      đã chốt in/TK nhưng chưa ghi Cọc
                    </button>
                  ) : (
                    <span>
                      Đã rà soát {monthlyVoucherStats.allMonthInvoicesCount} hóa
                      đơn · {monthlyVoucherStats.noDiscountCount} đơn không giảm
                      giá
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 4-Tab Multi-Field Reconciliation & Voucher Ledger Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3.5">
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h2 className="text-base font-bold text-slate-900">
                    {voucherLedgerMode === 'qualified' &&
                      `Đơn phát sinh giảm khách ≥ 1.000đ đã trừ Quỹ Voucher (${formatMonthKeyVN(selectedMonthKey)})`}
                    {voucherLedgerMode === 'discounted_no_coc' &&
                      `Đơn có giảm giá (đã trừ Quỹ) nhưng chưa ghi Cọc (${formatMonthKeyVN(selectedMonthKey)})`}
                    {voucherLedgerMode === 'no_discount' &&
                      `Đơn không phát sinh giảm giá ≥ 1.000đ — Không trừ quỹ (${formatMonthKeyVN(selectedMonthKey)})`}
                    {voucherLedgerMode === 'all_audit' &&
                      `Bảng đối soát chi tiết toàn bộ hóa đơn (${formatMonthKeyVN(selectedMonthKey)})`}
                  </h2>
                  <div className="text-xs text-slate-500 num-clean">
                    Hiển thị {filteredVoucherLedger.length} /{' '}
                    {activeLedgerSource.length} hóa đơn · Mọi khoản giảm khách từ
                    1.000đ trở lên tự động tính trừ vào Quỹ Voucher
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative min-w-[220px] sm:w-64">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={voucherSearchQuery}
                      onChange={(e) => setVoucherSearchQuery(e.target.value)}
                      placeholder="Tìm KH, SĐT, mã đơn, số tiền giảm..."
                      className="w-full h-9 pl-9 pr-8 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-[#4887EE]"
                    />
                    {voucherSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setVoucherSearchQuery('')}
                        aria-label="Xóa tìm kiếm"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={onCreateNewInvoice}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span>Lên bill mới</span>
                  </button>
                </div>
              </div>

              {/* 4-Mode Reconciliation Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit max-w-full overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setVoucherLedgerMode('qualified')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                    voucherLedgerMode === 'qualified'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Đã trừ Quỹ ≥ 1k ({monthlyVoucherStats.qualifiedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setVoucherLedgerMode('discounted_no_coc')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                    voucherLedgerMode === 'discounted_no_coc'
                      ? 'bg-white text-amber-800 shadow-sm'
                      : monthlyVoucherStats.discountedWithoutCocCount > 0
                        ? 'text-amber-800 hover:text-amber-950'
                        : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Đơn giảm chưa Cọc (
                  {monthlyVoucherStats.discountedWithoutCocCount})
                </button>
                <button
                  type="button"
                  onClick={() => setVoucherLedgerMode('no_discount')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                    voucherLedgerMode === 'no_discount'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Không giảm giá ({monthlyVoucherStats.noDiscountCount})
                </button>
                <button
                  type="button"
                  onClick={() => setVoucherLedgerMode('all_audit')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                    voucherLedgerMode === 'all_audit'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Đối soát tất cả ({monthlyVoucherStats.allMonthInvoicesCount})
                </button>
              </div>
            </div>

            {filteredVoucherLedger.length === 0 ? (
              <div className="p-8 sm:p-10 text-center space-y-3">
                <div className="text-sm font-semibold text-slate-800">
                  {voucherSearchQuery.trim()
                    ? 'Không tìm thấy hóa đơn khớp từ khóa đối soát'
                    : voucherLedgerMode === 'qualified'
                      ? `Chưa có hóa đơn nào phát sinh giảm giá từ 1.000đ trong ${formatMonthKeyVN(selectedMonthKey)}`
                      : voucherLedgerMode === 'discounted_no_coc'
                        ? `Không có đơn giảm giá nào đang thiếu Cọc trong ${formatMonthKeyVN(selectedMonthKey)}`
                        : voucherLedgerMode === 'no_discount'
                          ? `Không có hóa đơn không giảm giá trong ${formatMonthKeyVN(selectedMonthKey)}`
                          : `Chưa có hóa đơn nào được lưu trong ${formatMonthKeyVN(selectedMonthKey)}`}
                </div>
                <p className="text-xs sm:text-sm text-slate-500 max-w-xl mx-auto leading-relaxed num-clean">
                  {voucherSearchQuery.trim()
                    ? 'Thử tìm bằng tên khách hàng, số điện thoại, mã hóa đơn hoặc xóa bộ lọc tìm kiếm.'
                    : voucherLedgerMode === 'qualified'
                      ? `Quỹ Voucher hiện còn ${formatVND(monthlyVoucherStats.remainingBudget)}. Bất cứ khi nào hóa đơn phát sinh giảm khách từ 1.000đ trở lên, hệ thống tự động trừ đúng số tiền giảm đó vào Quỹ Voucher.`
                      : 'Hệ thống đã tự động kiểm tra toàn bộ mục Tiền giảm, Dòng sản phẩm, Ghi chú và trạng thái Cọc trên từng hóa đơn.'}
                </p>
                {!voucherSearchQuery.trim() &&
                  voucherLedgerMode === 'qualified' && (
                    <div className="pt-1 flex flex-wrap items-center justify-center gap-2">
                      {monthlyVoucherStats.allMonthInvoicesCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setVoucherLedgerMode('all_audit')}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean"
                        >
                          <span>
                            Đối soát tất cả (
                            {monthlyVoucherStats.allMonthInvoicesCount})
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={onCreateNewInvoice}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Plus className="w-4 h-4 shrink-0" />
                        <span>Tạo phiếu báo giá</span>
                      </button>
                    </div>
                  )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4 whitespace-nowrap">
                        Mã đơn & Ngày lên bill
                      </th>
                      <th className="py-3 px-4 whitespace-nowrap">
                        Khách hàng & SĐT
                      </th>
                      <th className="py-3 px-4 whitespace-nowrap">
                        Trạng thái đơn
                      </th>
                      <th className="py-3 px-4 whitespace-nowrap">
                        Đối soát Cọc
                      </th>
                      <th className="py-3 px-4 whitespace-nowrap">
                        Phát sinh Giảm (≥ 1.000đ)
                      </th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">
                        Trừ Quỹ Voucher
                      </th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">
                        Quỹ còn lại
                      </th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">
                        Thao tác
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                    {filteredVoucherLedger.map(
                      ({
                        invoice,
                        audit,
                        remainingAfter,
                        exceededByAfter,
                      }) => {
                        const justMarked = justMarkedCocId === invoice.id;
                        return (
                          <tr
                            key={invoice.id}
                            className={`transition-colors ${
                              audit.hasValidDiscount &&
                              audit.isInAdvancedStageWithoutCoc
                                ? 'bg-amber-50/40 hover:bg-amber-50/70'
                                : 'hover:bg-slate-50/80'
                            }`}
                          >
                            <td className="py-3 px-4 align-middle num-clean whitespace-nowrap">
                              <div className="font-semibold text-slate-900">
                                {invoice.code}
                              </div>
                              <div className="text-xs text-slate-500">
                                {formatDateTimeVN(invoice.createdAt)} ·{' '}
                                {formatVND(invoice.totals?.subtotal ?? 0)}
                              </div>
                            </td>

                            <td className="py-3 px-4 align-middle">
                              <div className="font-semibold text-slate-900">
                                {invoice.customer.name || 'Khách lẻ'}
                              </div>
                              <div className="text-xs text-slate-500 num-clean">
                                {invoice.customer.phone || 'Chưa ghi SĐT'}
                              </div>
                            </td>

                            <td className="py-3 px-4 align-middle whitespace-nowrap text-xs">
                              <div
                                className={`font-semibold ${
                                  invoice.reportStage === 'coc'
                                    ? 'text-emerald-700'
                                    : 'text-slate-700'
                                }`}
                              >
                                {getReportStageLabel(invoice.reportStage)}
                              </div>
                              {audit.isInAdvancedStageWithoutCoc && (
                                <div className="text-[11px] font-medium text-amber-700">
                                  Đã chốt bước sau · Kiểm tra Cọc
                                </div>
                              )}
                            </td>

                            <td className="py-3 px-4 align-middle text-xs num-clean max-w-[210px]">
                              {audit.isCoc ? (
                                <span className="font-semibold text-emerald-700">
                                  {audit.cocReasons.join(' · ')}
                                </span>
                              ) : (
                                <span className="text-slate-500 font-medium">
                                  Chưa để Cọc · 0đ
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-4 align-middle text-xs num-clean max-w-[230px]">
                              {audit.hasValidDiscount ? (
                                <span className="font-semibold text-rose-700">
                                  {audit.discountReasons.join(' · ')}
                                </span>
                              ) : audit.hasSubThresholdDiscount ? (
                                <span className="text-amber-800 font-medium">
                                  Đang giảm {formatVND(audit.rawDiscountAmount)}{' '}
                                  (&lt; 1.000đ)
                                </span>
                              ) : (
                                <span className="text-slate-400">
                                  Không giảm giá
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-4 align-middle text-right num-clean whitespace-nowrap">
                              {audit.isQualifiedVoucher ? (
                                <span className="font-bold text-rose-600">
                                  -{formatVND(audit.voucherDeductAmount)}
                                </span>
                              ) : (
                                <span className="text-xs font-medium text-slate-400">
                                  0đ
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-4 align-middle text-right num-clean whitespace-nowrap">
                              {audit.isQualifiedVoucher ? (
                                <>
                                  <div className="font-bold text-[#3674DC]">
                                    {formatVND(remainingAfter)}
                                  </div>
                                  {exceededByAfter > 0 && (
                                    <div className="text-[11px] text-rose-600">
                                      Vượt {formatVND(exceededByAfter)}
                                    </div>
                                  )}
                                </>
                              ) : audit.hasSubThresholdDiscount ? (
                                <span className="text-xs font-medium text-amber-700">
                                  Nhỏ hơn 1.000đ
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400">
                                  Không trừ quỹ
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-4 align-middle text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                {(!audit.isCoc || justMarked) && (
                                  <button
                                    type="button"
                                    onClick={() => handleQuickMarkCoc(invoice)}
                                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-md border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                                      justMarked
                                        ? 'bg-emerald-600 text-white border-emerald-600'
                                        : 'text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border-emerald-300'
                                    }`}
                                  >
                                    {justMarked && (
                                      <Check className="w-3.5 h-3.5 shrink-0" />
                                    )}
                                    <span>
                                      {justMarked ? 'Đã để Cọc' : 'Để là Cọc'}
                                    </span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => onViewInvoice(invoice)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                                >
                                  <Eye className="w-3.5 h-3.5 shrink-0" />
                                  <span>Xem</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onEditInvoice(invoice)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#3674DC] bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                                >
                                  <Pencil className="w-3.5 h-3.5 shrink-0" />
                                  <span>Sửa</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: DATE KH (Tên KH & Số điện thoại) */}
      {activeSubTab === 'customers' && (
        <div className="space-y-6">
          {/* Add / Edit Customer Contact Form */}
          <form
            onSubmit={handleSubmitCustomerForm}
            className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <h2 className="text-base font-bold text-slate-900">
                  {editingCustomerId
                    ? 'Cập nhật thông tin Khách Hàng'
                    : 'Thêm Khách Hàng vào Date KH'}
                </h2>
                <p className="text-xs text-slate-500">
                  Lưu thông tin Tên KH và Số điện thoại để chăm sóc, theo dõi lịch hẹn và tạo nhanh phiếu đặt hàng.
                </p>
              </div>

              {editingCustomerId && (
                <button
                  type="button"
                  onClick={resetCustomerForm}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <X className="w-3.5 h-3.5 shrink-0" />
                  <span>Hủy chỉnh sửa</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-3 space-y-1.5">
                <label
                  htmlFor="datekh-name"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Tên KH <span className="text-rose-600">*</span>
                </label>
                <input
                  id="datekh-name"
                  type="text"
                  maxLength={120}
                  value={custNameInput}
                  onChange={(e) => setCustNameInput(e.target.value)}
                  placeholder="VD: Chị Lan Trà Sữa"
                  className="w-full h-9 px-3 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#4887EE]"
                />
              </div>

              <div className="sm:col-span-3 space-y-1.5">
                <label
                  htmlFor="datekh-phone"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Số điện thoại <span className="text-rose-600">*</span>
                </label>
                <input
                  id="datekh-phone"
                  type="tel"
                  maxLength={30}
                  value={custPhoneInput}
                  onChange={(e) => setCustPhoneInput(e.target.value)}
                  placeholder="VD: 0909 123 456"
                  className="w-full h-9 px-3 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#4887EE] num-clean"
                />
              </div>

              <div className="sm:col-span-2 space-y-1.5">
                <label
                  htmlFor="datekh-date"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Date KH (Ngày)
                </label>
                <input
                  id="datekh-date"
                  type="date"
                  value={custDateInput}
                  onChange={(e) => setCustDateInput(e.target.value)}
                  className="w-full h-9 px-2.5 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#4887EE] num-clean"
                />
              </div>

              <div className="sm:col-span-2 space-y-1.5">
                <label
                  htmlFor="datekh-note"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Ghi chú
                </label>
                <input
                  id="datekh-note"
                  type="text"
                  maxLength={500}
                  value={custNoteInput}
                  onChange={(e) => setCustNoteInput(e.target.value)}
                  placeholder="Khách đặt tem..."
                  className="w-full h-9 px-3 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#4887EE]"
                />
              </div>

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className={`w-full h-9 px-4 text-xs sm:text-sm font-semibold rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    customerSavedFlash
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[#4887EE] hover:bg-[#3674DC] text-white'
                  }`}
                >
                  {customerSavedFlash ? (
                    <>
                      <Check className="w-4 h-4 shrink-0" />
                      <span>Đã lưu KH</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 shrink-0" />
                      <span>
                        {editingCustomerId ? 'Cập nhật KH' : 'Lưu KH'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {customerFormError && (
              <div className="text-xs font-semibold text-rose-600">
                {customerFormError}
              </div>
            )}
          </form>

          {/* Customer Directory Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-slate-900">
                  Danh bạ Date KH (Số điện thoại & Tên KH)
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 num-clean">
                  <span>Hiển thị {filteredCustomers.length} khách hàng</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Tự động đồng bộ cả khách nhập tay và khách đã lên bill
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* Filter Segmented Control */}
                <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setCustomerFilterMode('all')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                      customerFilterMode === 'all'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tất cả ({customerCounts.total})
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomerFilterMode('with_bills')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                      customerFilterMode === 'with_bills'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Đã lên bill ({customerCounts.withBills})
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomerFilterMode('without_bills')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                      customerFilterMode === 'without_bills'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Chưa lên bill ({customerCounts.withoutBills})
                  </button>
                </div>

                {/* Search Input */}
                <div className="relative min-w-[220px] sm:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={customerSearchQuery}
                    onChange={(e) => setCustomerSearchQuery(e.target.value)}
                    placeholder="Tìm tên KH hoặc SĐT..."
                    className="w-full h-9 pl-9 pr-8 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-[#4887EE]"
                  />
                  {customerSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setCustomerSearchQuery('')}
                      aria-label="Xóa tìm kiếm"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {filteredCustomers.length === 0 ? (
              <div className="p-8 sm:p-10 text-center space-y-2">
                <div className="text-sm font-semibold text-slate-800">
                  {mergedCustomers.length === 0
                    ? 'Chưa có thông tin khách hàng trong Date KH'
                    : 'Không tìm thấy khách hàng phù hợp'}
                </div>
                <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
                  {mergedCustomers.length === 0
                    ? 'Nhập Tên KH và Số điện thoại ở biểu mẫu phía trên hoặc lưu phiếu báo giá có thông tin khách để hệ thống tự động cập nhật.'
                    : 'Thử thay đổi bộ lọc hoặc kiểm tra lại số điện thoại / tên khách hàng.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4 whitespace-nowrap">Tên KH</th>
                      <th className="py-3 px-4 whitespace-nowrap">
                        Số điện thoại
                      </th>
                      <th className="py-3 px-4 whitespace-nowrap">Date KH</th>
                      <th className="py-3 px-4 whitespace-nowrap">
                        Lịch sử bill
                      </th>
                      <th className="py-3 px-4 whitespace-nowrap">Ghi chú</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">
                        Thao tác
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                    {filteredCustomers.map((row) => {
                      const isCopied = copiedPhoneKey === row.key;
                      const formattedDate = row.customerDate
                        ? /^\d{4}-\d{2}-\d{2}$/.test(row.customerDate)
                          ? formatISODateVN(row.customerDate)
                          : formatDateOnlyVN(row.customerDate)
                        : '—';

                      return (
                        <tr
                          key={row.key}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="py-3 px-4 align-middle font-semibold text-slate-900">
                            {row.name}
                          </td>

                          <td className="py-3 px-4 align-middle whitespace-nowrap num-clean">
                            {row.phone ? (
                              <div className="inline-flex items-center gap-2">
                                <span className="font-semibold text-slate-800">
                                  {row.phone}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleCopyPhone(row.key, row.phone)
                                  }
                                  title="Sao chép số điện thoại"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                                >
                                  {isCopied ? (
                                    <>
                                      <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                                      <span className="text-emerald-700">
                                        Đã chép
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3 h-3 shrink-0" />
                                      <span>Chép</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-400">
                                Chưa có SĐT
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 align-middle text-slate-600 whitespace-nowrap num-clean">
                            {formattedDate}
                          </td>

                          <td className="py-3 px-4 align-middle whitespace-nowrap text-xs text-slate-600 num-clean">
                            {row.invoiceCount > 0 ? (
                              <span>
                                <strong className="font-semibold text-slate-900">
                                  {row.invoiceCount} bill
                                </strong>{' '}
                                ·{' '}
                                {row.depositedInvoiceCount > 0
                                  ? `${row.depositedInvoiceCount} đã cọc`
                                  : 'Chưa cọc'}{' '}
                                · {formatVND(row.totalSpent)}
                              </span>
                            ) : (
                              <span className="text-slate-400">
                                Chưa lên bill
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 align-middle text-xs text-slate-600 max-w-[240px] truncate">
                            {row.note || '—'}
                          </td>

                          <td className="py-3 px-4 align-middle text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  onCreateInvoiceForCustomer(
                                    row.name,
                                    row.phone
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <FilePlus2 className="w-3.5 h-3.5 shrink-0" />
                                <span>Lên bill</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleStartEditCustomerRow(row)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <Pencil className="w-3.5 h-3.5 shrink-0" />
                                <span>Sửa</span>
                              </button>

                              {row.storedRecord &&
                                (confirmDeleteId === row.storedRecord.id ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onDeleteCustomer(row.storedRecord!.id);
                                        setConfirmDeleteId(null);
                                      }}
                                      className="px-2.5 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                                    >
                                      Xác nhận xóa
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteId(null)}
                                      className="px-2 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                                    >
                                      Hủy
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirmDeleteId(row.storedRecord!.id)
                                    }
                                    aria-label={`Xóa khách hàng ${row.name}`}
                                    className="inline-flex items-center justify-center p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer shrink-0"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

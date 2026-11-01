import {
  getReportStageLabel,
  REPORT_STAGE_OPTIONS,
} from '../constants/reportStages';
import { DEFAULT_MONTHLY_VOUCHER_BUDGET } from '../services/planStorage';
import { reconcileInvoicesIntoRevenueEntries } from '../services/revenueStorage';
import {
  AccountSession,
  AiOrderAction,
  AppTab,
  CustomerContact,
  CustomerInfo,
  InventoryAlert,
  InventoryItem,
  Product,
  QuoteItem,
  QuoteTotals,
  ReportStage,
  RevenueEntry,
  SavedInvoice,
  StoreSettings,
  VoucherBudget,
} from '../types';
import {
  formatDateOnlyVN,
  formatISODateVN,
  formatVND,
  getLocalISODate,
} from './formatters';
import {
  countDistinctCustomersInEntries,
  countDistinctOrdersInEntries,
  getCollectedCashAmount,
  getCurrentMonthKeyLocal,
  getInvoiceRemainingPaidDate,
  getMonthDateRangeVN,
  getRevenueEntryPaymentBadge,
  getUncollectedRemainingAmount,
  isInvoiceRemainingSettled,
  isoTimestampToLocalOrderDate,
  isSuccessfulOrderForRevenue,
  shiftMonthKey,
  splitInvoiceRevenue,
  stripStagePrefixFromRevenueNote,
} from './revenueSplit';
import {
  auditInvoiceVoucher,
  MIN_VOUCHER_DISCOUNT_AMOUNT,
} from './voucherAudit';

export const TAB_LABELS: Record<AppTab, string> = {
  [AppTab.WORKSPACE]: 'Chọn & Báo giá',
  [AppTab.SAVED]: 'Báo giá đã lưu',
  [AppTab.REPORTS]: 'Báo cáo (Doanh thu & Phân loại tiến độ khách)',
  [AppTab.PLAN]: 'Kế Hoạch (Quỹ Voucher & Date Khách hàng)',
  [AppTab.INVENTORY]: 'Kho hàng & Bảng sản phẩm cần đặt',
  [AppTab.INVOICE]: 'Xem bản in',
  [AppTab.CATALOG]: 'Sửa bảng giá',
  [AppTab.SETTINGS]: 'Cài đặt chung',
};

export function hasMeaningfulOrderChanges(
  action: AiOrderAction | undefined | null
): boolean {
  if (!action || action.actionType === 'NONE') return false;
  return (
    action.itemsToAdd.length > 0 ||
    action.discountAmount >= 0 ||
    action.shippingFee >= 0 ||
    action.depositAmount >= 0 ||
    typeof action.markRemainingPaid === 'boolean' ||
    Boolean(action.customerName.trim()) ||
    Boolean(action.customerPhone.trim()) ||
    Boolean(action.reportStage.trim())
  );
}

export interface FullWebContextInput {
  accountSession: AccountSession;
  activeTab: AppTab;
  store: StoreSettings;
  hasLogo: boolean;
  hasSignature: boolean;
  products: Product[];
  editingInvoiceId: string | null;
  editingInvoiceCode: string | null;
  createdAt: string;
  expectedDemoDate: string;
  customer: CustomerInfo;
  quoteItems: QuoteItem[];
  totals: QuoteTotals;
  designIllustration: string;
  invoiceNote: string;
  draftInvoiceStage: ReportStage | '';
  draftRemainingPaid?: boolean;
  draftRemainingPaidAt?: string;
  savedInvoices: SavedInvoice[];
  revenueEntries: RevenueEntry[];
  voucherBudgets: VoucherBudget[];
  workspaceCustomers: CustomerContact[];
  inventoryItems: InventoryItem[];
  inventoryAlerts: InventoryAlert[];
  pendingProposal?: AiOrderAction | null;
  latestUserQuery?: string;
  recentMessages?: { role: 'user' | 'model'; text: string }[];
  verifiedQueryBrief?: string;
}

export interface RevenueWindowStats {
  customerCount: number;
  orderCount: number;
  designAmount: number;
  printAmount: number;
  totalRevenue: number;
  entries: RevenueEntry[];
  totalInvoicesCount: number;
  successfulInvoicesCount: number;
  pendingInvoicesCount: number;
  pendingNetAmount: number;
  pendingInvoices: SavedInvoice[];
  matchedInvoices: SavedInvoice[];
  subtotalSum: number;
  netOrderSum: number;
  depositSum: number;
  collectedCashSum: number;
  remainingSum: number;
  voucherDeductSum: number;
  voucherDeductCount: number;
}

export interface PipelineWindowStats {
  totalCount: number;
  classifiedCount: number;
  unclassifiedCount: number;
  stageCounts: Record<ReportStage, number>;
  subtotal: number;
  netOrderTotal: number;
  depositTotal: number;
  collectedTotal: number;
  remainingTotal: number;
  totalQuantity: number;
  matchedInvoices: SavedInvoice[];
}

export interface VoucherMonthStats {
  monthKey: string;
  monthLabel: string;
  budgetAmount: number;
  allMonthInvoicesCount: number;
  qualifiedCount: number;
  totalUsedDiscount: number;
  remainingBudget: number;
  overBudgetAmount: number;
  discountedWithoutCocCount: number;
  qualifiedOrders: {
    invoice: SavedInvoice;
    deductAmount: number;
    isCoc: boolean;
    orderDate: string;
  }[];
  discountedWithoutCocOrders: {
    invoice: SavedInvoice;
    deductAmount: number;
    stageLabel: string;
    orderDate: string;
  }[];
}

export interface MergedWorkspaceCustomer {
  key: string;
  name: string;
  phone: string;
  customerDate: string;
  note: string;
  hasStoredContact: boolean;
  invoiceCount: number;
  depositedInvoiceCount: number;
  totalSpent: number;
  totalDiscountReceived: number;
  latestActivityAt: string;
}

function normalizePhoneDigitsLocal(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

/**
 * Reconciles savedInvoices + products + revenueEntries synchronously in memory
 * so the AI assistant is 100% in sync with MonthlyRevenueSection even 0ms after an edit.
 */
export function getSynchronizedActiveRevenueEntries(
  input: Pick<
    FullWebContextInput,
    'savedInvoices' | 'products' | 'revenueEntries' | 'store'
  >
): RevenueEntry[] {
  const { nextEntries } = reconcileInvoicesIntoRevenueEntries(
    input.savedInvoices,
    input.products,
    input.revenueEntries,
    input.store.footerNote
  );
  return nextEntries.filter((e) => !e.isDeleted);
}

/**
 * Computes exact revenue & saved-invoice reconciliation for any date filter
 * (Today, Yesterday, 7 Days, Specific Date, Specific Month, or All-Time).
 */
export function computeRevenueWindowStats(
  activeRevEntries: RevenueEntry[],
  savedInvoices: SavedInvoice[],
  products: Product[],
  storeFooterNote: string,
  matchDateFn: (isoDate: string) => boolean
): RevenueWindowStats {
  const matchedRev = activeRevEntries.filter((e) => matchDateFn(e.orderDate));
  let designAmount = 0;
  let printAmount = 0;
  let totalRevenue = 0;
  for (const e of matchedRev) {
    designAmount += e.designAmount;
    printAmount += e.printAmount;
    totalRevenue += e.totalRevenue;
  }

  const matchedInvoices = savedInvoices.filter((inv) =>
    matchDateFn(isoTimestampToLocalOrderDate(inv.createdAt))
  );

  const pendingInvoices: SavedInvoice[] = [];
  let successfulInvoicesCount = 0;
  let pendingNetAmount = 0;
  let subtotalSum = 0;
  let netOrderSum = 0;
  let depositSum = 0;
  let collectedCashSum = 0;
  let remainingSum = 0;
  let voucherDeductSum = 0;
  let voucherDeductCount = 0;

  for (const inv of matchedInvoices) {
    const sub = inv.totals?.subtotal ?? 0;
    const disc = inv.totals?.discountAmount ?? inv.discountAmount ?? 0;
    const ship = inv.totals?.shippingFee ?? inv.shippingFee ?? 0;
    const dep = inv.totals?.depositAmount ?? inv.depositAmount ?? 0;

    subtotalSum += sub;
    netOrderSum += Math.max(0, sub - disc) + ship;
    depositSum += dep;
    collectedCashSum += getCollectedCashAmount(inv);
    remainingSum += getUncollectedRemainingAmount(inv);

    const audit = auditInvoiceVoucher(inv, storeFooterNote);
    if (audit.isQualifiedVoucher) {
      voucherDeductCount += 1;
      voucherDeductSum += audit.voucherDeductAmount;
    }

    if (isSuccessfulOrderForRevenue(inv, storeFooterNote)) {
      successfulInvoicesCount += 1;
    } else {
      pendingInvoices.push(inv);
      pendingNetAmount += splitInvoiceRevenue(inv, products).totalRevenue;
    }
  }

  return {
    customerCount: countDistinctCustomersInEntries(matchedRev),
    orderCount: countDistinctOrdersInEntries(matchedRev),
    designAmount,
    printAmount,
    totalRevenue,
    entries: matchedRev,
    totalInvoicesCount: matchedInvoices.length,
    successfulInvoicesCount,
    pendingInvoicesCount: pendingInvoices.length,
    pendingNetAmount,
    pendingInvoices,
    matchedInvoices,
    subtotalSum,
    netOrderSum,
    depositSum,
    collectedCashSum,
    remainingSum,
    voucherDeductSum,
    voucherDeductCount,
  };
}

/**
 * Matches ReportsView.tsx pipeline stage counts and financial summary 100%.
 */
export function computePipelineWindowStats(
  savedInvoices: SavedInvoice[],
  matchDateFn: (isoDate: string) => boolean
): PipelineWindowStats {
  const matchedInvoices = savedInvoices.filter((inv) =>
    matchDateFn(isoTimestampToLocalOrderDate(inv.createdAt))
  );

  const stageCounts: Record<ReportStage, number> = {
    bao_gia: 0,
    cham_soc: 0,
    coc: 0,
    chot_in: 0,
    chot_thiet_ke: 0,
    hoan_thanh: 0,
  };
  let classifiedCount = 0;
  let unclassifiedCount = 0;
  let subtotal = 0;
  let netOrderTotal = 0;
  let depositTotal = 0;
  let collectedTotal = 0;
  let remainingTotal = 0;
  let totalQuantity = 0;

  for (const inv of matchedInvoices) {
    const st = inv.reportStage || '';
    if (st && st in stageCounts) {
      stageCounts[st as ReportStage] += 1;
      classifiedCount += 1;
    } else {
      unclassifiedCount += 1;
    }

    const sub = inv.totals?.subtotal ?? 0;
    const disc = inv.totals?.discountAmount ?? inv.discountAmount ?? 0;
    const ship = inv.totals?.shippingFee ?? inv.shippingFee ?? 0;
    const dep = inv.totals?.depositAmount ?? inv.depositAmount ?? 0;
    const qty = inv.totals?.totalQuantity ?? 0;

    subtotal += sub;
    netOrderTotal += Math.max(0, sub - disc) + ship;
    depositTotal += dep;
    collectedTotal += getCollectedCashAmount(inv);
    remainingTotal += getUncollectedRemainingAmount(inv);
    totalQuantity += qty;
  }

  return {
    totalCount: matchedInvoices.length,
    classifiedCount,
    unclassifiedCount,
    stageCounts,
    subtotal,
    netOrderTotal,
    depositTotal,
    collectedTotal,
    remainingTotal,
    totalQuantity,
    matchedInvoices,
  };
}

/**
 * Matches PlanView.tsx monthlyVoucherStats 100% (deducts any discount >= 1.000đ).
 */
export function computeVoucherMonthStats(
  savedInvoices: SavedInvoice[],
  voucherBudgets: VoucherBudget[],
  storeFooterNote: string,
  monthKey: string
): VoucherMonthStats {
  const budgetObj = voucherBudgets.find((b) => b.monthKey === monthKey);
  const budgetAmount = budgetObj
    ? budgetObj.budgetAmount
    : DEFAULT_MONTHLY_VOUCHER_BUDGET;
  const range = getMonthDateRangeVN(monthKey);

  const monthInvoices = savedInvoices.filter(
    (inv) => isoTimestampToLocalOrderDate(inv.createdAt).slice(0, 7) === monthKey
  );

  let totalUsedDiscount = 0;
  const qualifiedOrders: VoucherMonthStats['qualifiedOrders'] = [];
  const discountedWithoutCocOrders: VoucherMonthStats['discountedWithoutCocOrders'] =
    [];

  const sortedNewest = [...monthInvoices].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  for (const inv of sortedNewest) {
    const audit = auditInvoiceVoucher(inv, storeFooterNote);
    const orderDate = isoTimestampToLocalOrderDate(inv.createdAt);
    if (audit.isQualifiedVoucher) {
      totalUsedDiscount += audit.voucherDeductAmount;
      qualifiedOrders.push({
        invoice: inv,
        deductAmount: audit.voucherDeductAmount,
        isCoc: audit.isCoc,
        orderDate,
      });
      if (!audit.isCoc) {
        discountedWithoutCocOrders.push({
          invoice: inv,
          deductAmount: audit.voucherDeductAmount,
          stageLabel: getReportStageLabel(inv.reportStage),
          orderDate,
        });
      }
    }
  }

  return {
    monthKey,
    monthLabel: range.monthLabel,
    budgetAmount,
    allMonthInvoicesCount: monthInvoices.length,
    qualifiedCount: qualifiedOrders.length,
    totalUsedDiscount,
    remainingBudget: Math.max(0, budgetAmount - totalUsedDiscount),
    overBudgetAmount: Math.max(0, totalUsedDiscount - budgetAmount),
    discountedWithoutCocCount: discountedWithoutCocOrders.length,
    qualifiedOrders,
    discountedWithoutCocOrders,
  };
}

/**
 * Matches PlanView.tsx mergedCustomers 100% (combines Date KH contacts + Saved Invoices).
 */
export function computeMergedCustomerDirectory(
  workspaceCustomers: CustomerContact[],
  savedInvoices: SavedInvoice[],
  storeFooterNote: string
): MergedWorkspaceCustomer[] {
  const byKey = new Map<string, MergedWorkspaceCustomer>();
  const phoneKeyMap = new Map<string, string>();

  for (const contact of workspaceCustomers) {
    const digits = normalizePhoneDigitsLocal(contact.phone);
    const rowKey = digits.length >= 6 ? `ph_${digits}` : `id_${contact.id}`;
    if (digits.length >= 6) {
      phoneKeyMap.set(digits, rowKey);
    }
    byKey.set(rowKey, {
      key: rowKey,
      name: contact.name,
      phone: contact.phone,
      customerDate: contact.customerDate,
      note: contact.note,
      hasStoredContact: true,
      invoiceCount: 0,
      depositedInvoiceCount: 0,
      totalSpent: 0,
      totalDiscountReceived: 0,
      latestActivityAt: contact.updatedAt || contact.createdAt,
    });
  }

  const sortedInvoices = [...savedInvoices].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  for (const inv of sortedInvoices) {
    const rawName = (inv.customer.name || '').trim();
    const rawPhone = (inv.customer.phone || '').trim();
    if (!rawName && !rawPhone) continue;

    const digits = normalizePhoneDigitsLocal(rawPhone);
    let rowKey = '';
    if (digits.length >= 6) {
      rowKey = phoneKeyMap.get(digits) || `ph_${digits}`;
      phoneKeyMap.set(digits, rowKey);
    } else {
      rowKey = `name_${rawName.toLowerCase()}`;
    }

    const audit = auditInvoiceVoucher(inv, storeFooterNote);
    const orderValue = Math.max(
      0,
      (inv.totals?.subtotal ?? 0) -
        (inv.totals?.discountAmount ?? inv.discountAmount ?? 0) +
        (inv.totals?.shippingFee ?? inv.shippingFee ?? 0)
    );
    const disc = audit.isQualifiedVoucher
      ? audit.voucherDeductAmount
      : audit.rawDiscountAmount;
    const invDateISO = isoTimestampToLocalOrderDate(inv.createdAt);

    const existing = byKey.get(rowKey);
    if (existing) {
      existing.invoiceCount += 1;
      if (audit.isCoc) existing.depositedInvoiceCount += 1;
      existing.totalSpent += orderValue;
      existing.totalDiscountReceived += disc;
      if (!existing.name && rawName) existing.name = rawName;
      if (!existing.phone && rawPhone) existing.phone = rawPhone;
      if (!existing.customerDate) existing.customerDate = invDateISO;
      if (
        new Date(inv.createdAt).getTime() >
        new Date(existing.latestActivityAt).getTime()
      ) {
        existing.latestActivityAt = inv.createdAt;
      }
    } else {
      byKey.set(rowKey, {
        key: rowKey,
        name: rawName || 'Khách hàng',
        phone: rawPhone,
        customerDate: invDateISO,
        note: '',
        hasStoredContact: false,
        invoiceCount: 1,
        depositedInvoiceCount: audit.isCoc ? 1 : 0,
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
}

export function buildFullWebContextSummary(input: FullWebContextInput): string {
  const {
    accountSession,
    activeTab,
    store,
    hasLogo,
    hasSignature,
    products,
    editingInvoiceId,
    editingInvoiceCode,
    createdAt,
    expectedDemoDate,
    customer,
    quoteItems,
    totals,
    designIllustration,
    invoiceNote,
    draftInvoiceStage,
    draftRemainingPaid,
    draftRemainingPaidAt,
    savedInvoices,
    voucherBudgets,
    workspaceCustomers,
    inventoryItems,
    inventoryAlerts,
    pendingProposal,
    verifiedQueryBrief,
  } = input;

  const todayISO = getLocalISODate(0);
  const yesterdayISO = getLocalISODate(-1);
  const sevenDaysStartISO = getLocalISODate(-6);
  const currentMonthKey = getCurrentMonthKeyLocal();
  const prevMonthKey = shiftMonthKey(currentMonthKey, -1);
  const currentMonthRange = getMonthDateRangeVN(currentMonthKey);
  const prevMonthRange = getMonthDateRangeVN(prevMonthKey);

  // Synchronized live revenue entries
  const activeRevEntries = getSynchronizedActiveRevenueEntries(input);

  // Pre-compute exact revenue windows
  const revToday = computeRevenueWindowStats(
    activeRevEntries,
    savedInvoices,
    products,
    store.footerNote,
    (d) => d === todayISO
  );
  const revYesterday = computeRevenueWindowStats(
    activeRevEntries,
    savedInvoices,
    products,
    store.footerNote,
    (d) => d === yesterdayISO
  );
  const rev7d = computeRevenueWindowStats(
    activeRevEntries,
    savedInvoices,
    products,
    store.footerNote,
    (d) => d >= sevenDaysStartISO && d <= todayISO
  );
  const revAllTime = computeRevenueWindowStats(
    activeRevEntries,
    savedInvoices,
    products,
    store.footerNote,
    () => true
  );

  // Pre-compute exact pipeline windows (matching ReportsView.tsx)
  const pipeToday = computePipelineWindowStats(
    savedInvoices,
    (d) => d === todayISO
  );
  const pipe7d = computePipelineWindowStats(
    savedInvoices,
    (d) => d >= sevenDaysStartISO && d <= todayISO
  );
  const pipeThisMonth = computePipelineWindowStats(
    savedInvoices,
    (d) => d.slice(0, 7) === currentMonthKey
  );
  const pipeAll = computePipelineWindowStats(savedInvoices, () => true);

  const verifiedSection = verifiedQueryBrief?.trim()
    ? [
        '=== 0. KẾT QUẢ ĐỐI SOÁT CHÍNH XÁC TỪ HỆ THỐNG CHO CÂU HỎI HIỆN TẠI (BẮT BUỘC DÙNG ĐÚNG SỐ LIỆU NÀY) ===',
        verifiedQueryBrief.trim(),
      ].join('\n')
    : '';

  const clockSection = [
    '=== MỐC THỜI GIAN ĐỒNG BỘ HỆ THỐNG HIỆN TẠI ===',
    `- Ngày hôm nay: ${formatISODateVN(todayISO)} (${todayISO})`,
    `- Ngày hôm qua: ${formatISODateVN(yesterdayISO)} (${yesterdayISO})`,
    `- 7 ngày gần nhất: ${formatISODateVN(sevenDaysStartISO)} – ${formatISODateVN(todayISO)}`,
    `- Tháng hiện tại: ${currentMonthRange.monthLabel} (${currentMonthKey}, ${currentMonthRange.rangeVN})`,
    `- Tháng trước: ${prevMonthRange.monthLabel} (${prevMonthKey}, ${prevMonthRange.rangeVN})`,
  ].join('\n');

  // 1. Company & Web Overview
  const companySection = [
    '=== 1. THÔNG TIN CÔNG TY / CỬA HÀNG (MỤC CÀI ĐẶT CHUNG) ===',
    `- Tên công ty / cửa hàng: ${store.companyName || 'ATD Color'}`,
    `- Địa chỉ: ${store.address || '(Chưa nhập)'}`,
    `- Số điện thoại / Zalo: ${store.phone || '(Chưa nhập)'}`,
    `- Email: ${store.email || '(Chưa nhập)'}`,
    `- TikTok: ${store.tiktok || '(Chưa nhập)'}`,
    `- Người lập báo giá: ${store.preparerName || '(Chưa nhập)'}`,
    `- Tiêu đề phiếu báo giá: ${store.invoiceTitle || 'PHIẾU ĐẶT HÀNG'}`,
    `- Trạng thái ảnh trên phiếu: Logo góc trái [${hasLogo ? 'Đã cài đặt' : 'Chưa tải ảnh'}], Chữ ký người lập [${hasSignature ? 'Đã cài đặt' : 'Chưa tải ảnh'}]`,
    `- Tiện ích bật/tắt trong Cài đặt chung: Máy tính [${store.showCalculator ? 'Đang mở' : 'Đang tắt'}], Hộp Chat AI [${store.showAiChat ? 'Đang mở' : 'Đang tắt'}]`,
    `- Tài khoản đang làm việc: ${accountSession.displayName} (@${accountSession.usernameKey})`,
    `- Mục lớn đang mở hiện tại trên màn hình: ${TAB_LABELS[activeTab]}`,
    `- Quy định & Ghi chú mặc định cuối hóa đơn:\n${store.footerNote || '(Trống)'}`,
  ].join('\n');

  const webArchitectureSection = [
    '=== 2. CẤU TRÚC 8 MỤC LỚN & QUY TẮC VẬN HÀNH TRÊN WEB ===',
    '1) Chọn & Báo giá (navigateTarget="workspace"): Có "Bảng giá in ấn gửi khách" (bấm Xem bảng giá mới hiện bảng kẻ ô gắn Logo góc trái để sao chép ảnh PNG gửi khách), 4 mục chọn sản phẩm (1. Ép nhựa - Plastic Giấy 300, 2. In Decal + Formex 5mm, 3. Thiết kế Menu/Poster, 4. Sản phẩm khác — chọn xong tự trở về để chọn thêm; mỗi lần chọn thêm tự tạo dòng mới bên dưới cuối đơn hàng chứ KHÔNG cộng dồn vào 1 món cũ), và cột STT trên đơn đặt hàng có nút "Copy" sao chép nguyên cả hàng xuống dưới.',
    '2) Báo giá đã lưu (navigateTarget="saved"): Lưu trữ đồng bộ đám mây tất cả báo giá/hóa đơn của khách, có mục tích "Đã thu phần còn lại" + chọn Ngày thu để xác nhận thanh toán Đợt 2.',
    '3) Báo cáo: Gồm 2 bảng con: (a) "Báo cáo doanh thu các tháng" (navigateTarget="reports_revenue") ghi nhận DOANH THU 2 GIAI ĐOẠN: Đợt 1 ghi nhận đúng số tiền cọc theo ngày cọc; Đợt 2 khi bấm xác nhận Hoàn thành (tích "Đã thu phần còn lại") vào ngày/tháng nào thì phần còn lại được tính vào doanh thu của đúng ngày/tháng đó (ví dụ đơn 300k cọc 150k ngày 31/10 và thanh toán phần còn lại 150k ngày 01/11 thì tháng 10 ghi nhận 150k, tháng 11 ghi nhận 150k), tách rõ Tiền thiết kế và Tiền in (đã trừ giảm giá, không tính phí ship, tuyệt đối không làm lẻ tiền); (b) "Tiến độ & Phân loại khách hàng" (navigateTarget="reports_pipeline") theo 6 giai đoạn (Báo giá, Chăm sóc, Cọc, Chốt in, Chốt thiết kế, Hoàn thành).',
    `4) Kế Hoạch: Gồm (a) "Quỹ Voucher tháng" (navigateTarget="plan_voucher") — QUY TẮC ĐỒNG BỘ: Bất kỳ hóa đơn nào phát sinh giảm khách từ ${formatVND(MIN_VOUCHER_DISCOUNT_AMOUNT)} trở lên (>= 1.000đ) đều tự động tính trừ thẳng đúng số tiền giảm đó vào Quỹ Voucher của tháng ngay lập tức; và (b) "Danh sách & Date Khách hàng" (navigateTarget="plan_customers") tự động hợp nhất khách lưu lịch hẹn và khách trên hóa đơn.`,
    '5) Kho hàng: Gồm 2 mục con "Quản lý tồn kho" (navigateTarget="inventory_stock") và "Bảng sản phẩm cần đặt" (navigateTarget="inventory_reorder", bảng 2 cột SẢN PHẨM ĐẶT và SỐ LƯỢNG ĐẶT, không có logo, không ghi quy đổi = tờ; giấy/nhựa/decal/formex tính là xấp, Màng BOBB bóng & Chống Sốc tính là cuộn, riêng Băng keo luôn tính là cây).',
    '6) Xem bản in (navigateTarget="invoice"), 7) Sửa bảng giá (navigateTarget="catalog"), 8) Cài đặt chung (navigateTarget="settings").',
  ].join('\n');

  // 3. Full Catalog with productId
  const catalogLines = products
    .slice(0, 80)
    .map(
      (p) =>
        `- [productId="${p.id}"] ${p.name} | Nhóm: ${p.category}${p.size ? ` | Khổ: ${p.size}` : ''}${p.sides ? ` | Mặt: ${p.sides}` : ''} | ĐVT: ${p.unit} | Giá: ${formatVND(p.price)} (${p.price})`
    );
  const catalogSection = [
    `=== 3. BẢNG GIÁ & DANH MỤC SẢN PHẨM (${products.length} sản phẩm) ===`,
    ...catalogLines,
    '- Ngoài ra có hạng mục tự chỉnh: Thiết kế Menu / Thiết kế Poster (ĐVT: Mẫu, giá tự điền theo độ khó), Phụ phí thiết kế / Phụ phí chỉnh sửa (ĐVT: Mục).',
  ].join('\n');

  // 4. Current Active Bill in Workspace
  const draftSettled = Boolean(
    draftRemainingPaid || draftInvoiceStage === 'hoan_thanh'
  );
  const activeDraftAudit = auditInvoiceVoucher(
    {
      reportStage: draftInvoiceStage,
      remainingPaid: draftSettled,
      discountAmount: totals.discountAmount,
      depositAmount: totals.depositAmount,
      totals,
      customer,
      items: quoteItems,
      designIllustration,
      invoiceNote,
    },
    store.footerNote
  );

  const activeItemsDesc =
    quoteItems.length > 0
      ? quoteItems
          .map(
            (item, idx) =>
              `  ${idx + 1}. ${item.name} — SL: ${item.quantity} ${item.unit} × ${formatVND(item.unitPrice)} = ${formatVND(item.quantity * item.unitPrice)}${item.note ? ` (Ghi chú: ${item.note})` : ''}`
          )
          .join('\n')
      : '  (Chưa có sản phẩm nào trên bill hiện tại)';

  const activeBillSection = [
    '=== 4. BILL / PHIẾU BÁO GIÁ ĐANG MỞ TRÊN MÀN HÌNH (CHỌN & BÁO GIÁ) ===',
    `- Trạng thái liên kết bill: ${editingInvoiceCode && editingInvoiceId ? `Đang liên kết đơn đã lưu ${editingInvoiceCode} (id="${editingInvoiceId}")` : 'Đang lập bill mới trên màn hình (chưa lưu thành mã đơn — khi xác nhận qua Chat sẽ tự động lưu & liên kết mã đơn)'}`,
    `- Khách hàng trên bill hiện tại: Tên="${customer.name || 'Khách lẻ (chưa điền tên)'}" | Mã KH="${customer.code || '(tự sinh khi lưu)'}" | SĐT="${customer.phone || '(chưa điền)'}"`,
    `- Ngày lập: ${formatDateOnlyVN(createdAt)} | Ngày nhận demo dự kiến: ${formatISODateVN(expectedDemoDate) || expectedDemoDate}`,
    `- Phân loại giai đoạn hiện tại: ${getReportStageLabel(draftInvoiceStage)} (${draftInvoiceStage || 'chưa chọn'}) | Thanh toán Đợt 2 (phần còn lại): ${draftSettled ? `Đã tích thu đủ (${formatISODateVN(draftRemainingPaidAt || todayISO)})` : `Chưa thu phần còn lại (${formatVND(totals.remainingAmount)})`}`,
    `- Mẫu thiết kế minh họa: ${designIllustration || '(Ẩn)'}`,
    `- Các sản phẩm đang có trên bill (${quoteItems.length} dòng, tổng SL ${totals.totalQuantity}):\n${activeItemsDesc}`,
    `- Thanh toán trên bill: Tổng đơn=${formatVND(totals.subtotal)} | Giảm giá=${formatVND(totals.discountAmount)} (${activeDraftAudit.isQualifiedVoucher ? `Trừ Quỹ Voucher -${formatVND(activeDraftAudit.voucherDeductAmount)}` : 'Không trừ Quỹ Voucher'}) | Phí ship=${formatVND(totals.shippingFee)} | Đã cọc Đợt 1=${formatVND(totals.depositAmount)} | CÒN PHẢI THU=${draftSettled ? '0đ (Đã tất toán)' : formatVND(totals.remainingAmount)}`,
    invoiceNote && invoiceNote !== store.footerNote
      ? `- Ghi chú riêng của bill: ${invoiceNote.slice(0, 400)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  // 5. Saved Invoices & Pipeline Stages (Exact Today / 7d / Month / All)
  const formatPipeBrief = (label: string, p: PipelineWindowStats) => {
    const stages = REPORT_STAGE_OPTIONS.map(
      (opt) => `${opt.label}: ${p.stageCounts[opt.value]}`
    ).join(', ');
    return `- ${label}: Tổng ${p.totalCount} phiếu (${stages}, Chưa phân loại: ${p.unclassifiedCount}) | Tiền hàng: ${formatVND(p.subtotal)} | Giá trị sau giảm+ship: ${formatVND(p.netOrderTotal)} | Đã thu khách: ${formatVND(p.collectedTotal)} (Cọc đợt 1: ${formatVND(p.depositTotal)}) | Còn phải thu: ${formatVND(p.remainingTotal)}`;
  };

  const recentSavedLines = savedInvoices.slice(0, 45).map((inv) => {
    const itemBrief = inv.items
      .slice(0, 4)
      .map((i) => `${i.name} x${i.quantity}`)
      .join(', ');
    const invAudit = auditInvoiceVoucher(inv, store.footerNote);
    const localOrderDate = isoTimestampToLocalOrderDate(inv.createdAt);
    const settled = isInvoiceRemainingSettled(inv);
    const uncollected = getUncollectedRemainingAmount(inv);
    const stage2Brief = settled
      ? `Đã tất toán (${formatISODateVN(getInvoiceRemainingPaidDate(inv))}), Còn phải thu: 0đ`
      : `Còn phải thu Đợt 2: ${formatVND(uncollected)}`;
    return `- [savedInvoiceId="${inv.id}"] Mã ${inv.code} | Ngày tạo ${formatISODateVN(localOrderDate)} (${localOrderDate}) | KH: ${inv.customer.name || 'Khách lẻ'}${inv.customer.phone ? ` (${inv.customer.phone})` : ''} | Giai đoạn: ${getReportStageLabel(inv.reportStage)} | SP: ${itemBrief} | Tổng: ${formatVND(inv.totals.subtotal)}, Giảm: ${formatVND(inv.totals.discountAmount)}${invAudit.isQualifiedVoucher ? ` (Trừ Quỹ -${formatVND(invAudit.voucherDeductAmount)})` : ''}, Ship: ${formatVND(inv.totals.shippingFee)}, Cọc Đợt 1: ${formatVND(inv.totals.depositAmount)}, ${stage2Brief}`;
  });

  const savedSection = [
    `=== 5. BÁO GIÁ ĐÃ LƯU & PHÂN LOẠI TIẾN ĐỘ KHÁCH HÀNG (ĐỒNG BỘ MỤC BÁO GIÁ ĐÃ LƯU & MỤC TIẾN ĐỘ) ===`,
    formatPipeBrief(`HÔM NAY (${formatISODateVN(todayISO)})`, pipeToday),
    formatPipeBrief('7 NGÀY GẦN NHẤT', pipe7d),
    formatPipeBrief(`THÁNG NÀY (${currentMonthKey})`, pipeThisMonth),
    formatPipeBrief('TẤT CẢ LŨY KẾ', pipeAll),
    'Danh sách các báo giá đã lưu gần nhất:',
    ...(recentSavedLines.length > 0
      ? recentSavedLines
      : ['- Chưa có báo giá nào được lưu.']),
  ].join('\n');

  // 6. Synchronized Daily / 7-Day / Monthly / All-Time Revenue Report
  const byMonth = new Map<string, RevenueEntry[]>();
  byMonth.set(currentMonthKey, []);
  for (const entry of activeRevEntries) {
    const list = byMonth.get(entry.monthKey) || [];
    list.push(entry);
    byMonth.set(entry.monthKey, list);
  }
  const sortedMonths = Array.from(byMonth.keys()).sort((a, b) =>
    b.localeCompare(a)
  );
  const monthlyRevLines = sortedMonths.slice(0, 12).map((mk) => {
    const list = byMonth.get(mk) || [];
    const range = getMonthDateRangeVN(mk);
    const custCount = countDistinctCustomersInEntries(list);
    const distinctOrders = countDistinctOrdersInEntries(list);
    const designSum = list.reduce((s, e) => s + e.designAmount, 0);
    const printSum = list.reduce((s, e) => s + e.printAmount, 0);
    const totalSum = list.reduce((s, e) => s + e.totalRevenue, 0);
    const countText =
      list.length > distinctOrders
        ? `${distinctOrders} đơn · ${list.length} đợt thu`
        : `${distinctOrders} đơn thành công`;
    return `- ${range.monthLabel} (${range.rangeVN}): ${custCount} khách đặt hàng (${countText}) | Tiền thiết kế: ${formatVND(designSum)} | Tiền in: ${formatVND(printSum)} | Tổng doanh thu tháng: ${formatVND(totalSum)}`;
  });

  const todayEntryLines =
    revToday.entries.length > 0
      ? revToday.entries.map(
          (e) =>
            `  + [${formatISODateVN(e.orderDate)}] [${getRevenueEntryPaymentBadge(e)}] Mã ${e.invoiceCode || 'Nhập tay'} | KH: ${e.customerName || 'Khách lẻ'}${e.customerPhone ? ` (${e.customerPhone})` : ''} | Thiết kế: ${formatVND(e.designAmount)} | In: ${formatVND(e.printAmount)} | Tổng: ${formatVND(e.totalRevenue)}`
        )
      : [
          `  + Hôm nay (${formatISODateVN(todayISO)}) chưa phát sinh khoản thu doanh thu nào trong Báo cáo doanh thu (Doanh thu hôm nay = 0đ).`,
        ];

  const recentRevEntryLines = activeRevEntries.slice(0, 35).map(
    (e) =>
      `  • Ngày ${formatISODateVN(e.orderDate)} (${e.orderDate}) | [${getRevenueEntryPaymentBadge(e)}] Mã ${e.invoiceCode || 'Nhập tay'} | KH: ${e.customerName || 'Khách lẻ'}${e.customerPhone ? ` (${e.customerPhone})` : ''} | Thiết kế: ${formatVND(e.designAmount)} | In: ${formatVND(e.printAmount)} | Tổng: ${formatVND(e.totalRevenue)}${stripStagePrefixFromRevenueNote(e.note) ? ` | Hạng mục: ${stripStagePrefixFromRevenueNote(e.note)}` : ''}`
  );

  const revenueSection = [
    `=== 6. BÁO CÁO DOANH THU ĐỒNG BỘ TRỰC TIẾP (2 GIAI ĐOẠN: ĐỢT 1 TIỀN CỌC THEO NGÀY CỌC + ĐỢT 2 PHẦN CÒN LẠI THEO NGÀY XÁC NHẬN HOÀN THÀNH / TÍCH ĐÃ THU) ===`,
    `* DOANH THU HÔM NAY (${formatISODateVN(todayISO)}): ${revToday.customerCount} khách đặt hàng (${revToday.orderCount} đơn · ${revToday.entries.length} đợt thu) | Tiền thiết kế: ${formatVND(revToday.designAmount)} | Tiền in: ${formatVND(revToday.printAmount)} | TỔNG DOANH THU HÔM NAY: ${formatVND(revToday.totalRevenue)}`,
    `  (Đối soát thêm phiếu lập hôm nay ${formatISODateVN(todayISO)}: Tổng ${revToday.totalInvoicesCount} phiếu đã lưu, gồm ${revToday.successfulInvoicesCount} đơn đã chốt/cọc và ${revToday.pendingInvoicesCount} phiếu đang ở Báo giá/Chăm sóc trị giá ${formatVND(revToday.pendingNetAmount)} chưa tính vào doanh thu; tiền cọc ghi nhận hôm nay: ${formatVND(revToday.depositSum)}, còn phải thu Đợt 2: ${formatVND(revToday.remainingSum)})`,
    '  Chi tiết các đợt thu doanh thu của HÔM NAY:',
    ...todayEntryLines,
    `* DOANH THU HÔM QUA (${formatISODateVN(yesterdayISO)}): ${revYesterday.customerCount} khách (${revYesterday.orderCount} đơn) | Tiền thiết kế: ${formatVND(revYesterday.designAmount)} | Tiền in: ${formatVND(revYesterday.printAmount)} | TỔNG DOANH THU HÔM QUA: ${formatVND(revYesterday.totalRevenue)}`,
    `* DOANH THU 7 NGÀY QUA (${formatISODateVN(sevenDaysStartISO)} – ${formatISODateVN(todayISO)}): ${rev7d.customerCount} khách (${rev7d.orderCount} đơn) | Tiền thiết kế: ${formatVND(rev7d.designAmount)} | Tiền in: ${formatVND(rev7d.printAmount)} | TỔNG DOANH THU 7 NGÀY: ${formatVND(rev7d.totalRevenue)}`,
    `* TỔNG LŨY KẾ TẤT CẢ CÁC THÁNG: ${revAllTime.customerCount} khách (${revAllTime.orderCount} đơn) | Tiền thiết kế: ${formatVND(revAllTime.designAmount)} | Tiền in: ${formatVND(revAllTime.printAmount)} | TỔNG LŨY KẾ: ${formatVND(revAllTime.totalRevenue)}`,
    'Bảng tổng hợp doanh thu theo từng tháng:',
    ...monthlyRevLines,
    ...(recentRevEntryLines.length > 0
      ? ['Chi tiết các dòng doanh thu gần nhất theo ngày:', ...recentRevEntryLines]
      : []),
  ].join('\n');

  // 7. Plan: Voucher Fund (>= 1.000đ immediate deduction) & Merged Customer Directory
  const voucherThisMonth = computeVoucherMonthStats(
    savedInvoices,
    voucherBudgets,
    store.footerNote,
    currentMonthKey
  );
  const voucherPrevMonth = computeVoucherMonthStats(
    savedInvoices,
    voucherBudgets,
    store.footerNote,
    prevMonthKey
  );

  const discountedOrderSummaries = voucherThisMonth.qualifiedOrders
    .slice(0, 20)
    .map(
      (r) =>
        `  + [${formatISODateVN(r.orderDate)}] Đơn ${r.invoice.code} (${r.invoice.customer.name || 'Khách lẻ'}): Trừ -${formatVND(r.deductAmount)} (${r.isCoc ? 'Đã cọc' : 'Chưa ghi Cọc'})`
    );

  const mergedCustomers = computeMergedCustomerDirectory(
    workspaceCustomers,
    savedInvoices,
    store.footerNote
  );
  const todayAppointments = mergedCustomers.filter(
    (c) => c.customerDate === todayISO && c.hasStoredContact
  );
  const customerLines = mergedCustomers
    .slice(0, 35)
    .map(
      (c) =>
        `- KH: ${c.name} | SĐT: ${c.phone || '(chưa có)'} | Date/Hẹn: ${formatISODateVN(c.customerDate) || c.customerDate || 'Chưa đặt'} | Số đơn: ${c.invoiceCount} (${c.depositedInvoiceCount} đơn đã cọc) | Tổng chi: ${formatVND(c.totalSpent)} | Tổng giảm nhận: ${formatVND(c.totalDiscountReceived)}${c.note ? ` | Ghi chú: ${c.note}` : ''}`
    );

  const planSection = [
    '=== 7. KẾ HOẠCH: QUỸ VOUCHER THÁNG (GIẢM KHÁCH TỪ 1.000Đ TRỪ LUÔN VÀO QUỸ) & DANH SÁCH KHÁCH HÀNG ===',
    `- Trừ Quỹ Voucher HÔM NAY (${formatISODateVN(todayISO)}): -${formatVND(revToday.voucherDeductSum)} (${revToday.voucherDeductCount} đơn giảm giá >= 1.000đ hôm nay)`,
    `- Quỹ Voucher THÁNG HIỆN TẠI (${currentMonthKey}): Ngân sách=${formatVND(voucherThisMonth.budgetAmount)} | Đã trừ Quỹ=-${formatVND(voucherThisMonth.totalUsedDiscount)} (${voucherThisMonth.qualifiedCount} đơn) | Quỹ còn lại=${formatVND(voucherThisMonth.remainingBudget)}${voucherThisMonth.overBudgetAmount > 0 ? ` (Vượt hạn mức +${formatVND(voucherThisMonth.overBudgetAmount)})` : ''} | Đơn có giảm chưa ghi Cọc=${voucherThisMonth.discountedWithoutCocCount} đơn`,
    `- Quỹ Voucher THÁNG TRƯỚC (${prevMonthKey}): Ngân sách=${formatVND(voucherPrevMonth.budgetAmount)} | Đã trừ Quỹ=-${formatVND(voucherPrevMonth.totalUsedDiscount)} (${voucherPrevMonth.qualifiedCount} đơn) | Còn lại=${formatVND(voucherPrevMonth.remainingBudget)}`,
    ...(discountedOrderSummaries.length > 0
      ? [
          `- Chi tiết các đơn đã trừ Quỹ Voucher trong tháng ${currentMonthKey}:`,
          ...discountedOrderSummaries,
        ]
      : [
          `- Tháng ${currentMonthKey} chưa có hóa đơn nào phát sinh giảm giá từ 1.000đ.`,
        ]),
    `- Danh sách Khách hàng hợp nhất trong Kế Hoạch (${mergedCustomers.length} khách tổng cộng, ${workspaceCustomers.length} khách lưu lịch Date KH, ${todayAppointments.length} lịch hẹn hôm nay ${formatISODateVN(todayISO)}):`,
    ...(customerLines.length > 0
      ? customerLines
      : ['- Chưa có khách hàng nào trong danh sách.']),
  ].join('\n');

  // 8. Inventory & 2-Column Reorder Table (Băng keo = cây)
  const stockLines = inventoryItems.map(
    (inv) =>
      `- ${inv.name}: Tồn kho ${inv.quantity} ${inv.unit} (Ngưỡng báo động ≤ ${inv.minThreshold} ${inv.unit}${inv.packLabel ? `, quy cách ${inv.packLabel}` : ''})`
  );
  const reorderTableLines =
    inventoryAlerts.length > 0
      ? inventoryAlerts.map(
          (a, idx) =>
            `  ${idx + 1}. [SẢN PHẨM ĐẶT: ${a.itemName}] | [SỐ LƯỢNG ĐẶT: ${a.orderQuantity} ${a.orderUnitLabel}] — (Tồn: ${a.quantity} ${a.unit.toLowerCase()}, thiếu ${a.missingQuantity} ${a.unit.toLowerCase()})`
        )
      : ['  - Kho đầy đủ, không có sản phẩm nào cần đặt thêm.'];

  const inventorySection = [
    `=== 8. KHO HÀNG (${inventoryItems.length} vật tư) & BẢNG SẢN PHẨM CẦN ĐẶT 2 CỘT (${inventoryAlerts.length} món cần đặt) ===`,
    ...stockLines,
    'Bảng sản phẩm cần đặt (2 cột: SẢN PHẨM ĐẶT | SỐ LƯỢNG ĐẶT — Băng keo tính theo cây):',
    ...reorderTableLines,
  ].join('\n');

  const pendingSection = hasMeaningfulOrderChanges(pendingProposal)
    ? [
        '=== 9. LỆNH ĐƠN HÀNG / GIẢM GIÁ ĐANG CHỜ XÁC NHẬN "OK" TỪ TIN NHẮN TRƯỚC ===',
        `- Khách hàng dự kiến: ${pendingProposal!.customerName || customer.name || 'Khách trên bill hiện tại'} ${pendingProposal!.customerPhone || customer.phone || ''}`,
        `- targetSavedInvoiceId: "${pendingProposal!.targetSavedInvoiceId || ''}" | createNewBill: ${String(pendingProposal!.createNewBill)}`,
        pendingProposal!.discountAmount >= 0
          ? `- Tiền giảm giá chờ áp dụng: ${formatVND(pendingProposal!.discountAmount)} (${pendingProposal!.discountAmount >= MIN_VOUCHER_DISCOUNT_AMOUNT ? `sẽ trừ -${formatVND(pendingProposal!.discountAmount)} vào Quỹ Voucher` : '< 1.000đ'})`
          : '',
        pendingProposal!.depositAmount >= 0
          ? `- Tiền cọc chờ áp dụng: ${formatVND(pendingProposal!.depositAmount)}`
          : '',
        pendingProposal!.shippingFee >= 0
          ? `- Phí ship chờ áp dụng: ${formatVND(pendingProposal!.shippingFee)}`
          : '',
        pendingProposal!.reportStage
          ? `- Trạng thái đơn chờ đổi: ${pendingProposal!.reportStage}`
          : '',
        typeof pendingProposal!.markRemainingPaid === 'boolean'
          ? `- Tất toán phần còn lại chờ áp dụng: ${pendingProposal!.markRemainingPaid ? `Đã thu phần còn lại (${formatISODateVN(pendingProposal!.remainingPaidAt || todayISO)})` : 'Bỏ tích thu phần còn lại'}`
          : '',
        pendingProposal!.itemsToAdd.length > 0
          ? `- Danh sách món đang chờ chốt: ${pendingProposal!.itemsToAdd.map((i) => `[productId="${i.productId}"] ${i.name} x${i.quantity} ${i.unit} @ ${i.unitPrice}đ`).join('; ')}`
          : '- Không thêm món mới (chỉ cập nhật thông tin giảm giá / cọc / thanh toán phần còn lại / khách trên bill).',
        '-> NẾU NGƯỜI DÙNG NHẮN "ok", "oke", "ừ", "đồng ý", "chốt", "đúng rồi", "lưu luôn" (hoặc chỉnh nhẹ rồi ok): HÃY TRẢ VỀ actionType="EXECUTE_ORDER" VỚI ĐẦY ĐỦ THÔNG TIN NÀY ĐỂ CẬP NHẬT & LIÊN KẾT ĐƠN NGAY!',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  return [
    verifiedSection,
    clockSection,
    companySection,
    webArchitectureSection,
    catalogSection,
    activeBillSection,
    savedSection,
    revenueSection,
    planSection,
    inventorySection,
    pendingSection,
  ]
    .filter(Boolean)
    .join('\n\n');
}

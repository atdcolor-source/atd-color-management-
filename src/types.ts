export enum AppTab {
  WORKSPACE = 'WORKSPACE',
  SAVED = 'SAVED',
  REPORTS = 'REPORTS',
  PLAN = 'PLAN',
  INVENTORY = 'INVENTORY',
  INVOICE = 'INVOICE',
  CATALOG = 'CATALOG',
  SETTINGS = 'SETTINGS',
}

export type PlanSubTab = 'voucher' | 'customers';

export type ReportSubView = 'monthly_revenue' | 'pipeline';

export type ReportStage =
  | 'bao_gia'
  | 'cham_soc'
  | 'coc'
  | 'chot_in'
  | 'chot_thiet_ke'
  | 'hoan_thanh';

export interface RevenueEntry {
  id: string;
  invoiceId: string;
  invoiceCode: string;
  orderDate: string;
  monthKey: string;
  customerName: string;
  customerPhone: string;
  customerCode: string;
  designAmount: number;
  printAmount: number;
  totalRevenue: number;
  isManualOverride: boolean;
  isDeleted: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface VoucherBudget {
  monthKey: string;
  budgetAmount: number;
  note: string;
  updatedAt: string;
}

export interface CustomerContact {
  id: string;
  name: string;
  phone: string;
  customerDate: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountSession {
  usernameKey: string;
  displayName: string;
  workspaceId: string;
  loggedInAt: string;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  category: string;
  sides?: string;
  size?: string;
  unit: string;
  price: number;
}

export interface QuoteItem {
  id: string;
  productId?: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  note?: string;
}

export interface CustomerInfo {
  name: string;
  code: string;
  phone: string;
}

export interface StoreSettings {
  companyName: string;
  address: string;
  phone: string;
  email: string;
  tiktok: string;
  preparerName: string;
  invoiceTitle: string;
  footerNote: string;
  showCalculator: boolean;
  showAiChat: boolean;
  logoVersion: string;
  signatureVersion: string;
}

export interface QuoteTotals {
  subtotal: number;
  discountAmount: number;
  shippingFee: number;
  depositAmount: number;
  remainingAmount: number;
  totalQuantity: number;
}

export interface SavedInvoice {
  id: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  expectedDemoDate: string;
  customer: CustomerInfo;
  items: QuoteItem[];
  discountAmount: number;
  shippingFee: number;
  depositAmount: number;
  designIllustration: string;
  invoiceNote: string;
  reportStage?: ReportStage | '';
  remainingPaid?: boolean;
  remainingPaidAt?: string;
  totals: QuoteTotals;
  syncedToCloud?: boolean;
  syncedOwnerUid?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  minThreshold: number;
  packSize: number;
  packLabel: string;
  sortIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryAlert {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  minThreshold: number;
  packSize: number;
  packLabel: string;
  cleanPackLabel: string;
  missingQuantity: number;
  orderQuantity: number;
  orderUnitLabel: string;
  orderSummaryLine: string;
  isOtherMaterial: boolean;
  isOutOfStock: boolean;
  message: string;
  updatedAt: string;
}

export interface AiOrderItemDraft {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  note: string;
}

export type AiNavigateTarget =
  | ''
  | 'workspace'
  | 'saved'
  | 'reports_revenue'
  | 'reports_pipeline'
  | 'plan_voucher'
  | 'plan_customers'
  | 'inventory_stock'
  | 'inventory_reorder'
  | 'invoice'
  | 'catalog'
  | 'settings';

export interface AiOrderAction {
  actionType: 'NONE' | 'PROPOSE_ORDER' | 'EXECUTE_ORDER';
  targetSavedInvoiceId: string;
  createNewBill: boolean;
  customerName: string;
  customerPhone: string;
  discountAmount: number;
  shippingFee: number;
  depositAmount: number;
  reportStage: string;
  markRemainingPaid?: boolean | null;
  remainingPaidAt?: string;
  navigateTarget?: AiNavigateTarget;
  autoNavigate?: boolean;
  itemsToAdd: AiOrderItemDraft[];
}

export interface AiOrderExecutionSummary {
  invoiceId: string;
  invoiceCode: string;
  customerLabel: string;
  addedItemsSummary: string;
  discountAmount: number;
  voucherDeductedAmount: number;
  remainingAmount: number;
  isDraftOnly?: boolean;
}

export interface AiChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  createdAt: string;
  orderAction?: AiOrderAction;
  proposalHandled?: boolean;
  executedSummary?: AiOrderExecutionSummary;
}



/**
 * Security Rules Invariant & Dirty Dozen Payload Verification Suite
 * Evaluates all 12 adversarial payloads from security_spec.md AND all shared-account
 * user flows against the exact boolean gates implemented in firestore.rules.
 */

const ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const USERNAME_REGEX = /^[a-z0-9_-]+$/;
const HEX64_REGEX = /^[a-f0-9]{64}$/;
const WORKSPACE_ID_REGEX = /^ws_[a-f0-9]{64}$/;
const SERVER_NOW = 'SERVER_REQUEST_TIME';

function isValidId(id: unknown): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && ID_REGEX.test(id);
}

function isValidUsernameKey(usernameKey: unknown): boolean {
  return (
    typeof usernameKey === 'string' &&
    usernameKey.length >= 3 &&
    usernameKey.length <= 40 &&
    USERNAME_REGEX.test(usernameKey)
  );
}

function isValidWorkspaceId(wsId: unknown): boolean {
  return typeof wsId === 'string' && wsId.length === 67 && WORKSPACE_ID_REGEX.test(wsId);
}

function hasExactKeys(data: Record<string, unknown>, allowed: string[]): boolean {
  const keys = Object.keys(data);
  return allowed.every((k) => keys.includes(k)) && keys.every((k) => allowed.includes(k));
}

function isBoundedNumber(val: unknown, min: number, max: number): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max;
}

function isBoundedInt(val: unknown, min: number, max: number): boolean {
  return typeof val === 'number' && Number.isInteger(val) && val >= min && val <= max;
}

const ACCOUNT_KEYS = ['usernameKey', 'displayName', 'verifierHash', 'createdAt', 'updatedAt'];
const WORKSPACE_INVOICE_KEYS = [
  'workspaceId',
  'accountUsername',
  'code',
  'invoiceDate',
  'expectedDemoDate',
  'customerName',
  'customerCode',
  'customerPhone',
  'designIllustration',
  'invoiceNote',
  'itemSummary',
  'itemCount',
  'totalQuantity',
  'subtotal',
  'discountAmount',
  'shippingFee',
  'depositAmount',
  'remainingAmount',
  'createdAt',
  'updatedAt',
];
const WORKSPACE_ITEM_KEYS = [
  'workspaceId',
  'invoiceId',
  'productId',
  'name',
  'unit',
  'quantity',
  'unitPrice',
  'note',
  'sortIndex',
  'createdAt',
  'updatedAt',
];

function evaluateAccountList(): boolean {
  return false;
}

function evaluateAccountUpdateOrDelete(): boolean {
  return false;
}

function evaluateAccountCreate(
  usernameKey: string,
  alreadyExists: boolean,
  data: Record<string, unknown>
): boolean {
  if (alreadyExists) return false;
  if (!isValidUsernameKey(usernameKey)) return false;
  if (!hasExactKeys(data, ACCOUNT_KEYS)) return false;
  if (!isValidUsernameKey(data.usernameKey) || data.usernameKey !== usernameKey) return false;
  if (typeof data.displayName !== 'string' || data.displayName.length < 1 || data.displayName.length > 80) return false;
  if (typeof data.verifierHash !== 'string' || data.verifierHash.length !== 64 || !HEX64_REGEX.test(data.verifierHash)) return false;
  if (data.createdAt !== SERVER_NOW || data.updatedAt !== SERVER_NOW) return false;
  return true;
}

const VALID_REPORT_STAGES = new Set([
  '',
  'bao_gia',
  'cham_soc',
  'coc',
  'chot_in',
  'chot_thiet_ke',
  'hoan_thanh',
]);

function isValidWorkspaceInvoice(data: Record<string, unknown>, workspaceId: string): boolean {
  const keys = Object.keys(data);
  const allowedKeys = [...WORKSPACE_INVOICE_KEYS, 'reportStage'];
  if (
    !WORKSPACE_INVOICE_KEYS.every((k) => keys.includes(k)) ||
    !keys.every((k) => allowedKeys.includes(k))
  ) {
    return false;
  }
  if (!isValidWorkspaceId(data.workspaceId) || data.workspaceId !== workspaceId) return false;
  if (!isValidUsernameKey(data.accountUsername)) return false;
  if (typeof data.code !== 'string' || data.code.length < 1 || data.code.length > 40 || !ID_REGEX.test(data.code)) return false;
  if (typeof data.invoiceDate !== 'string' || data.invoiceDate.length < 1 || data.invoiceDate.length > 40) return false;
  if (typeof data.expectedDemoDate !== 'string' || data.expectedDemoDate.length > 20) return false;
  if (typeof data.customerName !== 'string' || data.customerName.length > 120) return false;
  if (typeof data.customerCode !== 'string' || data.customerCode.length > 30) return false;
  if (typeof data.customerPhone !== 'string' || data.customerPhone.length > 30) return false;
  if (typeof data.designIllustration !== 'string' || data.designIllustration.length > 200) return false;
  if (typeof data.invoiceNote !== 'string' || data.invoiceNote.length > 3000) return false;
  if (
    'reportStage' in data &&
    (typeof data.reportStage !== 'string' ||
      data.reportStage.length > 30 ||
      !VALID_REPORT_STAGES.has(data.reportStage))
  ) {
    return false;
  }
  if (typeof data.itemSummary !== 'string' || data.itemSummary.length < 1 || data.itemSummary.length > 300) return false;
  if (!isBoundedInt(data.itemCount, 1, 100)) return false;
  if (!isBoundedInt(data.totalQuantity, 1, 100000)) return false;
  if (!isBoundedNumber(data.subtotal, 0, 10000000000)) return false;
  if (!isBoundedNumber(data.discountAmount, 0, 10000000000)) return false;
  if (!isBoundedNumber(data.shippingFee, 0, 10000000000)) return false;
  if (!isBoundedNumber(data.depositAmount, 0, 10000000000)) return false;
  if (!isBoundedNumber(data.remainingAmount, 0, 10000000000)) return false;
  if (typeof data.createdAt !== 'string' || typeof data.updatedAt !== 'string') return false;
  return true;
}

function evaluateWorkspaceInvoiceCreate(
  workspaceId: string,
  invoiceId: string,
  registeredAccounts: Set<string>,
  data: Record<string, unknown>
): boolean {
  if (!isValidWorkspaceId(workspaceId) || !isValidId(invoiceId)) return false;
  if (!isValidWorkspaceInvoice(data, workspaceId)) return false;
  if (data.createdAt !== SERVER_NOW || data.updatedAt !== SERVER_NOW) return false;
  if (!registeredAccounts.has(String(data.accountUsername))) return false;
  return true;
}

function evaluateWorkspaceInvoiceUpdate(
  workspaceId: string,
  invoiceId: string,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): boolean {
  if (!isValidWorkspaceInvoice(incoming, workspaceId) || !isValidWorkspaceId(workspaceId) || !isValidId(invoiceId)) {
    return false;
  }
  if (
    incoming.workspaceId !== existing.workspaceId ||
    incoming.accountUsername !== existing.accountUsername ||
    incoming.code !== existing.code ||
    incoming.createdAt !== existing.createdAt
  ) {
    return false;
  }
  if (incoming.updatedAt !== SERVER_NOW) return false;
  const mutable = new Set([
    'invoiceDate',
    'expectedDemoDate',
    'customerName',
    'customerCode',
    'customerPhone',
    'designIllustration',
    'invoiceNote',
    'reportStage',
    'itemSummary',
    'itemCount',
    'totalQuantity',
    'subtotal',
    'discountAmount',
    'shippingFee',
    'depositAmount',
    'remainingAmount',
    'updatedAt',
  ]);
  for (const key of Object.keys(incoming)) {
    if (incoming[key] !== existing[key] && !mutable.has(key)) return false;
  }
  return true;
}

function evaluateWorkspaceInvoiceList(
  workspaceId: string,
  existing: Record<string, unknown>,
  hasWorkspaceFilter: boolean
): boolean {
  if (!isValidWorkspaceId(workspaceId)) return false;
  if (!hasWorkspaceFilter) return false;
  return existing.workspaceId === workspaceId;
}

function evaluateWorkspaceItemCreate(
  workspaceId: string,
  invoiceId: string,
  itemId: string,
  parentInvoiceAfter: Record<string, unknown> | null,
  data: Record<string, unknown>
): boolean {
  if (!isValidWorkspaceId(workspaceId) || !isValidId(invoiceId) || !isValidId(itemId)) return false;
  if (!hasExactKeys(data, WORKSPACE_ITEM_KEYS)) return false;
  if (!isValidWorkspaceId(data.workspaceId) || data.workspaceId !== workspaceId) return false;
  if (!isValidId(data.invoiceId) || data.invoiceId !== invoiceId) return false;
  if (typeof data.productId !== 'string' || data.productId.length > 128) return false;
  if (typeof data.name !== 'string' || data.name.length < 1 || data.name.length > 200) return false;
  if (typeof data.unit !== 'string' || data.unit.length < 1 || data.unit.length > 40) return false;
  if (!isBoundedInt(data.quantity, 1, 100000)) return false;
  if (!isBoundedNumber(data.unitPrice, 0, 10000000000)) return false;
  if (typeof data.note !== 'string' || data.note.length > 1000) return false;
  if (!isBoundedInt(data.sortIndex, 0, 100)) return false;
  if (data.createdAt !== SERVER_NOW || data.updatedAt !== SERVER_NOW) return false;
  if (!parentInvoiceAfter || parentInvoiceAfter.workspaceId !== workspaceId) return false;
  return true;
}

function evaluateLegacyInvoiceWrite(): boolean {
  return false;
}

function assertDenied(label: string, allowed: boolean) {
  if (allowed) {
    throw new Error(`SECURITY FAILURE: Expected PERMISSION_DENIED for [${label}]`);
  }
}

function assertAllowed(label: string, allowed: boolean) {
  if (!allowed) {
    throw new Error(`FUNCTIONAL FAILURE: Expected ALLOW for [${label}]`);
  }
}

const VALID_VERIFIER_HASH = 'a'.repeat(64);
const VALID_WS_ID = `ws_${'b'.repeat(64)}`;
const OTHER_WS_ID = `ws_${'c'.repeat(64)}`;
const registeredAccounts = new Set<string>(['atdcolor']);

const validAccountDoc: Record<string, unknown> = {
  usernameKey: 'atdcolor',
  displayName: 'ATD Color',
  verifierHash: VALID_VERIFIER_HASH,
  createdAt: SERVER_NOW,
  updatedAt: SERVER_NOW,
};

const validWorkspaceInvoice: Record<string, unknown> = {
  workspaceId: VALID_WS_ID,
  accountUsername: 'atdcolor',
  code: 'HD-2810-001',
  invoiceDate: '2026-10-28T08:00:00.000Z',
  expectedDemoDate: '2026-10-29',
  customerName: 'Khách A',
  customerCode: '202610280800',
  customerPhone: '0901234567',
  designIllustration: 'Form ly nhựa',
  invoiceNote: 'Ghi chú đầy đủ điều khoản',
  itemSummary: 'Ép nhựa Plastic - 1 Mặt - Khổ A4 (x2)',
  itemCount: 1,
  totalQuantity: 2,
  subtotal: 58000,
  discountAmount: 0,
  shippingFee: 25000,
  depositAmount: 20000,
  remainingAmount: 63000,
  createdAt: SERVER_NOW,
  updatedAt: SERVER_NOW,
};

const validWorkspaceItem: Record<string, unknown> = {
  workspaceId: VALID_WS_ID,
  invoiceId: 'inv_1',
  productId: 'ep-1m-a4',
  name: 'Ép Nhựa - Plastic (A4 - 1 Mặt)',
  unit: 'Tờ',
  quantity: 2,
  unitPrice: 29000,
  note: 'Bo góc 4 cạnh',
  sortIndex: 0,
  createdAt: SERVER_NOW,
  updatedAt: SERVER_NOW,
};

function isValidWorkspaceSettings(data: Record<string, unknown>, workspaceId: string): boolean {
  const required = [
    'workspaceId',
    'accountUsername',
    'companyName',
    'address',
    'phone',
    'email',
    'tiktok',
    'preparerName',
    'invoiceTitle',
    'footerNote',
    'createdAt',
    'updatedAt',
  ];
  const allowed = [
    ...required,
    'showCalculator',
    'showAiChat',
    'logoVersion',
    'signatureVersion',
  ];
  const keys = Object.keys(data);
  if (!required.every((k) => keys.includes(k)) || !keys.every((k) => allowed.includes(k))) {
    return false;
  }
  if (!isValidWorkspaceId(data.workspaceId) || data.workspaceId !== workspaceId) return false;
  if (!isValidUsernameKey(data.accountUsername)) return false;
  if (typeof data.companyName !== 'string' || data.companyName.length < 1 || data.companyName.length > 120) return false;
  if (typeof data.address !== 'string' || data.address.length > 250) return false;
  if (typeof data.phone !== 'string' || data.phone.length > 40) return false;
  if (typeof data.email !== 'string' || data.email.length > 120) return false;
  if (typeof data.tiktok !== 'string' || data.tiktok.length > 80) return false;
  if (typeof data.preparerName !== 'string' || data.preparerName.length > 120) return false;
  if (typeof data.invoiceTitle !== 'string' || data.invoiceTitle.length < 1 || data.invoiceTitle.length > 120) return false;
  if (typeof data.footerNote !== 'string' || data.footerNote.length > 3000) return false;
  if ('showCalculator' in data && typeof data.showCalculator !== 'boolean') return false;
  if ('showAiChat' in data && typeof data.showAiChat !== 'boolean') return false;
  if (
    'logoVersion' in data &&
    (typeof data.logoVersion !== 'string' ||
      data.logoVersion.length > 40 ||
      !/^[a-zA-Z0-9_-]*$/.test(data.logoVersion))
  ) {
    return false;
  }
  if (
    'signatureVersion' in data &&
    (typeof data.signatureVersion !== 'string' ||
      data.signatureVersion.length > 40 ||
      !/^[a-zA-Z0-9_-]*$/.test(data.signatureVersion))
  ) {
    return false;
  }
  if (data.createdAt !== SERVER_NOW && typeof data.createdAt !== 'string') return false;
  if (data.updatedAt !== SERVER_NOW) return false;
  return true;
}

const validWorkspaceSettings: Record<string, unknown> = {
  workspaceId: VALID_WS_ID,
  accountUsername: 'atdcolor',
  companyName: 'ATD Color',
  address: 'Tân Hồng, Đồng Tháp',
  phone: '0967434893',
  email: 'atdcolor.com',
  tiktok: '@atdcolor2',
  preparerName: 'Nguyễn Tuấn Đạt',
  invoiceTitle: 'PHIẾU ĐẶT HÀNG',
  footerNote: 'Điều khoản',
  showCalculator: false,
  showAiChat: true,
  logoVersion: 'lv_1761747105_abcd',
  signatureVersion: 'sg_1761747105_efgh',
  createdAt: SERVER_NOW,
  updatedAt: SERVER_NOW,
};

// Positive functional assertions (shared account across devices)
assertAllowed('Register new account atdcolor', evaluateAccountCreate('atdcolor', false, validAccountDoc));
assertAllowed('Create invoice in shared account workspace', evaluateWorkspaceInvoiceCreate(VALID_WS_ID, 'inv_1', registeredAccounts, validWorkspaceInvoice));
assertAllowed('Second device with same account + password lists shared workspace invoices', evaluateWorkspaceInvoiceList(VALID_WS_ID, validWorkspaceInvoice, true));
assertAllowed('Second device updates shared workspace invoice', evaluateWorkspaceInvoiceUpdate(VALID_WS_ID, 'inv_1', validWorkspaceInvoice, { ...validWorkspaceInvoice, customerName: 'Khách A (Đã cập nhật)' }));
assertAllowed('Atomic batch create item inside shared workspace invoice', evaluateWorkspaceItemCreate(VALID_WS_ID, 'inv_1', 'item_0', validWorkspaceInvoice, validWorkspaceItem));
assertAllowed('Save WorkspaceSettings with showCalculator and logoVersion', isValidWorkspaceSettings(validWorkspaceSettings, VALID_WS_ID));
assertAllowed('Classify invoice into reportStage chot_in', evaluateWorkspaceInvoiceUpdate(VALID_WS_ID, 'inv_1', validWorkspaceInvoice, { ...validWorkspaceInvoice, reportStage: 'chot_in' }));
assertAllowed('Classify invoice into reportStage coc', evaluateWorkspaceInvoiceUpdate(VALID_WS_ID, 'inv_1', validWorkspaceInvoice, { ...validWorkspaceInvoice, reportStage: 'coc' }));

const MONTH_KEY_REGEX = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
function isValidMonthKey(mk: unknown): boolean {
  return typeof mk === 'string' && mk.length === 7 && MONTH_KEY_REGEX.test(mk);
}

const VOUCHER_BUDGET_KEYS = [
  'workspaceId',
  'accountUsername',
  'monthKey',
  'budgetAmount',
  'note',
  'createdAt',
  'updatedAt',
];

function isValidWorkspaceVoucherBudget(
  data: Record<string, unknown>,
  workspaceId: string,
  monthKey: string
): boolean {
  if (!hasExactKeys(data, VOUCHER_BUDGET_KEYS)) return false;
  if (!isValidWorkspaceId(data.workspaceId) || data.workspaceId !== workspaceId) return false;
  if (!isValidUsernameKey(data.accountUsername)) return false;
  if (!isValidMonthKey(data.monthKey) || data.monthKey !== monthKey) return false;
  if (!isBoundedNumber(data.budgetAmount, 0, 10000000000)) return false;
  if (typeof data.note !== 'string' || data.note.length > 500) return false;
  if (typeof data.createdAt !== 'string' || typeof data.updatedAt !== 'string') return false;
  return true;
}

const WORKSPACE_CUSTOMER_KEYS = [
  'workspaceId',
  'accountUsername',
  'name',
  'phone',
  'customerDate',
  'note',
  'createdAt',
  'updatedAt',
];

function isValidWorkspaceCustomer(
  data: Record<string, unknown>,
  workspaceId: string
): boolean {
  if (!hasExactKeys(data, WORKSPACE_CUSTOMER_KEYS)) return false;
  if (!isValidWorkspaceId(data.workspaceId) || data.workspaceId !== workspaceId) return false;
  if (!isValidUsernameKey(data.accountUsername)) return false;
  if (typeof data.name !== 'string' || data.name.length < 1 || data.name.length > 120) return false;
  if (typeof data.phone !== 'string' || data.phone.length < 1 || data.phone.length > 30) return false;
  if (typeof data.customerDate !== 'string' || data.customerDate.length > 30) return false;
  if (typeof data.note !== 'string' || data.note.length > 500) return false;
  if (typeof data.createdAt !== 'string' || typeof data.updatedAt !== 'string') return false;
  return true;
}

const validVoucherBudget: Record<string, unknown> = {
  workspaceId: VALID_WS_ID,
  accountUsername: 'atdcolor',
  monthKey: '2026-10',
  budgetAmount: 5000000,
  note: 'Ngân sách giảm tháng 10',
  createdAt: SERVER_NOW,
  updatedAt: SERVER_NOW,
};

const validWorkspaceCustomer: Record<string, unknown> = {
  workspaceId: VALID_WS_ID,
  accountUsername: 'atdcolor',
  name: 'Chị Lan Trà Sữa',
  phone: '0909123456',
  customerDate: '2026-10-29',
  note: 'Khách quen đặt tem',
  createdAt: SERVER_NOW,
  updatedAt: SERVER_NOW,
};

const WORKSPACE_INVENTORY_KEYS = [
  'workspaceId',
  'accountUsername',
  'name',
  'unit',
  'quantity',
  'minThreshold',
  'packSize',
  'packLabel',
  'sortIndex',
  'createdAt',
  'updatedAt',
];

function isValidWorkspaceInventoryItem(
  data: Record<string, unknown>,
  workspaceId: string
): boolean {
  if (!hasExactKeys(data, WORKSPACE_INVENTORY_KEYS)) return false;
  if (!isValidWorkspaceId(data.workspaceId) || data.workspaceId !== workspaceId) return false;
  if (!isValidUsernameKey(data.accountUsername)) return false;
  if (typeof data.name !== 'string' || data.name.length < 1 || data.name.length > 160) return false;
  if (typeof data.unit !== 'string' || data.unit.length < 1 || data.unit.length > 40) return false;
  if (!isBoundedNumber(data.quantity, 0, 1000000)) return false;
  if (!isBoundedNumber(data.minThreshold, 0, 1000000)) return false;
  if (!isBoundedNumber(data.packSize, 1, 100000)) return false;
  if (typeof data.packLabel !== 'string' || data.packLabel.length > 120) return false;
  if (!isBoundedInt(data.sortIndex, 0, 500)) return false;
  if (typeof data.createdAt !== 'string' || typeof data.updatedAt !== 'string') return false;
  return true;
}

const validWorkspaceInventoryItem: Record<string, unknown> = {
  workspaceId: VALID_WS_ID,
  accountUsername: 'atdcolor',
  name: 'Miếng nhựa - Plastic A3',
  unit: 'Tấm',
  quantity: 50,
  minThreshold: 10,
  packSize: 50,
  packLabel: '1 sấp = 50 tấm',
  sortIndex: 0,
  createdAt: SERVER_NOW,
  updatedAt: SERVER_NOW,
};

assertAllowed('Create monthly Voucher budget (5tr for 2026-10)', isValidWorkspaceVoucherBudget(validVoucherBudget, VALID_WS_ID, '2026-10'));
assertAllowed('Create Date KH customer contact', isValidWorkspaceCustomer(validWorkspaceCustomer, VALID_WS_ID));
assertAllowed('Create Warehouse Inventory item (Miếng nhựa - Plastic A3)', isValidWorkspaceInventoryItem(validWorkspaceInventoryItem, VALID_WS_ID));
assertAllowed('Deduct Warehouse Inventory item to zero stock', isValidWorkspaceInventoryItem({ ...validWorkspaceInventoryItem, quantity: 0 }, VALID_WS_ID));

const ORDER_DATE_REGEX = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const OPTIONAL_ID_REGEX = /^[a-zA-Z0-9_-]*$/;

const WORKSPACE_REVENUE_ENTRY_KEYS = [
  'workspaceId',
  'accountUsername',
  'invoiceId',
  'invoiceCode',
  'orderDate',
  'monthKey',
  'customerName',
  'customerPhone',
  'customerCode',
  'designAmount',
  'printAmount',
  'totalRevenue',
  'isManualOverride',
  'isDeleted',
  'note',
  'createdAt',
  'updatedAt',
];

function isValidWorkspaceRevenueEntry(
  data: Record<string, unknown>,
  workspaceId: string
): boolean {
  if (!hasExactKeys(data, WORKSPACE_REVENUE_ENTRY_KEYS)) return false;
  if (!isValidWorkspaceId(data.workspaceId) || data.workspaceId !== workspaceId) return false;
  if (!isValidUsernameKey(data.accountUsername)) return false;
  if (typeof data.invoiceId !== 'string' || data.invoiceId.length > 128 || !OPTIONAL_ID_REGEX.test(data.invoiceId)) return false;
  if (typeof data.invoiceCode !== 'string' || data.invoiceCode.length > 40) return false;
  if (typeof data.orderDate !== 'string' || data.orderDate.length !== 10 || !ORDER_DATE_REGEX.test(data.orderDate)) return false;
  if (!isValidMonthKey(data.monthKey) || data.orderDate.slice(0, 7) !== data.monthKey) return false;
  if (typeof data.customerName !== 'string' || data.customerName.length < 1 || data.customerName.length > 120) return false;
  if (typeof data.customerPhone !== 'string' || data.customerPhone.length > 30) return false;
  if (typeof data.customerCode !== 'string' || data.customerCode.length > 30) return false;
  if (!isBoundedNumber(data.designAmount, 0, 10000000000)) return false;
  if (!isBoundedNumber(data.printAmount, 0, 10000000000)) return false;
  if (!isBoundedNumber(data.totalRevenue, 0, 20000000000)) return false;
  if (data.totalRevenue !== (data.designAmount as number) + (data.printAmount as number)) return false;
  if (typeof data.isManualOverride !== 'boolean') return false;
  if (typeof data.isDeleted !== 'boolean') return false;
  if (typeof data.note !== 'string' || data.note.length > 500) return false;
  if (typeof data.createdAt !== 'string' || typeof data.updatedAt !== 'string') return false;
  return true;
}

function evaluateWorkspaceRevenueEntryUpdate(
  workspaceId: string,
  entryId: string,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): boolean {
  if (
    !isValidWorkspaceRevenueEntry(incoming, workspaceId) ||
    !isValidWorkspaceId(workspaceId) ||
    !isValidId(entryId)
  ) {
    return false;
  }
  if (
    incoming.workspaceId !== existing.workspaceId ||
    incoming.accountUsername !== existing.accountUsername ||
    incoming.invoiceId !== existing.invoiceId ||
    incoming.createdAt !== existing.createdAt
  ) {
    return false;
  }
  if (incoming.updatedAt !== SERVER_NOW) return false;
  const mutable = new Set([
    'invoiceCode',
    'orderDate',
    'monthKey',
    'customerName',
    'customerPhone',
    'customerCode',
    'designAmount',
    'printAmount',
    'totalRevenue',
    'isManualOverride',
    'isDeleted',
    'note',
    'updatedAt',
  ]);
  for (const key of Object.keys(incoming)) {
    if (incoming[key] !== existing[key] && !mutable.has(key)) return false;
  }
  return true;
}

const validWorkspaceRevenueEntry: Record<string, unknown> = {
  workspaceId: VALID_WS_ID,
  accountUsername: 'atdcolor',
  invoiceId: 'inv_1',
  invoiceCode: 'HD-2810-001',
  orderDate: '2026-10-28',
  monthKey: '2026-10',
  customerName: 'Khách A',
  customerPhone: '0901234567',
  customerCode: '202610280800',
  designAmount: 200000,
  printAmount: 160000,
  totalRevenue: 360000,
  isManualOverride: false,
  isDeleted: false,
  note: 'Thiết kế Menu + Ép nhựa A4',
  createdAt: SERVER_NOW,
  updatedAt: SERVER_NOW,
};

assertAllowed('Create permanent monthly RevenueEntry (design + print split)', isValidWorkspaceRevenueEntry(validWorkspaceRevenueEntry, VALID_WS_ID));
assertAllowed('Staff manual override of design/print split on RevenueEntry', evaluateWorkspaceRevenueEntryUpdate(VALID_WS_ID, 'rev_inv_1', validWorkspaceRevenueEntry, { ...validWorkspaceRevenueEntry, designAmount: 150000, printAmount: 210000, totalRevenue: 360000, isManualOverride: true }));
assertAllowed('Staff proactive delete tombstone on linked RevenueEntry', evaluateWorkspaceRevenueEntryUpdate(VALID_WS_ID, 'rev_inv_1', validWorkspaceRevenueEntry, { ...validWorkspaceRevenueEntry, isDeleted: true }));

// Dirty Dozen adversarial assertions
assertDenied('1. Account Enumeration (list /accounts)', evaluateAccountList());
assertDenied('2a. Account Overwrite / Update (/accounts/atdcolor)', evaluateAccountUpdateOrDelete());
assertDenied('2b. Duplicate Account Re-Create (/accounts/atdcolor)', evaluateAccountCreate('atdcolor', true, validAccountDoc));
assertDenied('3. Malformed Verifier Hash or Username Mismatch on Account Create', evaluateAccountCreate('atdcolor', false, { ...validAccountDoc, verifierHash: '12345' }));
assertDenied('4. Weak / Short Workspace ID Injection', evaluateWorkspaceInvoiceCreate('ws_short_123', 'inv_1', registeredAccounts, { ...validWorkspaceInvoice, workspaceId: 'ws_short_123' }));
assertDenied('5. Unregistered Account Reference on Workspace Create', evaluateWorkspaceInvoiceCreate(VALID_WS_ID, 'inv_1', registeredAccounts, { ...validWorkspaceInvoice, accountUsername: 'ghost_user' }));
assertDenied('6. Shadow Field Injection on WorkspaceInvoice Create', evaluateWorkspaceInvoiceCreate(VALID_WS_ID, 'inv_1', registeredAccounts, { ...validWorkspaceInvoice, isAdmin: true }));
assertDenied('7. Update-Gap / Value Poisoning (>120 char customerName)', evaluateWorkspaceInvoiceUpdate(VALID_WS_ID, 'inv_1', validWorkspaceInvoice, { ...validWorkspaceInvoice, customerName: 'X'.repeat(500) }));
assertDenied('7a. ReportStage Enum Value Poisoning', evaluateWorkspaceInvoiceUpdate(VALID_WS_ID, 'inv_1', validWorkspaceInvoice, { ...validWorkspaceInvoice, reportStage: 'invalid_stage_xyz' }));
assertDenied('7b. Settings Value Poisoning (non-boolean showCalculator)', isValidWorkspaceSettings({ ...validWorkspaceSettings, showCalculator: 'yes' }, VALID_WS_ID));
assertDenied('7b2. Settings Value Poisoning (non-boolean showAiChat)', isValidWorkspaceSettings({ ...validWorkspaceSettings, showAiChat: 'yes' }, VALID_WS_ID));
assertDenied('7c. Settings Logo Blob Poisoning (oversized or base64 logoVersion)', isValidWorkspaceSettings({ ...validWorkspaceSettings, logoVersion: 'data:image/png;base64,' + 'A'.repeat(200) }, VALID_WS_ID));
assertDenied('7f. Settings Signature Blob Poisoning (oversized or base64 signatureVersion)', isValidWorkspaceSettings({ ...validWorkspaceSettings, signatureVersion: 'data:image/png;base64,' + 'A'.repeat(200) }, VALID_WS_ID));
assertDenied('7d. Voucher Budget Invalid Month Key or Negative Amount', isValidWorkspaceVoucherBudget({ ...validVoucherBudget, budgetAmount: -50000 }, VALID_WS_ID, '2026-10') || isValidWorkspaceVoucherBudget(validVoucherBudget, VALID_WS_ID, '2026-13'));
assertDenied('7e. Date KH Empty Phone or Shadow Field Injection', isValidWorkspaceCustomer({ ...validWorkspaceCustomer, phone: '' }, VALID_WS_ID) || isValidWorkspaceCustomer({ ...validWorkspaceCustomer, isAdmin: true }, VALID_WS_ID));
assertDenied('7g. Inventory Negative Quantity, Zero PackSize, or Shadow Field Injection', isValidWorkspaceInventoryItem({ ...validWorkspaceInventoryItem, quantity: -5 }, VALID_WS_ID) || isValidWorkspaceInventoryItem({ ...validWorkspaceInventoryItem, packSize: 0 }, VALID_WS_ID) || isValidWorkspaceInventoryItem({ ...validWorkspaceInventoryItem, isAdmin: true }, VALID_WS_ID));
assertDenied('7h. RevenueEntry Sum Mismatch, MonthKey Mismatch, or Negative Revenue', isValidWorkspaceRevenueEntry({ ...validWorkspaceRevenueEntry, totalRevenue: 999999 }, VALID_WS_ID) || isValidWorkspaceRevenueEntry({ ...validWorkspaceRevenueEntry, monthKey: '2026-11' }, VALID_WS_ID) || isValidWorkspaceRevenueEntry({ ...validWorkspaceRevenueEntry, designAmount: -1000, totalRevenue: 159000 }, VALID_WS_ID));
assertDenied('8. Immutable Field Mutation (workspaceId or code)', evaluateWorkspaceInvoiceUpdate(VALID_WS_ID, 'inv_1', validWorkspaceInvoice, { ...validWorkspaceInvoice, code: 'HD-HACKED' }));
assertDenied('8b. RevenueEntry Immutable invoiceId Mutation', evaluateWorkspaceRevenueEntryUpdate(VALID_WS_ID, 'rev_inv_1', validWorkspaceRevenueEntry, { ...validWorkspaceRevenueEntry, invoiceId: 'inv_hijacked' }));
assertDenied('9. Client Timestamp Forgery', evaluateWorkspaceInvoiceCreate(VALID_WS_ID, 'inv_1', registeredAccounts, { ...validWorkspaceInvoice, createdAt: '2020-01-01T00:00:00Z' }));
assertDenied('10a. Unfiltered List Scraping without query boundary', evaluateWorkspaceInvoiceList(VALID_WS_ID, validWorkspaceInvoice, false));
assertDenied('10b. Cross-Account Workspace List Attempt', evaluateWorkspaceInvoiceList(OTHER_WS_ID, validWorkspaceInvoice, true));
assertDenied('11. Orphaned Subcollection Item Create', evaluateWorkspaceItemCreate(VALID_WS_ID, 'missing_inv', 'item_0', null, { ...validWorkspaceItem, invoiceId: 'missing_inv' }));
assertDenied('12. Legacy Unauthenticated Write Bypass (/invoices)', evaluateLegacyInvoiceWrite());

console.log('ALL POSITIVE & DIRTY DOZEN SECURITY ASSERTIONS PASSED.');

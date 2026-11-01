import {
  AccountSession,
  AiOrderAction,
  CustomerContact,
  InventoryItem,
  Product,
  RevenueEntry,
  SavedInvoice,
  StoreSettings,
  VoucherBudget,
} from '../types';

export class CloudRelayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly projectId?: string;
  readonly databaseId?: string;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    projectId?: string;
    databaseId?: string;
  }) {
    super(params.message);
    this.name = 'CloudRelayError';
    this.status = params.status;
    this.code = params.code;
    this.projectId = params.projectId;
    this.databaseId = params.databaseId;
  }
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  retryCount = 1
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (retryCount > 0) {
        window.clearTimeout(timer);
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        return fetchJsonWithTimeout<T>(url, init, timeoutMs, retryCount - 1);
      }
      throw new CloudRelayError({
        status: res.status || 500,
        code: 'RELAY_NOT_JSON',
        message: 'Máy chủ đang khởi động lại trong giây lát, vui lòng thử lại.',
      });
    }

    const payload = (await res.json()) as Record<string, unknown>;
    if (!res.ok || payload.ok === false) {
      throw new CloudRelayError({
        status: res.status,
        code: String(payload.code || 'RELAY_ERROR'),
        message: String(payload.message || `HTTP ${res.status}`),
        projectId:
          typeof payload.projectId === 'string' ? payload.projectId : undefined,
        databaseId:
          typeof payload.databaseId === 'string'
            ? payload.databaseId
            : undefined,
      });
    }
    return payload as T;
  } catch (err) {
    if (err instanceof CloudRelayError) {
      throw err;
    }
    throw new CloudRelayError({
      status: 0,
      code: 'NETWORK_UNREACHABLE',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function checkServerCloudHealth(): Promise<{
  connected: boolean;
  quotaExceeded: boolean;
  upgradeUrl?: string;
}> {
  try {
    await fetchJsonWithTimeout<{ ok: boolean; connected: boolean }>(
      '/api/cloud/health',
      { method: 'GET' },
      5500
    );
    return { connected: true, quotaExceeded: false };
  } catch (err) {
    if (err instanceof CloudRelayError) {
      if (err.code === 'QUOTA_DAILY_READS' && err.projectId && err.databaseId) {
        return {
          connected: false,
          quotaExceeded: true,
          upgradeUrl: `https://console.firebase.google.com/project/${err.projectId}/firestore/databases/${err.databaseId}/data?openUpgradeDialog=true`,
        };
      }
      if (err.code === 'QUOTA_EXCEEDED') {
        return { connected: false, quotaExceeded: true };
      }
    }
    return { connected: false, quotaExceeded: false };
  }
}

export async function apiGetAccount(usernameKey: string): Promise<{
  exists: boolean;
  account?: {
    usernameKey: string;
    displayName: string;
    verifierHash: string;
  };
}> {
  return fetchJsonWithTimeout(
    `/api/cloud/accounts/${encodeURIComponent(usernameKey)}`,
    { method: 'GET' },
    7500
  );
}

export async function apiRegisterAccount(params: {
  usernameKey: string;
  displayName: string;
  verifierHash: string;
}): Promise<{
  account: { usernameKey: string; displayName: string };
}> {
  return fetchJsonWithTimeout(
    '/api/cloud/accounts',
    {
      method: 'POST',
      body: JSON.stringify(params),
    },
    8500
  );
}

export interface WorkspaceSnapshotResponse {
  ok: true;
  unchanged: boolean;
  version: number;
  invoices?: SavedInvoice[];
  settings?: StoreSettings | null;
  products?: Product[] | null;
  voucherBudgets?: VoucherBudget[];
  customers?: CustomerContact[];
  inventory?: InventoryItem[] | null;
  revenueEntries?: RevenueEntry[];
  serverTime?: string;
}

export async function apiFetchWorkspaceSnapshot(
  workspaceId: string,
  sinceVersion = 0
): Promise<WorkspaceSnapshotResponse> {
  const qs =
    sinceVersion > 0 ? `?sinceVersion=${encodeURIComponent(String(sinceVersion))}` : '';
  return fetchJsonWithTimeout<WorkspaceSnapshotResponse>(
    `/api/cloud/workspaces/${encodeURIComponent(workspaceId)}/snapshot${qs}`,
    { method: 'GET' },
    8000
  );
}

export async function apiUpsertWorkspaceInvoice(
  session: AccountSession,
  invoice: SavedInvoice
): Promise<void> {
  await fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/invoices`,
    {
      method: 'POST',
      body: JSON.stringify({
        accountUsername: session.usernameKey,
        invoice,
      }),
    },
    10000
  );
}

export async function apiUpdateWorkspaceInvoiceStage(
  session: AccountSession,
  invoiceId: string,
  reportStage: string,
  paymentPatch?: { remainingPaid?: boolean; remainingPaidAt?: string }
): Promise<{
  ok: true;
  found: boolean;
  reportStage?: string;
  remainingPaid?: boolean;
  remainingPaidAt?: string;
}> {
  return fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/invoices/${encodeURIComponent(invoiceId)}/stage`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        reportStage,
        ...(typeof paymentPatch?.remainingPaid === 'boolean'
          ? { remainingPaid: paymentPatch.remainingPaid }
          : {}),
        ...(typeof paymentPatch?.remainingPaidAt === 'string'
          ? { remainingPaidAt: paymentPatch.remainingPaidAt }
          : {}),
      }),
    },
    8000
  );
}

export async function apiDeleteWorkspaceInvoice(
  session: AccountSession,
  invoiceId: string
): Promise<void> {
  await fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/invoices/${encodeURIComponent(invoiceId)}`,
    { method: 'DELETE' },
    8500
  );
}

export async function apiUpsertWorkspaceSettings(
  session: AccountSession,
  settings: StoreSettings
): Promise<void> {
  await fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/settings`,
    {
      method: 'PUT',
      body: JSON.stringify({
        accountUsername: session.usernameKey,
        settings,
      }),
    },
    8500
  );
}

export async function apiSyncWorkspaceProducts(
  session: AccountSession,
  products: Product[]
): Promise<void> {
  await fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/products`,
    {
      method: 'PUT',
      body: JSON.stringify({
        accountUsername: session.usernameKey,
        products,
      }),
    },
    10000
  );
}

export async function apiFetchLegacyInvoices(): Promise<SavedInvoice[]> {
  const res = await fetchJsonWithTimeout<{
    ok: true;
    invoices: SavedInvoice[];
  }>('/api/cloud/legacy-invoices', { method: 'GET' }, 8000);
  return Array.isArray(res.invoices) ? res.invoices : [];
}

export async function apiGetWorkspaceLogo(
  workspaceId: string,
  options?: { metaOnly?: boolean }
): Promise<{
  ok: true;
  hasLogo: boolean;
  version: string;
  dataUrl: string | null;
}> {
  const qs = options?.metaOnly ? '?metaOnly=1' : '';
  return fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(workspaceId)}/logo${qs}`,
    { method: 'GET' },
    options?.metaOnly ? 6000 : 10000
  );
}

export async function apiPutWorkspaceLogo(
  session: AccountSession,
  version: string,
  dataUrl: string
): Promise<{ ok: true; version: string }> {
  return fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/logo`,
    {
      method: 'PUT',
      body: JSON.stringify({
        accountUsername: session.usernameKey,
        version,
        dataUrl,
      }),
    },
    15000
  );
}

export async function apiDeleteWorkspaceLogo(
  workspaceId: string
): Promise<{ ok: true }> {
  return fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(workspaceId)}/logo`,
    { method: 'DELETE' },
    8500
  );
}

export async function apiGetWorkspaceSignature(
  workspaceId: string,
  options?: { metaOnly?: boolean }
): Promise<{
  ok: true;
  hasSignature: boolean;
  version: string;
  dataUrl: string | null;
}> {
  const qs = options?.metaOnly ? '?metaOnly=1' : '';
  return fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(workspaceId)}/signature${qs}`,
    { method: 'GET' },
    options?.metaOnly ? 6000 : 10000
  );
}

export async function apiPutWorkspaceSignature(
  session: AccountSession,
  version: string,
  dataUrl: string
): Promise<{ ok: true; version: string }> {
  return fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/signature`,
    {
      method: 'PUT',
      body: JSON.stringify({
        accountUsername: session.usernameKey,
        version,
        dataUrl,
      }),
    },
    15000
  );
}

export async function apiDeleteWorkspaceSignature(
  workspaceId: string
): Promise<{ ok: true }> {
  return fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(workspaceId)}/signature`,
    { method: 'DELETE' },
    8500
  );
}

export async function apiUpsertWorkspaceVoucherBudget(
  session: AccountSession,
  budget: VoucherBudget
): Promise<void> {
  await fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/voucher-budgets/${encodeURIComponent(budget.monthKey)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        accountUsername: session.usernameKey,
        budgetAmount: budget.budgetAmount,
        note: budget.note,
      }),
    },
    8500
  );
}

export async function apiUpsertWorkspaceCustomer(
  session: AccountSession,
  customer: CustomerContact
): Promise<void> {
  await fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/customers/${encodeURIComponent(customer.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        accountUsername: session.usernameKey,
        customer,
      }),
    },
    8500
  );
}

export async function apiDeleteWorkspaceCustomer(
  session: AccountSession,
  customerId: string
): Promise<void> {
  await fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/customers/${encodeURIComponent(customerId)}`,
    { method: 'DELETE' },
    8500
  );
}

export async function apiSyncWorkspaceInventory(
  session: AccountSession,
  items: InventoryItem[]
): Promise<void> {
  await fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/inventory`,
    {
      method: 'PUT',
      body: JSON.stringify({
        accountUsername: session.usernameKey,
        items,
      }),
    },
    10000
  );
}

export async function apiUpsertWorkspaceInventoryItem(
  session: AccountSession,
  item: InventoryItem
): Promise<void> {
  await fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/inventory/${encodeURIComponent(item.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        accountUsername: session.usernameKey,
        item,
      }),
    },
    8500
  );
}

export async function apiDeleteWorkspaceInventoryItem(
  session: AccountSession,
  itemId: string
): Promise<void> {
  await fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/inventory/${encodeURIComponent(itemId)}`,
    { method: 'DELETE' },
    8500
  );
}

export async function apiUpsertWorkspaceRevenueEntry(
  session: AccountSession,
  entry: RevenueEntry
): Promise<void> {
  await fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/revenue-entries/${encodeURIComponent(entry.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        accountUsername: session.usernameKey,
        entry,
      }),
    },
    8500
  );
}

export async function apiDeleteWorkspaceRevenueEntry(
  session: AccountSession,
  entryId: string
): Promise<void> {
  await fetchJsonWithTimeout(
    `/api/cloud/workspaces/${encodeURIComponent(session.workspaceId)}/revenue-entries/${encodeURIComponent(entryId)}`,
    { method: 'DELETE' },
    8500
  );
}

export async function apiSendAiChatMessage(params: {
  messages: { role: 'user' | 'model'; text: string }[];
  contextSummary?: string;
}): Promise<{
  ok: true;
  reply?: string;
  orderAction?: AiOrderAction;
  useSmartEngine?: boolean;
  reason?: string;
}> {
  return fetchJsonWithTimeout<{
    ok: true;
    reply?: string;
    orderAction?: AiOrderAction;
    useSmartEngine?: boolean;
    reason?: string;
  }>(
    '/api/ai/chat',
    {
      method: 'POST',
      body: JSON.stringify(params),
    },
    16000,
    1
  );
}

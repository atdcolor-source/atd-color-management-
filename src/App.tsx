import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, X } from 'lucide-react';
import { AiChatBox } from './components/AiChatBox';
import { AuthGate } from './components/AuthGate';
import { CatalogManager } from './components/CatalogManager';
import { DEFAULT_DESIGN_ILLUSTRATION } from './components/DesignIllustrationSelector';
import { HandBillCalculator } from './components/HandBillCalculator';
import { Header } from './components/Header';
import { StoreSettingsView } from './components/HistoryAndSettings';
import { InventorySubTab, InventoryView } from './components/InventoryView';
import { InvoicePreview } from './components/InvoicePreview';
import { LiveQuoteSidebar } from './components/LiveQuoteSidebar';
import { PlanView } from './components/PlanView';
import { PrintPriceSheetCard } from './components/PrintPriceSheetCard';
import { ProductSelector } from './components/ProductSelector';
import { ReportsView, ReportStageFilter } from './components/ReportsView';
import { SavedInvoicesView } from './components/SavedInvoicesView';
import { SavedQuoteDetailModal } from './components/SavedQuoteDetailModal';
import { sanitizeReportStage } from './constants/reportStages';
import {
  INITIAL_CUSTOMER,
  INITIAL_INVENTORY_ITEMS,
  INITIAL_PRODUCTS,
  INITIAL_QUOTE_ITEMS,
  INITIAL_STORE_SETTINGS,
  LEGACY_V1_INVENTORY_IDS,
} from './data/initialData';
import {
  ACCOUNT_SESSION_STORAGE_KEY,
  clearAccountSession,
  loadSavedAccountSession,
} from './services/accountAuth';
import {
  apiDeleteWorkspaceLogo,
  apiDeleteWorkspaceSignature,
  apiFetchWorkspaceSnapshot,
  apiGetWorkspaceLogo,
  apiGetWorkspaceSignature,
  apiPutWorkspaceLogo,
  apiPutWorkspaceSignature,
  CloudRelayError,
} from './services/cloudApiClient';
import {
  clearDeletedTombstone,
  deleteCloudInvoice,
  discoverLegacyPreAccountInvoices,
  explicitlyDeleteLocalInvoice,
  generateInvoiceCode,
  getWorkspaceSavedStorageKey,
  hydrateAllLocalSavedInvoices,
  loadExplicitlyDeletedIds,
  loadLocalSavedInvoices,
  loadPendingCloudDeleteIds,
  markLegacyImportHandled,
  normalizeSavedInvoice,
  removeConfirmedCloudDeletedInvoices,
  sanitizeSafeId,
  saveLocalSavedInvoices,
  saveLocalSavedInvoicesAsync,
  subscribeToCloudInvoices,
  updateCloudInvoiceStage,
  upsertCloudInvoice,
} from './services/invoiceStorage';
import {
  areStoreSettingsEqual,
  getWorkspaceSettingsStorageKey,
  loadLocalWorkspaceProducts,
  loadLocalWorkspaceSettings,
  normalizeStoreSettings,
  saveLocalWorkspaceProducts,
  saveLocalWorkspaceSettings,
  subscribeToWorkspaceProducts,
  subscribeToWorkspaceSettings,
  syncFullWorkspaceCatalogToCloud,
  upsertWorkspaceSettingsToCloud,
} from './services/workspaceDataSync';
import {
  buildPhoneCustomerId,
  clearCustomerDeletedTombstone,
  deleteCustomerFromCloud,
  getWorkspaceCustomersStorageKey,
  getWorkspaceVoucherBudgetsStorageKey,
  loadLocalCustomers,
  loadLocalVoucherBudgets,
  markCustomerDeletedLocally,
  mergeCustomerContacts,
  mergeVoucherBudgets,
  normalizeCustomerContact,
  normalizePhoneDigits,
  normalizeVoucherBudget,
  saveLocalCustomers,
  saveLocalVoucherBudgets,
  subscribeToCustomers,
  subscribeToVoucherBudgets,
  upsertCustomerToCloud,
  upsertVoucherBudgetToCloud,
} from './services/planStorage';
import {
  clearLocalWorkspaceLogo,
  getWorkspaceLogoStorageKey,
  loadLocalWorkspaceLogoAsync,
  loadLocalWorkspaceLogoSync,
  processOriginalLogoFile,
  saveLocalWorkspaceLogo,
  WorkspaceLogoRecord,
} from './services/workspaceLogoStorage';
import {
  clearLocalWorkspaceSignature,
  getWorkspaceSignatureStorageKey,
  loadLocalWorkspaceSignatureAsync,
  loadLocalWorkspaceSignatureSync,
  processSignatureImageFile,
  saveLocalWorkspaceSignature,
  WorkspaceSignatureRecord,
} from './services/workspaceSignatureStorage';
import {
  clearAllInventoryDeletedTombstones,
  clearInventoryDeletedTombstone,
  deleteInventoryItemFromCloud,
  getInventoryAlerts,
  getWorkspaceInventoryStorageKey,
  loadLocalInventory,
  markInventoryCatalogV2Ready,
  markInventoryItemDeletedLocally,
  mergeInventoryItems,
  normalizeInventoryItem,
  saveLocalInventory,
  subscribeToInventory,
  syncFullInventoryToCloud,
  upsertInventoryItemToCloud,
} from './services/inventoryStorage';
import {
  clearManualRevenueDeletedTombstone,
  deleteRevenueEntryFromCloud,
  getWorkspaceRevenueEntriesStorageKey,
  loadLocalRevenueEntries,
  markManualRevenueDeletedLocally,
  mergeRevenueEntries,
  normalizeRevenueEntry,
  reconcileInvoicesIntoRevenueEntries,
  saveLocalRevenueEntries,
  subscribeToRevenueEntries,
  upsertRevenueEntryToCloud,
} from './services/revenueStorage';
import {
  AccountSession,
  AiNavigateTarget,
  AiOrderAction,
  AiOrderExecutionSummary,
  AppTab,
  CustomerContact,
  CustomerInfo,
  InventoryItem,
  PlanSubTab,
  Product,
  QuoteItem,
  ReportStage,
  ReportSubView,
  RevenueEntry,
  SavedInvoice,
  StoreSettings,
  VoucherBudget,
} from './types';
import {
  copyInvoiceImageToClipboard,
  exportInvoicePDF,
  exportInvoicePNG,
  InvoiceExportPayload,
} from './utils/exportInvoice';
import {
  calculateQuoteTotals,
  formatISODateVN,
  formatVND,
  generateCustomerCode,
  getLocalISODate,
} from './utils/formatters';
import {
  getUncollectedRemainingAmount,
  sanitizeOptionalOrderDate,
} from './utils/revenueSplit';
import {
  loadSoundEnabled,
  playTinSound,
  saveSoundEnabled,
} from './utils/sound';
import { auditInvoiceVoucher } from './utils/voucherAudit';

const INTERACTIVE_SOUND_SELECTOR = [
  'button:not(:disabled)',
  '[role="button"]',
  'a[href]',
  'select:not(:disabled)',
  'summary',
  'input[type="date"]:not(:disabled)',
  'input[type="checkbox"]:not(:disabled)',
  'input[type="radio"]:not(:disabled)',
  '[data-tin-sound="true"]',
].join(', ');

function getInitialUrlRoute(): {
  initialTab: AppTab;
  initialInvoiceId: string | null;
  initialReportSubView: ReportSubView;
  initialReportStage: ReportStageFilter;
  initialPlanSubTab: PlanSubTab;
} {
  if (typeof window === 'undefined') {
    return {
      initialTab: AppTab.WORKSPACE,
      initialInvoiceId: null,
      initialReportSubView: 'monthly_revenue',
      initialReportStage: 'bao_gia',
      initialPlanSubTab: 'voucher',
    };
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const tabParam = (params.get('tab') || '').toLowerCase();
    const invParam = (params.get('invoice') || '').trim();
    const stageParam = (params.get('stage') || '').trim();
    const viewParam = (params.get('view') || '').toLowerCase();
    const subParam = (params.get('sub') || '').toLowerCase();
    const parsedStage: ReportStageFilter =
      stageParam === 'all'
        ? 'all'
        : sanitizeReportStage(stageParam) || 'bao_gia';
    const parsedReportSubView: ReportSubView =
      viewParam === 'pipeline' || Boolean(stageParam)
        ? 'pipeline'
        : 'monthly_revenue';
    const parsedPlanSub: PlanSubTab =
      subParam === 'customers' ? 'customers' : 'voucher';

    if (tabParam === 'inventory' || tabParam === 'kho') {
      return {
        initialTab: AppTab.INVENTORY,
        initialInvoiceId: null,
        initialReportSubView: 'monthly_revenue',
        initialReportStage: 'bao_gia',
        initialPlanSubTab: 'voucher',
      };
    }
    if (tabParam === 'plan') {
      return {
        initialTab: AppTab.PLAN,
        initialInvoiceId: null,
        initialReportSubView: 'monthly_revenue',
        initialReportStage: 'bao_gia',
        initialPlanSubTab: parsedPlanSub,
      };
    }
    if (tabParam === 'reports') {
      return {
        initialTab: AppTab.REPORTS,
        initialInvoiceId: invParam || null,
        initialReportSubView: parsedReportSubView,
        initialReportStage: parsedStage,
        initialPlanSubTab: 'voucher',
      };
    }
    if (tabParam === 'saved' || invParam) {
      return {
        initialTab: AppTab.SAVED,
        initialInvoiceId: invParam || null,
        initialReportSubView: 'monthly_revenue',
        initialReportStage: 'bao_gia',
        initialPlanSubTab: 'voucher',
      };
    }
  } catch {
    // Ignore malformed query strings
  }
  return {
    initialTab: AppTab.WORKSPACE,
    initialInvoiceId: null,
    initialReportSubView: 'monthly_revenue',
    initialReportStage: 'bao_gia',
    initialPlanSubTab: 'voucher',
  };
}

export default function App() {
  const initialRoute = useMemo(() => getInitialUrlRoute(), []);

  const [accountSession, setAccountSession] = useState<AccountSession | null>(
    () => loadSavedAccountSession()
  );

  const [activeTab, setActiveTab] = useState<AppTab>(initialRoute.initialTab);
  const [activeReportSubView, setActiveReportSubView] = useState<ReportSubView>(
    initialRoute.initialReportSubView
  );
  const [activeReportStage, setActiveReportStage] = useState<ReportStageFilter>(
    initialRoute.initialReportStage
  );
  const [activePlanSubTab, setActivePlanSubTab] = useState<PlanSubTab>(
    initialRoute.initialPlanSubTab
  );
  const [activeInventorySubTab, setActiveInventorySubTab] =
    useState<InventorySubTab>('stock');
  const [viewingInvoiceId, setViewingInvoiceId] = useState<string | null>(
    initialRoute.initialInvoiceId
  );

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() =>
    loadSoundEnabled()
  );

  const [products, setProducts] = useState<Product[]>(() => {
    const sess = loadSavedAccountSession();
    return sess
      ? loadLocalWorkspaceProducts(sess.workspaceId)
      : INITIAL_PRODUCTS;
  });

  const [storeSettings, setStoreSettings] = useState<StoreSettings>(() => {
    const sess = loadSavedAccountSession();
    return sess
      ? loadLocalWorkspaceSettings(sess.workspaceId)
      : normalizeStoreSettings(INITIAL_STORE_SETTINGS);
  });

  const [workspaceLogo, setWorkspaceLogo] =
    useState<WorkspaceLogoRecord | null>(() => {
      const sess = loadSavedAccountSession();
      return sess ? loadLocalWorkspaceLogoSync(sess.workspaceId) : null;
    });
  const [isUploadingLogo, setIsUploadingLogo] = useState<boolean>(false);

  const [workspaceSignature, setWorkspaceSignature] =
    useState<WorkspaceSignatureRecord | null>(() => {
      const sess = loadSavedAccountSession();
      return sess ? loadLocalWorkspaceSignatureSync(sess.workspaceId) : null;
    });
  const [isUploadingSignature, setIsUploadingSignature] =
    useState<boolean>(false);

  // Active Invoice Workspace State
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string>(() =>
    new Date().toISOString()
  );
  const [expectedDemoDate, setExpectedDemoDate] = useState<string>(() =>
    getLocalISODate(1)
  );
  const [customer, setCustomer] = useState<CustomerInfo>(INITIAL_CUSTOMER);
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>(INITIAL_QUOTE_ITEMS);
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [shippingFee, setShippingFee] = useState<number>(0);
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const [designIllustration, setDesignIllustration] = useState<string>(
    DEFAULT_DESIGN_ILLUSTRATION
  );
  const [invoiceNote, setInvoiceNote] = useState<string>(
    () => storeSettings.footerNote
  );
  const [draftInvoiceStage, setDraftInvoiceStage] = useState<ReportStage | ''>(
    ''
  );
  const [draftRemainingPaid, setDraftRemainingPaid] = useState<boolean>(false);
  const [draftRemainingPaidAt, setDraftRemainingPaidAt] = useState<string>('');

  // Saved Invoices Archive State ("Tệp lưu") — Scoped strictly to accountSession.workspaceId
  const [savedInvoices, setSavedInvoices] = useState<SavedInvoice[]>(() => {
    const sess = loadSavedAccountSession();
    return sess ? loadLocalSavedInvoices(sess.workspaceId) : [];
  });
  const [voucherBudgets, setVoucherBudgets] = useState<VoucherBudget[]>(() => {
    const sess = loadSavedAccountSession();
    return sess ? loadLocalVoucherBudgets(sess.workspaceId) : [];
  });
  const [workspaceCustomers, setWorkspaceCustomers] = useState<
    CustomerContact[]
  >(() => {
    const sess = loadSavedAccountSession();
    return sess ? loadLocalCustomers(sess.workspaceId) : [];
  });
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>(() => {
    const sess = loadSavedAccountSession();
    return sess
      ? loadLocalInventory(sess.workspaceId)
      : INITIAL_INVENTORY_ITEMS.map((item) => ({ ...item }));
  });
  const [revenueEntries, setRevenueEntries] = useState<RevenueEntry[]>(() => {
    const sess = loadSavedAccountSession();
    return sess ? loadLocalRevenueEntries(sess.workspaceId) : [];
  });
  const [localHydrated, setLocalHydrated] = useState<boolean>(false);
  const [isLoadingCloud, setIsLoadingCloud] = useState<boolean>(true);
  const [serverConnected, setServerConnected] = useState<boolean>(true);
  const [cloudError, setCloudError] = useState<string | null>(null);

  // Optional 1-click import of pre-account legacy quotes
  const [legacyQuotes, setLegacyQuotes] = useState<SavedInvoice[]>([]);
  const [isImportingLegacy, setIsImportingLegacy] = useState<boolean>(false);

  const inFlightSaveIdsRef = useRef<Set<string>>(new Set());
  const syncingLocalIdsRef = useRef<Set<string>>(new Set());
  const flushingDeleteIdsRef = useRef<Set<string>>(new Set());
  const recentlySavedAtRef = useRef<Map<string, number>>(new Map());
  const serverSnapshotVersionRef = useRef<number>(0);
  const previousServerCloudIdsRef = useRef<Set<string>>(new Set());
  const seededInitialMetaRef = useRef<boolean>(false);
  const seededInitialInventoryRef = useRef<boolean>(false);
  const pullingSnapshotRef = useRef<boolean>(false);

  const savedInvoicesRef = useRef<SavedInvoice[]>(savedInvoices);
  savedInvoicesRef.current = savedInvoices;
  const workspaceCustomersRef =
    useRef<CustomerContact[]>(workspaceCustomers);
  workspaceCustomersRef.current = workspaceCustomers;
  const accountSessionRef = useRef<AccountSession | null>(accountSession);
  accountSessionRef.current = accountSession;
  const storeSettingsRef = useRef<StoreSettings>(storeSettings);
  storeSettingsRef.current = storeSettings;
  const editingInvoiceIdRef = useRef<string | null>(editingInvoiceId);
  editingInvoiceIdRef.current = editingInvoiceId;

  const activeBillStateRef = useRef({
    editingInvoiceId,
    createdAt,
    expectedDemoDate,
    customer,
    quoteItems,
    discountAmount,
    shippingFee,
    depositAmount,
    designIllustration,
    invoiceNote,
    draftInvoiceStage,
    draftRemainingPaid,
    draftRemainingPaidAt,
    products,
  });
  activeBillStateRef.current = {
    editingInvoiceId,
    createdAt,
    expectedDemoDate,
    customer,
    quoteItems,
    discountAmount,
    shippingFee,
    depositAmount,
    designIllustration,
    invoiceNote,
    draftInvoiceStage,
    draftRemainingPaid,
    draftRemainingPaidAt,
    products,
  };

  const catalogSyncTimerRef = useRef<number | null>(null);
  const pendingCatalogSyncRef = useRef<{
    session: AccountSession;
    products: Product[];
  } | null>(null);

  const flushPendingCatalogSync = useCallback(() => {
    if (catalogSyncTimerRef.current !== null) {
      window.clearTimeout(catalogSyncTimerRef.current);
      catalogSyncTimerRef.current = null;
    }
    const pending = pendingCatalogSyncRef.current;
    if (pending) {
      pendingCatalogSyncRef.current = null;
      saveLocalWorkspaceProducts(pending.session.workspaceId, pending.products);
      void syncFullWorkspaceCatalogToCloud(pending.session, pending.products);
    }
  }, []);

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [fallbackImageUrl, setFallbackImageUrl] = useState<string | null>(null);
  const [fallbackImageMeta, setFallbackImageMeta] = useState<{
    downloadName: string;
    altText: string;
  }>({
    downloadName: 'Bao-Gia-ATD-Color.png',
    altText: 'Hóa đơn tham khảo ATD Color',
  });
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);
  const [saleCheerAction, setSaleCheerAction] = useState<
    'save' | 'copy' | 'price_sheet' | null
  >(null);
  const saleCheerTimerRef = useRef<number | null>(null);
  const saveSuccessTimerRef = useRef<number | null>(null);
  const copySuccessTimerRef = useRef<number | null>(null);

  const triggerSaleCheer = useCallback(
    (action: 'save' | 'copy' | 'price_sheet') => {
      setSaleCheerAction(action);
      if (saleCheerTimerRef.current !== null) {
        window.clearTimeout(saleCheerTimerRef.current);
      }
      saleCheerTimerRef.current = window.setTimeout(() => {
        setSaleCheerAction(null);
        saleCheerTimerRef.current = null;
      }, 4500);
    },
    []
  );

  const triggerSaveSuccessBanner = useCallback(() => {
    setSaveSuccess(true);
    if (saveSuccessTimerRef.current !== null) {
      window.clearTimeout(saveSuccessTimerRef.current);
    }
    saveSuccessTimerRef.current = window.setTimeout(() => {
      setSaveSuccess(false);
      saveSuccessTimerRef.current = null;
    }, 4500);
  }, []);

  const triggerCopySuccessBanner = useCallback(() => {
    setCopySuccess(true);
    if (copySuccessTimerRef.current !== null) {
      window.clearTimeout(copySuccessTimerRef.current);
    }
    copySuccessTimerRef.current = window.setTimeout(() => {
      setCopySuccess(false);
      copySuccessTimerRef.current = null;
    }, 4500);
  }, []);

  useEffect(() => {
    if (!storeSettings.showCalculator) {
      setIsCalculatorOpen(false);
    }
  }, [storeSettings.showCalculator]);

  useEffect(() => {
    if (!storeSettings.showAiChat) {
      setIsAiChatOpen(false);
    }
  }, [storeSettings.showAiChat]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      flushPendingCatalogSync();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushPendingCatalogSync();
      if (saleCheerTimerRef.current !== null) {
        window.clearTimeout(saleCheerTimerRef.current);
      }
      if (saveSuccessTimerRef.current !== null) {
        window.clearTimeout(saveSuccessTimerRef.current);
      }
      if (copySuccessTimerRef.current !== null) {
        window.clearTimeout(copySuccessTimerRef.current);
      }
    };
  }, [flushPendingCatalogSync]);

  const handleSelectTab = useCallback((nextTab: AppTab) => {
    setActiveTab(nextTab);
    try {
      const url = new URL(window.location.href);
      if (nextTab === AppTab.SAVED) {
        url.searchParams.set('tab', 'saved');
        url.searchParams.delete('stage');
        url.searchParams.delete('view');
        url.searchParams.delete('sub');
      } else if (nextTab === AppTab.REPORTS) {
        url.searchParams.set('tab', 'reports');
        url.searchParams.delete('invoice');
        url.searchParams.delete('sub');
      } else if (nextTab === AppTab.PLAN) {
        url.searchParams.set('tab', 'plan');
        url.searchParams.delete('invoice');
        url.searchParams.delete('stage');
        url.searchParams.delete('view');
      } else if (nextTab === AppTab.INVENTORY) {
        url.searchParams.set('tab', 'inventory');
        url.searchParams.delete('invoice');
        url.searchParams.delete('stage');
        url.searchParams.delete('view');
        url.searchParams.delete('sub');
      } else {
        url.searchParams.delete('tab');
        url.searchParams.delete('invoice');
        url.searchParams.delete('stage');
        url.searchParams.delete('view');
        url.searchParams.delete('sub');
      }
      window.history.replaceState(null, '', url.toString());
    } catch {
      // Ignore history state restrictions
    }
  }, []);

  const handleSelectPlanSubTab = useCallback((sub: PlanSubTab) => {
    setActivePlanSubTab(sub);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('tab') === 'plan') {
        url.searchParams.set('sub', sub);
        window.history.replaceState(null, '', url.toString());
      }
    } catch {
      // Ignore history state restrictions
    }
  }, []);

  const handleOpenReorderTable = useCallback(() => {
    setActiveInventorySubTab('reorder');
    handleSelectTab(AppTab.INVENTORY);
  }, [handleSelectTab]);

  const handleSelectReportSubView = useCallback((view: ReportSubView) => {
    setActiveReportSubView(view);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('tab') === 'reports') {
        url.searchParams.set(
          'view',
          view === 'pipeline' ? 'pipeline' : 'revenue'
        );
        if (view === 'monthly_revenue') {
          url.searchParams.delete('stage');
        }
        window.history.replaceState(null, '', url.toString());
      }
    } catch {
      // Ignore history state restrictions
    }
  }, []);

  const handleSelectReportStage = useCallback((stage: ReportStageFilter) => {
    setActiveReportStage(stage);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('tab') === 'reports') {
        url.searchParams.set('view', 'pipeline');
        url.searchParams.set('stage', stage);
        window.history.replaceState(null, '', url.toString());
      }
    } catch {
      // Ignore history state restrictions
    }
  }, []);

  const handleOpenReportsTab = useCallback((stage?: ReportStage) => {
    if (stage) {
      setActiveReportSubView('pipeline');
      setActiveReportStage(stage);
    } else {
      setActiveReportSubView('monthly_revenue');
    }
    setActiveTab(AppTab.REPORTS);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'reports');
      url.searchParams.delete('invoice');
      if (stage) {
        url.searchParams.set('view', 'pipeline');
        url.searchParams.set('stage', stage);
      } else {
        url.searchParams.set('view', 'revenue');
        url.searchParams.delete('stage');
      }
      window.history.replaceState(null, '', url.toString());
    } catch {
      // Ignore history state restrictions
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const resetActiveDraftForSession = useCallback((settings: StoreSettings) => {
    setEditingInvoiceId(null);
    setViewingInvoiceId(null);
    setQuoteItems([]);
    setDiscountAmount(0);
    setShippingFee(0);
    setDepositAmount(0);
    setCustomer(INITIAL_CUSTOMER);
    setCreatedAt(new Date().toISOString());
    setExpectedDemoDate(getLocalISODate(1));
    setDesignIllustration(DEFAULT_DESIGN_ILLUSTRATION);
    setInvoiceNote(settings.footerNote);
    setDraftInvoiceStage('');
    setDraftRemainingPaid(false);
    setDraftRemainingPaidAt('');
    setCloudError(null);
    inFlightSaveIdsRef.current.clear();
    syncingLocalIdsRef.current.clear();
    flushingDeleteIdsRef.current.clear();
    recentlySavedAtRef.current.clear();
    serverSnapshotVersionRef.current = 0;
    previousServerCloudIdsRef.current.clear();
    seededInitialMetaRef.current = false;
    seededInitialInventoryRef.current = false;
  }, []);

  const handleChangeDraftStage = useCallback(
    (nextStage: ReportStage | '') => {
      const safeStage = sanitizeReportStage(nextStage);
      setDraftInvoiceStage(safeStage);
      if (safeStage === 'hoan_thanh') {
        setDraftRemainingPaid(true);
        setDraftRemainingPaidAt(
          (prev) => sanitizeOptionalOrderDate(prev) || getLocalISODate(0)
        );
      } else {
        setDraftRemainingPaid(false);
      }
    },
    []
  );

  const handleToggleDraftRemainingPaid = useCallback(
    (paid: boolean, paidAt?: string) => {
      if (paid) {
        const safeDate =
          sanitizeOptionalOrderDate(paidAt) ||
          sanitizeOptionalOrderDate(
            activeBillStateRef.current.draftRemainingPaidAt
          ) ||
          getLocalISODate(0);
        setDraftRemainingPaid(true);
        setDraftRemainingPaidAt(safeDate);
        setDraftInvoiceStage('hoan_thanh');
      } else {
        setDraftRemainingPaid(false);
        if (paidAt !== undefined) {
          setDraftRemainingPaidAt(sanitizeOptionalOrderDate(paidAt));
        } else {
          setDraftRemainingPaidAt('');
        }
        setDraftInvoiceStage((prev) =>
          prev === 'hoan_thanh'
            ? activeBillStateRef.current.depositAmount > 0
              ? 'coc'
              : 'bao_gia'
            : prev
        );
      }
    },
    []
  );

  const handleAuthenticated = useCallback(
    (session: AccountSession) => {
      const nextSettings = loadLocalWorkspaceSettings(session.workspaceId);
      const nextProducts = loadLocalWorkspaceProducts(session.workspaceId);
      const nextInvoices = loadLocalSavedInvoices(session.workspaceId);
      const nextBudgets = loadLocalVoucherBudgets(session.workspaceId);
      const nextCustomers = loadLocalCustomers(session.workspaceId);
      const nextInventory = loadLocalInventory(session.workspaceId);
      const nextRevenueEntries = loadLocalRevenueEntries(session.workspaceId);
      const nextLogo = loadLocalWorkspaceLogoSync(session.workspaceId);
      const nextSignature = loadLocalWorkspaceSignatureSync(
        session.workspaceId
      );

      setLocalHydrated(false);
      setIsLoadingCloud(true);
      setServerConnected(true);
      setLegacyQuotes([]);
      setStoreSettings(nextSettings);
      setWorkspaceLogo(nextLogo);
      setWorkspaceSignature(nextSignature);
      setProducts(nextProducts);
      setSavedInvoices(nextInvoices);
      setVoucherBudgets(nextBudgets);
      setWorkspaceCustomers(nextCustomers);
      setInventoryItems(nextInventory);
      setRevenueEntries(nextRevenueEntries);
      resetActiveDraftForSession(nextSettings);
      setAccountSession(session);
    },
    [resetActiveDraftForSession]
  );

  const handleLogout = useCallback(() => {
    flushPendingCatalogSync();
    clearAccountSession();
    setAccountSession(null);
    setWorkspaceLogo(null);
    setWorkspaceSignature(null);
    setSavedInvoices([]);
    setVoucherBudgets([]);
    setWorkspaceCustomers([]);
    setInventoryItems(INITIAL_INVENTORY_ITEMS.map((item) => ({ ...item })));
    setRevenueEntries([]);
    setLegacyQuotes([]);
    setLocalHydrated(false);
    resetActiveDraftForSession(normalizeStoreSettings(INITIAL_STORE_SETTINGS));
  }, [flushPendingCatalogSync, resetActiveDraftForSession]);

  // Global zero-latency "tin" chime on interactive elements
  useEffect(() => {
    if (!soundEnabled) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-mute-toggle="true"]')) return;
      if (target.closest(INTERACTIVE_SOUND_SELECTOR)) {
        playTinSound();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-mute-toggle="true"]')) return;
      if (
        target.matches('button:not(:disabled), [role="button"], a[href], summary')
      ) {
        playTinSound();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, {
      passive: true,
    });
    document.addEventListener('keydown', handleKeyDown, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [soundEnabled]);

  // Cross-tab synchronization for account session & saved invoices within the same browser
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === ACCOUNT_SESSION_STORAGE_KEY) {
        const nextSess = loadSavedAccountSession();
        if (!nextSess) {
          setAccountSession(null);
          setSavedInvoices([]);
          setLocalHydrated(false);
        } else if (nextSess.workspaceId !== accountSession?.workspaceId) {
          handleAuthenticated(nextSess);
        }
        return;
      }
      if (
        accountSession &&
        e.key === getWorkspaceSavedStorageKey(accountSession.workspaceId)
      ) {
        setSavedInvoices(loadLocalSavedInvoices(accountSession.workspaceId));
        return;
      }
      if (
        accountSession &&
        e.key === getWorkspaceSettingsStorageKey(accountSession.workspaceId)
      ) {
        const nextLocalSettings = loadLocalWorkspaceSettings(
          accountSession.workspaceId
        );
        setStoreSettings((prev) =>
          areStoreSettingsEqual(prev, nextLocalSettings)
            ? prev
            : nextLocalSettings
        );
        return;
      }
      if (
        accountSession &&
        e.key === getWorkspaceLogoStorageKey(accountSession.workspaceId)
      ) {
        void loadLocalWorkspaceLogoAsync(accountSession.workspaceId).then(
          (cachedLogo) => {
            setWorkspaceLogo(cachedLogo);
          }
        );
        return;
      }
      if (
        accountSession &&
        e.key === getWorkspaceSignatureStorageKey(accountSession.workspaceId)
      ) {
        void loadLocalWorkspaceSignatureAsync(accountSession.workspaceId).then(
          (cachedSig) => {
            setWorkspaceSignature(cachedSig);
          }
        );
        return;
      }
      if (
        accountSession &&
        e.key ===
          getWorkspaceVoucherBudgetsStorageKey(accountSession.workspaceId)
      ) {
        setVoucherBudgets(loadLocalVoucherBudgets(accountSession.workspaceId));
        return;
      }
      if (
        accountSession &&
        e.key === getWorkspaceCustomersStorageKey(accountSession.workspaceId)
      ) {
        setWorkspaceCustomers(loadLocalCustomers(accountSession.workspaceId));
        return;
      }
      if (
        accountSession &&
        e.key === getWorkspaceInventoryStorageKey(accountSession.workspaceId)
      ) {
        setInventoryItems(loadLocalInventory(accountSession.workspaceId));
        return;
      }
      if (
        accountSession &&
        e.key ===
          getWorkspaceRevenueEntriesStorageKey(accountSession.workspaceId)
      ) {
        setRevenueEntries(loadLocalRevenueEntries(accountSession.workspaceId));
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [accountSession, handleAuthenticated]);

  // Synchronize original company logo across IndexedDB + Express server whenever accountSession or storeSettings.logoVersion changes
  useEffect(() => {
    if (!accountSession) {
      setWorkspaceLogo(null);
      return;
    }

    const wsId = accountSession.workspaceId;
    const expectedVersion = (storeSettings.logoVersion || '').trim();
    let active = true;

    const syncWorkspaceLogo = async () => {
      const localCached = await loadLocalWorkspaceLogoAsync(wsId);
      if (!active) return;

      if (!expectedVersion) {
        try {
          const remote = await apiGetWorkspaceLogo(wsId);
          if (!active) return;
          if (remote.hasLogo && remote.dataUrl) {
            const ver = remote.version || `lg_${Date.now().toString(36)}`;
            await saveLocalWorkspaceLogo(wsId, ver, remote.dataUrl);
            if (!active) return;
            setWorkspaceLogo({
              version: ver,
              dataUrl: remote.dataUrl,
              updatedAt: new Date().toISOString(),
            });
            return;
          }
          // Server confirms no logo exists -> safe to clear local cache
          setWorkspaceLogo(null);
          if (localCached) {
            await clearLocalWorkspaceLogo(wsId);
          }
        } catch {
          // Offline fallback: if user explicitly has empty logoVersion locally, hide logo
          setWorkspaceLogo(null);
        }
        return;
      }

      if (localCached && localCached.version === expectedVersion) {
        setWorkspaceLogo(localCached);
        // Lightweight metadata-only check (~65 bytes) to self-heal if server restarted without disk file
        try {
          const remote = await apiGetWorkspaceLogo(wsId, { metaOnly: true });
          if (
            active &&
            (!remote.hasLogo || remote.version !== localCached.version)
          ) {
            await apiPutWorkspaceLogo(
              accountSession,
              localCached.version,
              localCached.dataUrl
            );
          }
        } catch {
          // Ignore transient network errors; local cache is already rendered
        }
        return;
      }

      // Another device uploaded a newer logoVersion: pull from server and cache locally
      try {
        const remote = await apiGetWorkspaceLogo(wsId);
        if (!active) return;
        if (remote.hasLogo && remote.dataUrl) {
          const ver = remote.version || expectedVersion;
          await saveLocalWorkspaceLogo(wsId, ver, remote.dataUrl);
          if (!active) return;
          setWorkspaceLogo({
            version: ver,
            dataUrl: remote.dataUrl,
            updatedAt: new Date().toISOString(),
          });
        } else if (localCached) {
          // Server has no copy yet; display local fallback and re-seed server
          setWorkspaceLogo(localCached);
          await apiPutWorkspaceLogo(
            accountSession,
            localCached.version,
            localCached.dataUrl
          );
        }
      } catch {
        if (active && localCached) {
          setWorkspaceLogo(localCached);
        }
      }
    };

    void syncWorkspaceLogo();

    return () => {
      active = false;
    };
  }, [accountSession, storeSettings.logoVersion]);

  // Synchronize preparer signature across IndexedDB + Express server whenever accountSession or storeSettings.signatureVersion changes
  useEffect(() => {
    if (!accountSession) {
      setWorkspaceSignature(null);
      return;
    }

    const wsId = accountSession.workspaceId;
    const expectedVersion = (storeSettings.signatureVersion || '').trim();
    let active = true;

    const syncWorkspaceSignature = async () => {
      const localCached = await loadLocalWorkspaceSignatureAsync(wsId);
      if (!active) return;

      if (!expectedVersion) {
        try {
          const remote = await apiGetWorkspaceSignature(wsId);
          if (!active) return;
          if (remote.hasSignature && remote.dataUrl) {
            const ver = remote.version || `sg_${Date.now().toString(36)}`;
            await saveLocalWorkspaceSignature(wsId, ver, remote.dataUrl);
            if (!active) return;
            setWorkspaceSignature({
              version: ver,
              dataUrl: remote.dataUrl,
              updatedAt: new Date().toISOString(),
            });
            return;
          }
          setWorkspaceSignature(null);
          if (localCached) {
            await clearLocalWorkspaceSignature(wsId);
          }
        } catch {
          setWorkspaceSignature(null);
        }
        return;
      }

      if (localCached && localCached.version === expectedVersion) {
        setWorkspaceSignature(localCached);
        try {
          const remote = await apiGetWorkspaceSignature(wsId, {
            metaOnly: true,
          });
          if (
            active &&
            (!remote.hasSignature || remote.version !== localCached.version)
          ) {
            await apiPutWorkspaceSignature(
              accountSession,
              localCached.version,
              localCached.dataUrl
            );
          }
        } catch {
          // Ignore transient network errors; local cache is already rendered
        }
        return;
      }

      try {
        const remote = await apiGetWorkspaceSignature(wsId);
        if (!active) return;
        if (remote.hasSignature && remote.dataUrl) {
          const ver = remote.version || expectedVersion;
          await saveLocalWorkspaceSignature(wsId, ver, remote.dataUrl);
          if (!active) return;
          setWorkspaceSignature({
            version: ver,
            dataUrl: remote.dataUrl,
            updatedAt: new Date().toISOString(),
          });
        } else if (localCached) {
          setWorkspaceSignature(localCached);
          await apiPutWorkspaceSignature(
            accountSession,
            localCached.version,
            localCached.dataUrl
          );
        }
      } catch {
        if (active && localCached) {
          setWorkspaceSignature(localCached);
        }
      }
    };

    void syncWorkspaceSignature();

    return () => {
      active = false;
    };
  }, [accountSession, storeSettings.signatureVersion]);

  // Subscribe to shared StoreSettings & Catalog Products via Client Firestore (Engine A)
  useEffect(() => {
    if (!accountSession) return;

    const unsubSettings = subscribeToWorkspaceSettings(
      accountSession,
      (remoteSettings) => {
        setServerConnected(true);
        setStoreSettings((prev) => {
          if (areStoreSettingsEqual(prev, remoteSettings)) {
            return prev;
          }
          setInvoiceNote((currNote) =>
            !currNote.trim() || currNote === prev.footerNote
              ? remoteSettings.footerNote
              : currNote
          );
          return remoteSettings;
        });
      }
    );

    const unsubProducts = subscribeToWorkspaceProducts(
      accountSession,
      (remoteProducts) => {
        setServerConnected(true);
        setProducts(remoteProducts);
      }
    );

    const unsubVoucherBudgets = subscribeToVoucherBudgets(
      accountSession,
      (remoteBudgets) => {
        setServerConnected(true);
        setVoucherBudgets((prev) => {
          const merged = mergeVoucherBudgets(prev, remoteBudgets);
          saveLocalVoucherBudgets(accountSession.workspaceId, merged);
          return merged;
        });
      }
    );

    const unsubCustomers = subscribeToCustomers(
      accountSession,
      (remoteCustomers) => {
        setServerConnected(true);
        setWorkspaceCustomers((prev) => {
          const merged = mergeCustomerContacts(
            accountSession.workspaceId,
            prev,
            remoteCustomers
          );
          saveLocalCustomers(accountSession.workspaceId, merged);
          return merged;
        });
      }
    );

    const unsubInventory = subscribeToInventory(
      accountSession,
      (remoteInventory) => {
        setServerConnected(true);
        setInventoryItems((prev) => {
          const merged = mergeInventoryItems(
            accountSession.workspaceId,
            prev,
            remoteInventory
          );
          saveLocalInventory(accountSession.workspaceId, merged);
          return merged;
        });
      }
    );

    const unsubRevenueEntries = subscribeToRevenueEntries(
      accountSession,
      (remoteRevenueEntries) => {
        setServerConnected(true);
        setRevenueEntries((prev) => {
          const merged = mergeRevenueEntries(
            accountSession.workspaceId,
            prev,
            remoteRevenueEntries
          );
          saveLocalRevenueEntries(accountSession.workspaceId, merged);
          return merged;
        });
      }
    );

    return () => {
      unsubSettings();
      unsubProducts();
      unsubVoucherBudgets();
      unsubCustomers();
      unsubInventory();
      unsubRevenueEntries();
    };
  }, [accountSession]);

  // Hydrate workspace saved invoices from IndexedDB + backup storage before cloud merge
  useEffect(() => {
    if (!accountSession) return;
    const wsId = accountSession.workspaceId;
    let active = true;
    setLocalHydrated(false);

    void hydrateAllLocalSavedInvoices(wsId)
      .then((hydrated) => {
        if (!active) return;
        if (hydrated.length > 0) {
          setSavedInvoices((prev) => {
            const deletedIds = loadExplicitlyDeletedIds(wsId);
            const byId = new Map<string, SavedInvoice>();
            for (const inv of [...hydrated, ...prev]) {
              if (deletedIds.has(inv.id) || inv.items.length === 0) continue;
              const existing = byId.get(inv.id);
              if (
                !existing ||
                new Date(inv.updatedAt).getTime() >=
                  new Date(existing.updatedAt).getTime()
              ) {
                byId.set(inv.id, inv);
              }
            }
            const merged = Array.from(byId.values()).sort(
              (a, b) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime()
            );
            saveLocalSavedInvoices(wsId, merged);
            return merged;
          });
        }
      })
      .finally(() => {
        if (active) {
          setLocalHydrated(true);
        }
      });

    return () => {
      active = false;
    };
  }, [accountSession]);

  // Discover pre-account legacy quotes (optional 1-click migration)
  useEffect(() => {
    if (!accountSession || !localHydrated) return;
    let active = true;
    const wsId = accountSession.workspaceId;

    void discoverLegacyPreAccountInvoices(wsId).then((found) => {
      if (!active) return;
      setLegacyQuotes(found);
    });

    return () => {
      active = false;
    };
  }, [accountSession, localHydrated]);

  const unimportedLegacyQuotes = useMemo(() => {
    if (legacyQuotes.length === 0) return [];
    const existingIds = new Set(savedInvoices.map((inv) => inv.id));
    return legacyQuotes.filter((q) => !existingIds.has(q.id));
  }, [legacyQuotes, savedInvoices]);

  const uploadSingleInvoiceToCloud = useCallback(
    (session: AccountSession, invoice: SavedInvoice) => {
      if (syncingLocalIdsRef.current.has(invoice.id)) return;
      syncingLocalIdsRef.current.add(invoice.id);
      recentlySavedAtRef.current.set(invoice.id, Date.now());

      void upsertCloudInvoice(session, invoice)
        .then(() => {
          recentlySavedAtRef.current.set(invoice.id, Date.now());
          setServerConnected(true);
          setCloudError(null);
          setSavedInvoices((curr) => {
            const updated = curr.map((inv) =>
              inv.id === invoice.id
                ? {
                    ...inv,
                    syncedToCloud: true,
                    syncedOwnerUid: session.workspaceId,
                  }
                : inv
            );
            saveLocalSavedInvoices(session.workspaceId, updated);
            return updated;
          });
        })
        .catch((err) => {
          if (err instanceof Error && err.message.includes('Quota exceeded')) {
            setCloudError(
              'Hạn mức đám mây miễn phí hôm nay đã đầy. Hóa đơn đã được lưu an toàn trên thiết bị và sẽ tự đồng bộ sau.'
            );
          } else {
            setServerConnected(false);
          }
        })
        .finally(() => {
          syncingLocalIdsRef.current.delete(invoice.id);
        });
    },
    []
  );

  // Shared reconciliation logic used by both Client Firestore onSnapshot and Server Relay Polling
  const reconcileCloudInvoices = useCallback(
    (
      session: AccountSession,
      cloudList: SavedInvoice[],
      cloudIds: Set<string>,
      removedDocIds: Set<string>,
      snapshotFromCache: boolean
    ) => {
      const wsId = session.workspaceId;
      setIsLoadingCloud(false);
      if (!snapshotFromCache) {
        setServerConnected(true);
        setCloudError(null);
      }

      const deletedIds = loadExplicitlyDeletedIds(wsId);
      const pendingDeleteSet = new Set(loadPendingCloudDeleteIds(wsId));

      setSavedInvoices((prevLocal) => {
        const localById = new Map<string, SavedInvoice>();
        for (const loc of prevLocal) {
          if (!deletedIds.has(loc.id) && loc.items.length > 0) {
            localById.set(loc.id, loc);
          }
        }

        const mergedById = new Map<string, SavedInvoice>();
        const toUpload: SavedInvoice[] = [];
        const confirmedRemovedIds: string[] = [];

        // 1. Incorporate shared account cloud invoices
        for (const rawCloudInv of cloudList) {
          const cloudInv = normalizeSavedInvoice(
            {
              ...rawCloudInv,
              syncedToCloud: true,
              syncedOwnerUid: wsId,
            },
            wsId
          );

          if (deletedIds.has(cloudInv.id) || pendingDeleteSet.has(cloudInv.id)) {
            if (!flushingDeleteIdsRef.current.has(cloudInv.id)) {
              flushingDeleteIdsRef.current.add(cloudInv.id);
              void deleteCloudInvoice(session, cloudInv.id)
                .catch(() => {
                  // Retry on next connection
                })
                .finally(() => {
                  flushingDeleteIdsRef.current.delete(cloudInv.id);
                });
            }
            continue;
          }

          const localCopy = localById.get(cloudInv.id);
          if (localCopy && inFlightSaveIdsRef.current.has(cloudInv.id)) {
            mergedById.set(cloudInv.id, localCopy);
            continue;
          }

          if (
            localCopy &&
            !localCopy.syncedToCloud &&
            new Date(localCopy.updatedAt).getTime() >
              new Date(cloudInv.updatedAt).getTime()
          ) {
            mergedById.set(cloudInv.id, localCopy);
            toUpload.push(localCopy);
            continue;
          }

          mergedById.set(cloudInv.id, cloudInv);
        }

        // 2. Check all local invoices not yet present in cloudIds
        const nowMs = Date.now();
        for (const loc of localById.values()) {
          if (mergedById.has(loc.id) || cloudIds.has(loc.id)) continue;

          const lastSavedMs = recentlySavedAtRef.current.get(loc.id) || 0;
          const recentlyTouched = nowMs - lastSavedMs < 30_000;
          const wasConfirmedInAccountCloud =
            loc.syncedToCloud === true && loc.syncedOwnerUid === wsId;

          if (
            !snapshotFromCache &&
            !inFlightSaveIdsRef.current.has(loc.id) &&
            !syncingLocalIdsRef.current.has(loc.id) &&
            (removedDocIds.has(loc.id) ||
              (!recentlyTouched && wasConfirmedInAccountCloud))
          ) {
            confirmedRemovedIds.push(loc.id);
            continue;
          }

          mergedById.set(loc.id, loc);
          if (!inFlightSaveIdsRef.current.has(loc.id)) {
            toUpload.push(loc);
          }
        }

        const merged = Array.from(mergedById.values()).sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

        if (confirmedRemovedIds.length > 0) {
          void removeConfirmedCloudDeletedInvoices(
            wsId,
            confirmedRemovedIds,
            merged
          );
        } else {
          saveLocalSavedInvoices(wsId, merged);
        }

        for (const itemToSync of toUpload) {
          uploadSingleInvoiceToCloud(session, itemToSync);
        }

        return merged;
      });
    },
    [uploadSingleInvoiceToCloud]
  );

  // Pull live workspace snapshot via Same-Origin Express Relay (Engine B — immune to browser WebChannel blocks)
  const pullServerWorkspaceSnapshot = useCallback(
    async (forceFull = false) => {
      if (!accountSession || !localHydrated || pullingSnapshotRef.current) {
        return;
      }
      pullingSnapshotRef.current = true;
      const wsId = accountSession.workspaceId;

      try {
        const sinceVer = forceFull ? 0 : serverSnapshotVersionRef.current;
        const snap = await apiFetchWorkspaceSnapshot(wsId, sinceVer);

        setServerConnected(true);
        setIsLoadingCloud(false);

        if (snap.unchanged) {
          serverSnapshotVersionRef.current = snap.version;
          return;
        }

        serverSnapshotVersionRef.current = snap.version;

        // 1. Sync StoreSettings from server snapshot
        if (snap.settings) {
          const normalizedRemoteSettings = normalizeStoreSettings(snap.settings);
          saveLocalWorkspaceSettings(wsId, normalizedRemoteSettings);
          setStoreSettings((prev) => {
            if (areStoreSettingsEqual(prev, normalizedRemoteSettings)) {
              return prev;
            }
            setInvoiceNote((currNote) =>
              !currNote.trim() || currNote === prev.footerNote
                ? normalizedRemoteSettings.footerNote
                : currNote
            );
            return normalizedRemoteSettings;
          });
        } else if (!seededInitialMetaRef.current) {
          const initialSettings = loadLocalWorkspaceSettings(wsId);
          void upsertWorkspaceSettingsToCloud(accountSession, initialSettings);
        }

        // 2. Sync Product Catalog from server snapshot
        if (snap.products && snap.products.length > 0) {
          saveLocalWorkspaceProducts(wsId, snap.products);
          setProducts(snap.products);
        } else if (!seededInitialMetaRef.current) {
          const initialProds = loadLocalWorkspaceProducts(wsId);
          void syncFullWorkspaceCatalogToCloud(accountSession, initialProds);
        }
        seededInitialMetaRef.current = true;

        // 2B. Reconcile Voucher Budgets & Date KH Contacts from server snapshot
        if (Array.isArray(snap.voucherBudgets)) {
          setVoucherBudgets((prev) => {
            const merged = mergeVoucherBudgets(prev, snap.voucherBudgets!);
            saveLocalVoucherBudgets(wsId, merged);
            return merged;
          });
        }
        if (Array.isArray(snap.customers)) {
          setWorkspaceCustomers((prev) => {
            const merged = mergeCustomerContacts(wsId, prev, snap.customers!);
            saveLocalCustomers(wsId, merged);
            return merged;
          });
        }
        if (Array.isArray(snap.inventory) && snap.inventory.length > 0) {
          seededInitialInventoryRef.current = true;
          const legacySet = new Set(LEGACY_V1_INVENTORY_IDS);
          const serverHasLegacy = snap.inventory.some((it) =>
            legacySet.has(it.id)
          );
          setInventoryItems((prev) => {
            const merged = mergeInventoryItems(wsId, prev, snap.inventory!);
            saveLocalInventory(wsId, merged);
            if (serverHasLegacy) {
              void syncFullInventoryToCloud(accountSession, merged);
            }
            return merged;
          });
        } else if (!seededInitialInventoryRef.current) {
          seededInitialInventoryRef.current = true;
          const initialInv = loadLocalInventory(wsId);
          if (initialInv.length > 0) {
            void syncFullInventoryToCloud(accountSession, initialInv);
          }
        }
        if (Array.isArray(snap.revenueEntries)) {
          setRevenueEntries((prev) => {
            const merged = mergeRevenueEntries(
              wsId,
              prev,
              snap.revenueEntries!
            );
            saveLocalRevenueEntries(wsId, merged);
            return merged;
          });
        }

        // 3. Reconcile Saved Invoices
        const serverInvoices = Array.isArray(snap.invoices) ? snap.invoices : [];
        const nextCloudIds = new Set(serverInvoices.map((inv) => inv.id));
        const removedDocIds = new Set<string>();
        for (const prevId of previousServerCloudIdsRef.current) {
          if (!nextCloudIds.has(prevId)) {
            removedDocIds.add(prevId);
          }
        }
        previousServerCloudIdsRef.current = nextCloudIds;

        reconcileCloudInvoices(
          accountSession,
          serverInvoices,
          nextCloudIds,
          removedDocIds,
          false
        );
      } catch (err) {
        setIsLoadingCloud(false);
        if (err instanceof CloudRelayError) {
          if (
            err.code === 'QUOTA_DAILY_READS' ||
            err.code === 'QUOTA_EXCEEDED'
          ) {
            setCloudError(
              'Đã chạm giới hạn đọc/ghi miễn phí trong ngày của Firestore. Hạn mức sẽ tự làm mới vào ngày mai.'
            );
          } else {
            setServerConnected(false);
          }
        } else {
          setServerConnected(false);
        }
      } finally {
        pullingSnapshotRef.current = false;
      }
    },
    [accountSession, localHydrated, reconcileCloudInvoices]
  );

  const flushPendingCloudOperations = useCallback(
    (forceSnapshotPull = false) => {
      if (!accountSession) return;
      const wsId = accountSession.workspaceId;

      const pendingDeletes = loadPendingCloudDeleteIds(wsId);
      for (const delId of pendingDeletes) {
        if (!flushingDeleteIdsRef.current.has(delId)) {
          flushingDeleteIdsRef.current.add(delId);
          void deleteCloudInvoice(accountSession, delId)
            .catch(() => {
              // Keep queued for next retry
            })
            .finally(() => {
              flushingDeleteIdsRef.current.delete(delId);
            });
        }
      }

      const deletedIds = loadExplicitlyDeletedIds(wsId);
      for (const inv of savedInvoicesRef.current) {
        if (deletedIds.has(inv.id) || inv.items.length === 0) continue;
        if (
          (!inv.syncedToCloud || inv.syncedOwnerUid !== wsId) &&
          !inFlightSaveIdsRef.current.has(inv.id)
        ) {
          uploadSingleInvoiceToCloud(accountSession, inv);
        }
      }

      if (forceSnapshotPull) {
        void pullServerWorkspaceSnapshot(true);
      }
    },
    [accountSession, uploadSingleInvoiceToCloud, pullServerWorkspaceSnapshot]
  );

  // Dual-Engine Real-Time Sync Subscription (Client Firestore onSnapshot + Server Delta Polling)
  useEffect(() => {
    if (!accountSession || !localHydrated) return;

    setIsLoadingCloud(true);
    flushPendingCloudOperations(false);
    void pullServerWorkspaceSnapshot(true);

    const unsub = subscribeToCloudInvoices(
      accountSession,
      (cloudList, cloudIds, removedDocIds, snapshotFromCache) => {
        if (!snapshotFromCache) {
          previousServerCloudIdsRef.current = cloudIds;
        }
        reconcileCloudInvoices(
          accountSession,
          cloudList,
          cloudIds,
          removedDocIds,
          snapshotFromCache
        );
      },
      (msg) => {
        setIsLoadingCloud(false);
        setCloudError(msg);
      }
    );

    const pollInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void pullServerWorkspaceSnapshot(false);
      }
    }, 3500);

    return () => {
      unsub();
      window.clearInterval(pollInterval);
    };
  }, [
    accountSession,
    localHydrated,
    flushPendingCloudOperations,
    pullServerWorkspaceSnapshot,
    reconcileCloudInvoices,
  ]);

  const unsyncedCount = useMemo(() => {
    if (!accountSession) return 0;
    return savedInvoices.filter(
      (inv) =>
        !inv.syncedToCloud || inv.syncedOwnerUid !== accountSession.workspaceId
    ).length;
  }, [savedInvoices, accountSession]);

  // Permanently record revenue from successful orders without ever auto-deleting existing records
  useEffect(() => {
    if (!accountSession || !localHydrated) return;
    const wsId = accountSession.workspaceId;

    setRevenueEntries((prev) => {
      const { nextEntries, changedEntries } =
        reconcileInvoicesIntoRevenueEntries(
          savedInvoices,
          products,
          prev,
          storeSettings.footerNote
        );
      if (changedEntries.length === 0) {
        return prev;
      }
      saveLocalRevenueEntries(wsId, nextEntries);
      for (const changed of changedEntries) {
        void upsertRevenueEntryToCloud(accountSession, changed);
      }
      return nextEntries;
    });
  }, [
    accountSession,
    localHydrated,
    savedInvoices,
    products,
    storeSettings.footerNote,
  ]);

  const reportCount = useMemo(() => {
    const classifiedCount = savedInvoices.filter((inv) =>
      Boolean(inv.reportStage)
    ).length;
    const activeRevCount = revenueEntries.filter((e) => !e.isDeleted).length;
    return Math.max(classifiedCount, activeRevCount);
  }, [savedInvoices, revenueEntries]);

  const inventoryAlerts = useMemo(
    () => getInventoryAlerts(inventoryItems),
    [inventoryItems]
  );

  // Automatic retry on network recovery, tab focus, and 8s heartbeat whenever unsynced invoices exist
  useEffect(() => {
    if (!accountSession || !localHydrated) return;

    const handleOnline = () => {
      flushPendingCloudOperations(true);
    };
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        flushPendingCloudOperations(false);
        void pullServerWorkspaceSnapshot(false);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    let retryTimer: number | undefined;
    if (unsyncedCount > 0 || !serverConnected) {
      retryTimer = window.setInterval(() => {
        flushPendingCloudOperations(false);
        void pullServerWorkspaceSnapshot(false);
      }, 8_000);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      if (retryTimer !== undefined) {
        window.clearInterval(retryTimer);
      }
    };
  }, [
    accountSession,
    localHydrated,
    unsyncedCount,
    serverConnected,
    flushPendingCloudOperations,
    pullServerWorkspaceSnapshot,
  ]);

  const handleImportLegacyQuotes = async () => {
    if (
      !accountSession ||
      unimportedLegacyQuotes.length === 0 ||
      isImportingLegacy
    ) {
      return;
    }
    setIsImportingLegacy(true);
    const wsId = accountSession.workspaceId;

    try {
      const byId = new Map<string, SavedInvoice>();
      for (const inv of savedInvoicesRef.current) {
        byId.set(inv.id, inv);
      }
      for (const leg of unimportedLegacyQuotes) {
        clearDeletedTombstone(wsId, leg.id);
        byId.set(leg.id, {
          ...leg,
          syncedToCloud: false,
          syncedOwnerUid: undefined,
        });
      }

      const merged = Array.from(byId.values()).sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setSavedInvoices(merged);
      await saveLocalSavedInvoicesAsync(wsId, merged);

      for (const leg of unimportedLegacyQuotes) {
        uploadSingleInvoiceToCloud(accountSession, leg);
      }

      markLegacyImportHandled(wsId);
      setLegacyQuotes([]);
    } finally {
      setIsImportingLegacy(false);
    }
  };

  const handleDismissLegacyQuotes = () => {
    if (!accountSession) return;
    markLegacyImportHandled(accountSession.workspaceId);
    setLegacyQuotes([]);
  };

  const editingInvoice = useMemo(
    () => savedInvoices.find((inv) => inv.id === editingInvoiceId) || null,
    [savedInvoices, editingInvoiceId]
  );

  const viewingInvoice = useMemo(
    () => savedInvoices.find((inv) => inv.id === viewingInvoiceId) || null,
    [savedInvoices, viewingInvoiceId]
  );

  const totals = useMemo(
    () =>
      calculateQuoteTotals(
        quoteItems,
        discountAmount,
        shippingFee,
        depositAmount
      ),
    [quoteItems, discountAmount, shippingFee, depositAmount]
  );

  const activeLogoDataUrl = workspaceLogo?.dataUrl ?? null;
  const activeSignatureDataUrl = workspaceSignature?.dataUrl ?? null;

  const exportPayload: InvoiceExportPayload = useMemo(
    () => ({
      createdAt,
      expectedDemoDate,
      store: storeSettings,
      customer,
      items: quoteItems,
      designIllustration,
      invoiceNote,
      totals,
      logoDataUrl: activeLogoDataUrl,
      signatureDataUrl: activeSignatureDataUrl,
    }),
    [
      createdAt,
      expectedDemoDate,
      storeSettings,
      customer,
      quoteItems,
      designIllustration,
      invoiceNote,
      totals,
      activeLogoDataUrl,
      activeSignatureDataUrl,
    ]
  );

  const persistInvoiceRecord = async (forceCreateNew: boolean) => {
    if (!accountSession || quoteItems.length === 0 || isSaving) return;
    const wsId = accountSession.workspaceId;

    setIsSaving(true);
    setCloudError(null);

    const now = new Date();
    const nowISO = now.toISOString();
    const isUpdatingExisting = Boolean(editingInvoice && !forceCreateNew);

    const targetId =
      isUpdatingExisting && editingInvoice
        ? sanitizeSafeId(editingInvoice.id, 'inv')
        : sanitizeSafeId(
            `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            'inv'
          );

    const targetCode =
      isUpdatingExisting && editingInvoice
        ? editingInvoice.code
        : generateInvoiceCode(savedInvoices);

    const resolvedCustomerCode =
      forceCreateNew || !customer.code.trim()
        ? generateCustomerCode(now)
        : customer.code.trim();

    setCustomer((prev) => ({
      ...prev,
      code: resolvedCustomerCode,
    }));

    const usedItemIds = new Set<string>();
    const clonedItems: QuoteItem[] = quoteItems.map((item, idx) => {
      let itemId = sanitizeSafeId(item.id || `item-${idx}`, `item-${idx}`);
      if (usedItemIds.has(itemId)) {
        itemId = sanitizeSafeId(`${itemId}-${idx}`, `item-${idx}`);
      }
      usedItemIds.add(itemId);
      return {
        id: itemId,
        productId: item.productId,
        name: item.name,
        unit: item.unit,
        quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
        unitPrice: Math.max(0, Math.round(Number(item.unitPrice) || 0)),
        note: item.note || '',
      };
    });

    const safeDiscount = Math.max(0, Math.round(Number(discountAmount) || 0));
    const safeShipping = Math.max(0, Math.round(Number(shippingFee) || 0));
    const safeDeposit = Math.max(0, Math.round(Number(depositAmount) || 0));

    const computedTotals = calculateQuoteTotals(
      clonedItems,
      safeDiscount,
      safeShipping,
      safeDeposit
    );

    const prevUpdatedMs =
      isUpdatingExisting && editingInvoice
        ? new Date(editingInvoice.updatedAt).getTime()
        : 0;
    const effectiveUpdatedISO = new Date(
      Math.max(
        now.getTime(),
        (Number.isFinite(prevUpdatedMs) ? prevUpdatedMs : 0) + 1000
      )
    ).toISOString();

    const rawStage = sanitizeReportStage(draftInvoiceStage);
    const effectiveRemainingPaid =
      rawStage === 'hoan_thanh' ? true : Boolean(draftRemainingPaid);
    const effectiveStage: ReportStage | '' =
      effectiveRemainingPaid && rawStage !== 'hoan_thanh'
        ? 'hoan_thanh'
        : rawStage;
    const effectiveRemainingPaidAt = effectiveRemainingPaid
      ? sanitizeOptionalOrderDate(draftRemainingPaidAt) || getLocalISODate(0)
      : '';

    setDraftInvoiceStage(effectiveStage);
    setDraftRemainingPaid(effectiveRemainingPaid);
    setDraftRemainingPaidAt(effectiveRemainingPaidAt);

    const localRecord: SavedInvoice = {
      id: targetId,
      code: targetCode,
      createdAt:
        isUpdatingExisting && editingInvoice ? editingInvoice.createdAt : nowISO,
      updatedAt: effectiveUpdatedISO,
      expectedDemoDate,
      customer: {
        name: customer.name.trim(),
        code: resolvedCustomerCode,
        phone: customer.phone.trim(),
      },
      items: clonedItems,
      discountAmount: safeDiscount,
      shippingFee: safeShipping,
      depositAmount: safeDeposit,
      designIllustration: designIllustration.slice(0, 200),
      invoiceNote: invoiceNote.slice(0, 3000),
      reportStage: effectiveStage,
      remainingPaid: effectiveRemainingPaid,
      remainingPaidAt: effectiveRemainingPaidAt,
      totals: computedTotals,
      syncedToCloud: false,
      syncedOwnerUid: undefined,
    };

    clearDeletedTombstone(wsId, localRecord.id);
    inFlightSaveIdsRef.current.add(localRecord.id);
    recentlySavedAtRef.current.set(localRecord.id, Date.now());

    // 1. Immediately persist to account-scoped localStorage + IndexedDB
    const nextLocalList = [
      localRecord,
      ...savedInvoicesRef.current.filter((inv) => inv.id !== localRecord.id),
    ];
    setSavedInvoices(nextLocalList);
    await saveLocalSavedInvoicesAsync(wsId, nextLocalList);

    setEditingInvoiceId(localRecord.id);
    if (!isUpdatingExisting) {
      setCreatedAt(localRecord.createdAt);
    }
    triggerSaveSuccessBanner();
    triggerSaleCheer('save');

    // 1B. Automatically register/update customer in Date KH when name & phone are present
    const savedCustName = localRecord.customer.name.trim();
    const savedCustPhone = localRecord.customer.phone.trim();
    if (savedCustName && savedCustPhone) {
      const phoneDigits = normalizePhoneDigits(savedCustPhone);
      const matchedExisting = workspaceCustomersRef.current.find((c) =>
        phoneDigits.length >= 6
          ? normalizePhoneDigits(c.phone) === phoneDigits
          : c.name.toLowerCase() === savedCustName.toLowerCase() &&
            c.phone === savedCustPhone
      );
      if (
        !matchedExisting ||
        matchedExisting.name !== savedCustName ||
        matchedExisting.phone !== savedCustPhone
      ) {
        const autoContact = normalizeCustomerContact({
          id: matchedExisting?.id || buildPhoneCustomerId(savedCustPhone),
          name: savedCustName,
          phone: savedCustPhone,
          customerDate:
            matchedExisting?.customerDate || localRecord.createdAt.slice(0, 10),
          note: matchedExisting?.note || '',
          createdAt: matchedExisting?.createdAt || nowISO,
          updatedAt: nowISO,
        });
        if (autoContact) {
          clearCustomerDeletedTombstone(wsId, autoContact.id);
          setWorkspaceCustomers((prev) => {
            const nextList = [
              autoContact,
              ...prev.filter((item) => item.id !== autoContact.id),
            ];
            saveLocalCustomers(wsId, nextList);
            return nextList;
          });
          void upsertCustomerToCloud(accountSession, autoContact);
        }
      }
    }

    // 2. Commit to shared account cloud workspace via server relay / Firestore
    try {
      await upsertCloudInvoice(accountSession, localRecord);
      recentlySavedAtRef.current.set(localRecord.id, Date.now());
      previousServerCloudIdsRef.current.add(localRecord.id);
      setServerConnected(true);
      setSavedInvoices((prev) => {
        const next = prev.map((inv) =>
          inv.id === localRecord.id
            ? {
                ...inv,
                syncedToCloud: true,
                syncedOwnerUid: wsId,
              }
            : inv
        );
        saveLocalSavedInvoices(wsId, next);
        return next;
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('Quota exceeded')) {
        setCloudError(
          'Hạn mức đám mây miễn phí hôm nay đã đầy. Hóa đơn đã được lưu 100% trên thiết bị và sẽ tự đồng bộ sau.'
        );
      } else {
        setServerConnected(false);
        setCloudError(
          'Mạng chập chờn — hóa đơn đã được lưu 100% trên thiết bị và sẽ tự động đồng bộ lên máy chủ ngay khi có mạng.'
        );
      }
    } finally {
      inFlightSaveIdsRef.current.delete(localRecord.id);
      setIsSaving(false);
    }
  };

  const exportPayloadRef = useRef<InvoiceExportPayload>(exportPayload);
  exportPayloadRef.current = exportPayload;
  const quoteItemCountRef = useRef<number>(quoteItems.length);
  quoteItemCountRef.current = quoteItems.length;
  const isExportingRef = useRef<boolean>(isExporting);
  isExportingRef.current = isExporting;

  const handleLoadSavedInvoice = useCallback(
    (invoice: SavedInvoice, destinationTab: AppTab) => {
      setEditingInvoiceId(invoice.id);
      setCreatedAt(invoice.createdAt);
      setExpectedDemoDate(invoice.expectedDemoDate);
      setCustomer({
        name: invoice.customer.name || '',
        code: invoice.customer.code || '',
        phone: invoice.customer.phone || '',
      });
      setQuoteItems(invoice.items.map((item) => ({ ...item })));
      setDiscountAmount(invoice.discountAmount);
      setShippingFee(invoice.shippingFee || 0);
      setDepositAmount(invoice.depositAmount);
      setDesignIllustration(invoice.designIllustration ?? '');
      setInvoiceNote(invoice.invoiceNote);
      const loadedSettled = Boolean(
        invoice.remainingPaid ||
          (invoice.reportStage === 'hoan_thanh' &&
            invoice.remainingPaid !== false)
      );
      setDraftInvoiceStage(sanitizeReportStage(invoice.reportStage));
      setDraftRemainingPaid(loadedSettled);
      setDraftRemainingPaidAt(
        loadedSettled
          ? sanitizeOptionalOrderDate(invoice.remainingPaidAt) ||
              getLocalISODate(0)
          : ''
      );
      handleSelectTab(destinationTab);

      if (destinationTab === AppTab.WORKSPACE) {
        window.setTimeout(() => {
          document
            .getElementById('workspace-invoice-editor')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [handleSelectTab]
  );

  const handleDeleteSavedInvoice = useCallback(async (id: string) => {
    const sess = accountSessionRef.current;
    if (!sess) return;
    previousServerCloudIdsRef.current.delete(id);
    setSavedInvoices((prev) => prev.filter((inv) => inv.id !== id));
    if (editingInvoiceIdRef.current === id) {
      setDraftInvoiceStage('');
      setDraftRemainingPaid(false);
      setDraftRemainingPaidAt('');
    }
    setEditingInvoiceId((prev) => (prev === id ? null : prev));
    setViewingInvoiceId((prev) => (prev === id ? null : prev));

    await explicitlyDeleteLocalInvoice(sess.workspaceId, id);

    try {
      await deleteCloudInvoice(sess, id);
      setServerConnected(true);
    } catch {
      setServerConnected(false);
    }
  }, []);

  const handleSaveInvoiceStage = useCallback(
    (
      invoice: SavedInvoice,
      nextStage: ReportStage | '',
      paymentPatch?: { remainingPaid?: boolean; remainingPaidAt?: string }
    ) => {
      const sess = accountSessionRef.current;
      if (!sess) return;
      const wsId = sess.workspaceId;
      let safeStage = sanitizeReportStage(nextStage);
      let nextRemainingPaid = Boolean(invoice.remainingPaid);
      let nextRemainingPaidAt = sanitizeOptionalOrderDate(
        invoice.remainingPaidAt
      );

      if (paymentPatch && typeof paymentPatch.remainingPaid === 'boolean') {
        nextRemainingPaid = paymentPatch.remainingPaid;
        if (nextRemainingPaid) {
          nextRemainingPaidAt =
            sanitizeOptionalOrderDate(paymentPatch.remainingPaidAt) ||
            nextRemainingPaidAt ||
            getLocalISODate(0);
          safeStage = 'hoan_thanh';
        } else {
          nextRemainingPaidAt = '';
          if (safeStage === 'hoan_thanh') {
            safeStage = invoice.totals.depositAmount > 0 ? 'coc' : 'bao_gia';
          }
        }
      } else if (safeStage === 'hoan_thanh') {
        nextRemainingPaid = true;
        nextRemainingPaidAt =
          sanitizeOptionalOrderDate(paymentPatch?.remainingPaidAt) ||
          nextRemainingPaidAt ||
          getLocalISODate(0);
      } else {
        nextRemainingPaid = false;
        nextRemainingPaidAt = '';
      }

      if (editingInvoiceIdRef.current === invoice.id) {
        setDraftInvoiceStage(safeStage);
        setDraftRemainingPaid(nextRemainingPaid);
        setDraftRemainingPaidAt(nextRemainingPaidAt);
      }
      const nowMs = Date.now();
      const prevUpdatedMs = new Date(invoice.updatedAt).getTime();
      const effectiveUpdatedISO = new Date(
        Math.max(
          nowMs,
          (Number.isFinite(prevUpdatedMs) ? prevUpdatedMs : 0) + 1000
        )
      ).toISOString();

      const updatedRecord: SavedInvoice = {
        ...invoice,
        reportStage: safeStage,
        remainingPaid: nextRemainingPaid,
        remainingPaidAt: nextRemainingPaidAt,
        updatedAt: effectiveUpdatedISO,
        syncedToCloud: false,
        syncedOwnerUid: undefined,
      };

      inFlightSaveIdsRef.current.add(updatedRecord.id);
      recentlySavedAtRef.current.set(updatedRecord.id, nowMs);

      setSavedInvoices((prev) => {
        const next = [
          updatedRecord,
          ...prev.filter((item) => item.id !== updatedRecord.id),
        ].sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        saveLocalSavedInvoices(wsId, next);
        return next;
      });

      void updateCloudInvoiceStage(sess, updatedRecord)
        .then(() => {
          recentlySavedAtRef.current.set(updatedRecord.id, Date.now());
          previousServerCloudIdsRef.current.add(updatedRecord.id);
          setServerConnected(true);
          setCloudError(null);
          setSavedInvoices((prev) => {
            const next = prev.map((item) =>
              item.id === updatedRecord.id &&
              item.updatedAt === updatedRecord.updatedAt
                ? {
                    ...item,
                    syncedToCloud: true,
                    syncedOwnerUid: wsId,
                  }
                : item
            );
            saveLocalSavedInvoices(wsId, next);
            return next;
          });
        })
        .catch((err) => {
          if (err instanceof Error && err.message.includes('Quota exceeded')) {
            setCloudError(
              'Hạn mức đám mây miễn phí hôm nay đã đầy. Phân loại báo cáo đã lưu trên thiết bị và sẽ tự đồng bộ sau.'
            );
          } else {
            setServerConnected(false);
          }
        })
        .finally(() => {
          inFlightSaveIdsRef.current.delete(updatedRecord.id);
        });
    },
    []
  );

  const buildPayloadFromSaved = useCallback(
    (inv: SavedInvoice): InvoiceExportPayload => ({
      createdAt: inv.createdAt,
      expectedDemoDate: inv.expectedDemoDate,
      store: storeSettingsRef.current,
      customer: inv.customer,
      items: inv.items,
      designIllustration: inv.designIllustration ?? '',
      invoiceNote: inv.invoiceNote,
      totals: inv.totals,
      logoDataUrl: activeLogoDataUrl,
      signatureDataUrl: activeSignatureDataUrl,
    }),
    [activeLogoDataUrl, activeSignatureDataUrl]
  );

  const handleCopySavedInvoiceImage = useCallback(
    async (inv: SavedInvoice) => {
      const result = await copyInvoiceImageToClipboard(
        buildPayloadFromSaved(inv)
      );
      if (result.status === 'fallback') {
        setFallbackImageMeta({
          downloadName: 'Bao-Gia-ATD-Color.png',
          altText: 'Hóa đơn tham khảo ATD Color',
        });
        setFallbackImageUrl(result.dataUrl);
      }
      triggerSaleCheer('copy');
    },
    [buildPayloadFromSaved, triggerSaleCheer]
  );

  const handleDownloadSavedInvoicePDF = useCallback(
    async (inv: SavedInvoice) => {
      await exportInvoicePDF(buildPayloadFromSaved(inv));
    },
    [buildPayloadFromSaved]
  );

  const handleAppendProduct = useCallback(
    (product: Product, itemId: string) => {
      setQuoteItems((prev) => [
        ...prev,
        {
          id: itemId,
          productId: product.id,
          name: product.name,
          unit: product.unit,
          quantity: 1,
          unitPrice: Math.max(0, Math.round(Number(product.price) || 0)),
          note: '',
        },
      ]);
    },
    []
  );

  const handleUpdatePickedItemQuantity = useCallback(
    (itemId: string, quantity: number) => {
      const safeQty = Math.round(Number(quantity) || 0);
      if (safeQty <= 0) {
        setQuoteItems((prev) => prev.filter((item) => item.id !== itemId));
        return;
      }
      setQuoteItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, quantity: safeQty } : item
        )
      );
    },
    []
  );

  const handleAddCustomItem = useCallback(
    (name: string, unit: string, quantity: number, unitPrice: number) => {
      setQuoteItems((prev) => [
        ...prev,
        {
          id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name,
          unit,
          quantity: Math.max(1, Math.round(Number(quantity) || 1)),
          unitPrice: Math.max(0, Math.round(Number(unitPrice) || 0)),
          note: '',
        },
      ]);
    },
    []
  );

  const handleUpdateQuoteItem = useCallback(
    (id: string, patch: Partial<QuoteItem>) => {
      const normalizedPatch: Partial<QuoteItem> = { ...patch };
      if (typeof normalizedPatch.quantity === 'number') {
        normalizedPatch.quantity = Math.max(
          1,
          Math.round(normalizedPatch.quantity)
        );
      }
      if (typeof normalizedPatch.unitPrice === 'number') {
        normalizedPatch.unitPrice = Math.max(
          0,
          Math.round(normalizedPatch.unitPrice)
        );
      }
      setQuoteItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, ...normalizedPatch } : item
        )
      );
    },
    []
  );

  const handleRemoveQuoteItem = useCallback((id: string) => {
    setQuoteItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleDuplicateQuoteItem = useCallback((id: string) => {
    setQuoteItems((prev) => {
      const idx = prev.findIndex((item) => item.id === id);
      if (idx < 0) return prev;
      const source = prev[idx];
      const cloned: QuoteItem = {
        ...source,
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      };
      const next = [...prev];
      next.splice(idx + 1, 0, cloned);
      return next;
    });
  }, []);

  const handleMoveQuoteItem = useCallback(
    (fromIndex: number, toIndex: number) => {
      setQuoteItems((prev) => {
        if (
          fromIndex === toIndex ||
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= prev.length ||
          toIndex >= prev.length
        ) {
          return prev;
        }
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
    []
  );

  const handleResetQuote = useCallback(() => {
    setEditingInvoiceId(null);
    setQuoteItems([]);
    setDiscountAmount(0);
    setShippingFee(0);
    setDepositAmount(0);
    setCustomer(INITIAL_CUSTOMER);
    setCreatedAt(new Date().toISOString());
    setExpectedDemoDate(getLocalISODate(1));
    setDesignIllustration(DEFAULT_DESIGN_ILLUSTRATION);
    setInvoiceNote(storeSettingsRef.current.footerNote);
    setDraftInvoiceStage('');
    setDraftRemainingPaid(false);
    setDraftRemainingPaidAt('');
  }, []);

  const handleSaveVoucherBudget = useCallback((budget: VoucherBudget) => {
    const sess = accountSessionRef.current;
    if (!sess) return;
    const norm = normalizeVoucherBudget(budget);
    if (!norm) return;
    setVoucherBudgets((prev) => {
      const next = [
        norm,
        ...prev.filter((item) => item.monthKey !== norm.monthKey),
      ].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
      saveLocalVoucherBudgets(sess.workspaceId, next);
      return next;
    });
    void upsertVoucherBudgetToCloud(sess, norm);
  }, []);

  const handleUpsertCustomer = useCallback((contact: CustomerContact) => {
    const sess = accountSessionRef.current;
    if (!sess) return;
    const norm = normalizeCustomerContact(contact);
    if (!norm) return;
    clearCustomerDeletedTombstone(sess.workspaceId, norm.id);
    setWorkspaceCustomers((prev) => {
      const next = [norm, ...prev.filter((item) => item.id !== norm.id)].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      saveLocalCustomers(sess.workspaceId, next);
      return next;
    });
    void upsertCustomerToCloud(sess, norm);
  }, []);

  const handleDeleteCustomer = useCallback((customerId: string) => {
    const sess = accountSessionRef.current;
    if (!sess) return;
    markCustomerDeletedLocally(sess.workspaceId, customerId);
    setWorkspaceCustomers((prev) => {
      const next = prev.filter((item) => item.id !== customerId);
      saveLocalCustomers(sess.workspaceId, next);
      return next;
    });
    void deleteCustomerFromCloud(sess, customerId);
  }, []);

  const handleCreateInvoiceForCustomer = useCallback(
    (name: string, phone: string) => {
      handleResetQuote();
      setCustomer({
        name: name.trim(),
        code: generateCustomerCode(new Date()),
        phone: phone.trim(),
      });
      handleSelectTab(AppTab.WORKSPACE);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [handleResetQuote, handleSelectTab]
  );

  const handleDeductInventoryUsage = useCallback(
    (itemId: string, usedQty: number) => {
      const sess = accountSessionRef.current;
      if (!sess || usedQty <= 0) return;
      const nowISO = new Date().toISOString();

      setInventoryItems((prev) => {
        let updatedTarget: InventoryItem | null = null;
        const next = prev.map((item) => {
          if (item.id !== itemId) return item;
          const nextQty = Math.max(0, item.quantity - Math.round(usedQty));
          const updated: InventoryItem = {
            ...item,
            quantity: nextQty,
            updatedAt: nowISO,
          };
          updatedTarget = updated;
          return updated;
        });
        saveLocalInventory(sess.workspaceId, next);
        if (updatedTarget) {
          void upsertInventoryItemToCloud(sess, updatedTarget);
        }
        return next;
      });
    },
    []
  );

  const handleAddInventoryStock = useCallback(
    (itemId: string, addQty: number) => {
      const sess = accountSessionRef.current;
      if (!sess || addQty <= 0) return;
      const nowISO = new Date().toISOString();

      setInventoryItems((prev) => {
        let updatedTarget: InventoryItem | null = null;
        const next = prev.map((item) => {
          if (item.id !== itemId) return item;
          const nextQty = Math.min(1_000_000, item.quantity + Math.round(addQty));
          const updated: InventoryItem = {
            ...item,
            quantity: nextQty,
            updatedAt: nowISO,
          };
          updatedTarget = updated;
          return updated;
        });
        saveLocalInventory(sess.workspaceId, next);
        if (updatedTarget) {
          void upsertInventoryItemToCloud(sess, updatedTarget);
        }
        return next;
      });
    },
    []
  );

  const handleSaveInventoryItem = useCallback((updatedItem: InventoryItem) => {
    const sess = accountSessionRef.current;
    if (!sess) return;
    const norm = normalizeInventoryItem(updatedItem, updatedItem.sortIndex);
    if (!norm) return;
    clearInventoryDeletedTombstone(sess.workspaceId, norm.id);

    setInventoryItems((prev) => {
      const exists = prev.some((i) => i.id === norm.id);
      const next = exists
        ? prev.map((i) => (i.id === norm.id ? norm : i))
        : [...prev, norm];
      saveLocalInventory(sess.workspaceId, next);
      return next;
    });
    void upsertInventoryItemToCloud(sess, norm);
  }, []);

  const handleAddNewInventoryItem = useCallback(
    (draft: {
      name: string;
      unit: string;
      quantity: number;
      minThreshold: number;
      packSize: number;
      packLabel: string;
    }) => {
      const sess = accountSessionRef.current;
      if (!sess) return;
      const nowISO = new Date().toISOString();
      const newId = sanitizeSafeId(
        `inv-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        'inv'
      );

      setInventoryItems((prev) => {
        const norm = normalizeInventoryItem(
          {
            id: newId,
            name: draft.name,
            unit: draft.unit,
            quantity: draft.quantity,
            minThreshold: draft.minThreshold,
            packSize: draft.packSize,
            packLabel: draft.packLabel,
            sortIndex: prev.length,
            createdAt: nowISO,
            updatedAt: nowISO,
          },
          prev.length
        );
        if (!norm) return prev;
        clearInventoryDeletedTombstone(sess.workspaceId, norm.id);
        const next = [...prev, norm];
        saveLocalInventory(sess.workspaceId, next);
        void upsertInventoryItemToCloud(sess, norm);
        return next;
      });
    },
    []
  );

  const handleDeleteInventoryItem = useCallback((itemId: string) => {
    const sess = accountSessionRef.current;
    if (!sess) return;
    markInventoryItemDeletedLocally(sess.workspaceId, itemId);
    setInventoryItems((prev) => {
      const next = prev.filter((item) => item.id !== itemId);
      saveLocalInventory(sess.workspaceId, next);
      return next;
    });
    void deleteInventoryItemFromCloud(sess, itemId);
  }, []);

  const handleResetDefaultInventory = useCallback(() => {
    const sess = accountSessionRef.current;
    if (!sess) return;
    clearAllInventoryDeletedTombstones(sess.workspaceId);
    markInventoryCatalogV2Ready(sess.workspaceId);
    const nowISO = new Date().toISOString();
    const freshDefaults = INITIAL_INVENTORY_ITEMS.map((item, idx) => ({
      ...item,
      sortIndex: idx,
      updatedAt: nowISO,
    }));
    setInventoryItems(freshDefaults);
    saveLocalInventory(sess.workspaceId, freshDefaults);
    void syncFullInventoryToCloud(sess, freshDefaults);
  }, []);

  const handleAddManualRevenueEntry = useCallback(
    (draft: {
      orderDate: string;
      customerName: string;
      customerPhone: string;
      invoiceCode: string;
      designAmount: number;
      printAmount: number;
      note: string;
    }) => {
      const sess = accountSessionRef.current;
      if (!sess) return;
      const nowISO = new Date().toISOString();
      const newId = sanitizeSafeId(
        `rev-man-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        'rev'
      );
      const norm = normalizeRevenueEntry({
        id: newId,
        invoiceId: '',
        invoiceCode: draft.invoiceCode,
        orderDate: draft.orderDate,
        monthKey: draft.orderDate.slice(0, 7),
        customerName: draft.customerName,
        customerPhone: draft.customerPhone,
        customerCode: '',
        designAmount: draft.designAmount,
        printAmount: draft.printAmount,
        totalRevenue: draft.designAmount + draft.printAmount,
        isManualOverride: true,
        isDeleted: false,
        note: draft.note,
        createdAt: nowISO,
        updatedAt: nowISO,
      });
      if (!norm) return;
      clearManualRevenueDeletedTombstone(sess.workspaceId, norm.id);

      setRevenueEntries((prev) => {
        const next = mergeRevenueEntries(sess.workspaceId, [norm, ...prev], []);
        saveLocalRevenueEntries(sess.workspaceId, next);
        return next;
      });
      void upsertRevenueEntryToCloud(sess, norm);
    },
    []
  );

  const handleUpdateRevenueEntry = useCallback((updated: RevenueEntry) => {
    const sess = accountSessionRef.current;
    if (!sess) return;
    const norm = normalizeRevenueEntry({
      ...updated,
      isManualOverride: true,
      updatedAt: new Date().toISOString(),
    });
    if (!norm) return;

    setRevenueEntries((prev) => {
      const filtered = prev.filter((e) => e.id !== norm.id);
      const next = mergeRevenueEntries(
        sess.workspaceId,
        [norm, ...filtered],
        []
      );
      saveLocalRevenueEntries(sess.workspaceId, next);
      return next;
    });
    void upsertRevenueEntryToCloud(sess, norm);
  }, []);

  const handleDeleteRevenueEntry = useCallback((entry: RevenueEntry) => {
    const sess = accountSessionRef.current;
    if (!sess) return;

    if (entry.invoiceId) {
      const tombstoned = normalizeRevenueEntry({
        ...entry,
        isDeleted: true,
        updatedAt: new Date().toISOString(),
      });
      if (!tombstoned) return;
      setRevenueEntries((prev) => {
        const next = prev.map((e) => (e.id === tombstoned.id ? tombstoned : e));
        saveLocalRevenueEntries(sess.workspaceId, next);
        return next;
      });
      void upsertRevenueEntryToCloud(sess, tombstoned);
    } else {
      markManualRevenueDeletedLocally(sess.workspaceId, entry.id);
      setRevenueEntries((prev) => {
        const next = prev.filter((e) => e.id !== entry.id);
        saveLocalRevenueEntries(sess.workspaceId, next);
        return next;
      });
      void deleteRevenueEntryFromCloud(sess, entry.id);
    }
  }, []);

  const handleRestoreRevenueEntry = useCallback((entry: RevenueEntry) => {
    const sess = accountSessionRef.current;
    if (!sess) return;
    const restored = normalizeRevenueEntry({
      ...entry,
      isDeleted: false,
      updatedAt: new Date().toISOString(),
    });
    if (!restored) return;

    setRevenueEntries((prev) => {
      const next = prev.map((e) => (e.id === restored.id ? restored : e));
      saveLocalRevenueEntries(sess.workspaceId, next);
      return next;
    });
    void upsertRevenueEntryToCloud(sess, restored);
  }, []);

  const handleCopyInvoiceImage = useCallback(async () => {
    if (quoteItemCountRef.current === 0 || isExportingRef.current) return;
    setIsExporting(true);
    try {
      const result = await copyInvoiceImageToClipboard(exportPayloadRef.current);
      if (result.status === 'copied') {
        triggerCopySuccessBanner();
      } else {
        setFallbackImageMeta({
          downloadName: 'Bao-Gia-ATD-Color.png',
          altText: 'Hóa đơn tham khảo ATD Color',
        });
        setFallbackImageUrl(result.dataUrl);
      }
      triggerSaleCheer('copy');
    } finally {
      setIsExporting(false);
    }
  }, [triggerCopySuccessBanner, triggerSaleCheer]);

  const handleOpenSettingsFromPriceSheet = useCallback(() => {
    handleSelectTab(AppTab.SETTINGS);
  }, [handleSelectTab]);

  const handlePriceSheetFallbackImage = useCallback(
    (dataUrl: string, downloadName: string, altText: string) => {
      setFallbackImageMeta({ downloadName, altText });
      setFallbackImageUrl(dataUrl);
    },
    []
  );

  const handlePriceSheetCopiedCheer = useCallback(() => {
    triggerSaleCheer('price_sheet');
  }, [triggerSaleCheer]);

  const handleDownloadPNG = useCallback(async () => {
    if (quoteItemCountRef.current === 0 || isExportingRef.current) return;
    setIsExporting(true);
    try {
      await exportInvoicePNG(exportPayloadRef.current);
    } finally {
      setIsExporting(false);
    }
  }, []);

  const handleDownloadPDF = useCallback(async () => {
    if (quoteItemCountRef.current === 0 || isExportingRef.current) return;
    setIsExporting(true);
    try {
      await exportInvoicePDF(exportPayloadRef.current);
    } finally {
      setIsExporting(false);
    }
  }, []);

  const persistWorkspaceProducts = useCallback(
    (updater: (prev: Product[]) => Product[], immediate = false) => {
      setProducts((prev) => {
        const next = updater(prev);
        const sess = accountSessionRef.current;
        if (sess) {
          pendingCatalogSyncRef.current = { session: sess, products: next };
          if (catalogSyncTimerRef.current !== null) {
            window.clearTimeout(catalogSyncTimerRef.current);
            catalogSyncTimerRef.current = null;
          }
          if (immediate) {
            pendingCatalogSyncRef.current = null;
            saveLocalWorkspaceProducts(sess.workspaceId, next);
            void syncFullWorkspaceCatalogToCloud(sess, next);
          } else {
            catalogSyncTimerRef.current = window.setTimeout(() => {
              catalogSyncTimerRef.current = null;
              const pending = pendingCatalogSyncRef.current;
              if (pending) {
                pendingCatalogSyncRef.current = null;
                saveLocalWorkspaceProducts(
                  pending.session.workspaceId,
                  pending.products
                );
                void syncFullWorkspaceCatalogToCloud(
                  pending.session,
                  pending.products
                );
              }
            }, 420);
          }
        }
        return next;
      });
    },
    []
  );

  const handleAddCatalogProduct = useCallback(
    (newProd: Omit<Product, 'id'>) => {
      persistWorkspaceProducts(
        (prev) => [
          ...prev,
          {
            ...newProd,
            id: `prod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          },
        ],
        true
      );
    },
    [persistWorkspaceProducts]
  );

  const handleUpdateCatalogProduct = useCallback(
    (id: string, patch: Partial<Product>) => {
      persistWorkspaceProducts(
        (prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        false
      );
    },
    [persistWorkspaceProducts]
  );

  const handleDeleteCatalogProduct = useCallback(
    (id: string) => {
      persistWorkspaceProducts(
        (prev) => prev.filter((p) => p.id !== id),
        true
      );
    },
    [persistWorkspaceProducts]
  );

  const handleResetCatalog = useCallback(() => {
    persistWorkspaceProducts(() => INITIAL_PRODUCTS, true);
  }, [persistWorkspaceProducts]);

  const handleUploadWorkspaceLogo = useCallback(async (file: File) => {
    const sess = accountSessionRef.current;
    if (!sess) return;
    setIsUploadingLogo(true);
    try {
      const { version, dataUrl } = await processOriginalLogoFile(file);
      const record: WorkspaceLogoRecord = {
        version,
        dataUrl,
        updatedAt: new Date().toISOString(),
      };
      setWorkspaceLogo(record);
      await saveLocalWorkspaceLogo(sess.workspaceId, version, dataUrl);

      const nextSettings = normalizeStoreSettings({
        ...storeSettingsRef.current,
        logoVersion: version,
      });
      setStoreSettings(nextSettings);
      saveLocalWorkspaceSettings(sess.workspaceId, nextSettings);

      await Promise.allSettled([
        apiPutWorkspaceLogo(sess, version, dataUrl),
        upsertWorkspaceSettingsToCloud(sess, nextSettings),
      ]);
    } finally {
      setIsUploadingLogo(false);
    }
  }, []);

  const handleRemoveWorkspaceLogo = useCallback(async () => {
    const sess = accountSessionRef.current;
    if (!sess) return;
    setIsUploadingLogo(true);
    try {
      setWorkspaceLogo(null);
      await clearLocalWorkspaceLogo(sess.workspaceId);

      const nextSettings = normalizeStoreSettings({
        ...storeSettingsRef.current,
        logoVersion: '',
      });
      setStoreSettings(nextSettings);
      saveLocalWorkspaceSettings(sess.workspaceId, nextSettings);

      await Promise.allSettled([
        apiDeleteWorkspaceLogo(sess.workspaceId),
        upsertWorkspaceSettingsToCloud(sess, nextSettings),
      ]);
    } finally {
      setIsUploadingLogo(false);
    }
  }, []);

  const handleUploadWorkspaceSignature = useCallback(async (file: File) => {
    const sess = accountSessionRef.current;
    if (!sess) return;
    setIsUploadingSignature(true);
    try {
      const { version, dataUrl } = await processSignatureImageFile(file);
      const record: WorkspaceSignatureRecord = {
        version,
        dataUrl,
        updatedAt: new Date().toISOString(),
      };
      setWorkspaceSignature(record);
      await saveLocalWorkspaceSignature(sess.workspaceId, version, dataUrl);

      const nextSettings = normalizeStoreSettings({
        ...storeSettingsRef.current,
        signatureVersion: version,
      });
      setStoreSettings(nextSettings);
      saveLocalWorkspaceSettings(sess.workspaceId, nextSettings);

      await Promise.allSettled([
        apiPutWorkspaceSignature(sess, version, dataUrl),
        upsertWorkspaceSettingsToCloud(sess, nextSettings),
      ]);
    } finally {
      setIsUploadingSignature(false);
    }
  }, []);

  const handleRemoveWorkspaceSignature = useCallback(async () => {
    const sess = accountSessionRef.current;
    if (!sess) return;
    setIsUploadingSignature(true);
    try {
      setWorkspaceSignature(null);
      await clearLocalWorkspaceSignature(sess.workspaceId);

      const nextSettings = normalizeStoreSettings({
        ...storeSettingsRef.current,
        signatureVersion: '',
      });
      setStoreSettings(nextSettings);
      saveLocalWorkspaceSettings(sess.workspaceId, nextSettings);

      await Promise.allSettled([
        apiDeleteWorkspaceSignature(sess.workspaceId),
        upsertWorkspaceSettingsToCloud(sess, nextSettings),
      ]);
    } finally {
      setIsUploadingSignature(false);
    }
  }, []);

  const handleToggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      saveSoundEnabled(next);
      if (next) {
        playTinSound();
      }
      return next;
    });
  }, []);

  const handleManualSync = useCallback(() => {
    flushPendingCatalogSync();
    flushPendingCloudOperations(true);
  }, [flushPendingCatalogSync, flushPendingCloudOperations]);

  const handleToggleCalculator = useCallback(() => {
    setIsCalculatorOpen((prev) => {
      const next = !prev;
      if (next) setIsAiChatOpen(false);
      return next;
    });
  }, []);

  const handleCloseCalculator = useCallback(() => {
    setIsCalculatorOpen(false);
  }, []);

  const handleOpenCalculator = useCallback(() => {
    setIsAiChatOpen(false);
    setIsCalculatorOpen(true);
  }, []);

  const handleToggleAiChat = useCallback(() => {
    setIsAiChatOpen((prev) => {
      const next = !prev;
      if (next) setIsCalculatorOpen(false);
      return next;
    });
  }, []);

  const handleCloseAiChat = useCallback(() => {
    setIsAiChatOpen(false);
  }, []);

  const handleJumpToWorkspaceBill = useCallback(() => {
    handleSelectTab(AppTab.WORKSPACE);
    window.setTimeout(() => {
      document
        .getElementById('workspace-invoice-editor')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }, [handleSelectTab]);

  const handleAiNavigateTarget = useCallback(
    (target: AiNavigateTarget) => {
      switch (target) {
        case 'workspace':
          handleJumpToWorkspaceBill();
          break;
        case 'saved':
          handleSelectTab(AppTab.SAVED);
          break;
        case 'reports_revenue':
          handleSelectTab(AppTab.REPORTS);
          handleSelectReportSubView('monthly_revenue');
          break;
        case 'reports_pipeline':
          handleSelectTab(AppTab.REPORTS);
          handleSelectReportSubView('pipeline');
          break;
        case 'plan_voucher':
          handleSelectTab(AppTab.PLAN);
          handleSelectPlanSubTab('voucher');
          break;
        case 'plan_customers':
          handleSelectTab(AppTab.PLAN);
          handleSelectPlanSubTab('customers');
          break;
        case 'inventory_stock':
          setActiveInventorySubTab('stock');
          handleSelectTab(AppTab.INVENTORY);
          break;
        case 'inventory_reorder':
          setActiveInventorySubTab('reorder');
          handleSelectTab(AppTab.INVENTORY);
          break;
        case 'invoice':
          handleSelectTab(AppTab.INVOICE);
          break;
        case 'catalog':
          handleSelectTab(AppTab.CATALOG);
          break;
        case 'settings':
          handleSelectTab(AppTab.SETTINGS);
          break;
      }
    },
    [
      handleJumpToWorkspaceBill,
      handleSelectPlanSubTab,
      handleSelectReportSubView,
      handleSelectTab,
    ]
  );

  const handleExecuteAiOrderAction = useCallback(
    async (action: AiOrderAction): Promise<AiOrderExecutionSummary | null> => {
      const sess = accountSessionRef.current;
      if (!sess) return null;

      const wsId = sess.workspaceId;
      const active = activeBillStateRef.current;
      const currentSavedList = savedInvoicesRef.current;
      const now = new Date();
      const nowISO = now.toISOString();

      const targetedSaved = action.targetSavedInvoiceId
        ? currentSavedList.find(
            (inv) =>
              inv.id === action.targetSavedInvoiceId ||
              inv.code.toLowerCase() ===
                action.targetSavedInvoiceId.toLowerCase()
          ) || null
        : null;

      const editingExisting =
        !targetedSaved && !action.createNewBill && active.editingInvoiceId
          ? currentSavedList.find((inv) => inv.id === active.editingInvoiceId) ||
            null
          : null;

      const baseInvoice = targetedSaved || editingExisting;
      const isUpdatingExisting = Boolean(baseInvoice && !action.createNewBill);

      const targetId =
        isUpdatingExisting && baseInvoice
          ? sanitizeSafeId(baseInvoice.id, 'inv')
          : sanitizeSafeId(
              `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              'inv'
            );

      const targetCode =
        isUpdatingExisting && baseInvoice
          ? baseInvoice.code
          : generateInvoiceCode(currentSavedList);

      const baseItems: QuoteItem[] = targetedSaved
        ? targetedSaved.items.map((it) => ({ ...it }))
        : action.createNewBill
          ? []
          : active.quoteItems.map((it) => ({ ...it }));

      const baseCustomer: CustomerInfo = targetedSaved
        ? { ...targetedSaved.customer }
        : action.createNewBill
          ? { name: '', code: '', phone: '' }
          : { ...active.customer };

      const mergedItems: QuoteItem[] = [...baseItems];
      const addedLabels: string[] = [];

      for (const draft of action.itemsToAdd) {
        const qtyToAdd = Math.max(1, Math.round(Number(draft.quantity) || 1));
        const normalizedDraftId = draft.productId.trim();
        const normalizedDraftName = draft.name.trim().toLowerCase();

        const matchedProduct =
          (normalizedDraftId
            ? active.products.find((p) => p.id === normalizedDraftId)
            : undefined) ||
          (normalizedDraftName
            ? active.products.find(
                (p) => p.name.trim().toLowerCase() === normalizedDraftName
              )
            : undefined);

        if (matchedProduct) {
          mergedItems.push({
            id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            productId: matchedProduct.id,
            name: matchedProduct.name,
            unit: matchedProduct.unit,
            quantity: qtyToAdd,
            unitPrice:
              draft.unitPrice > 0
                ? Math.round(draft.unitPrice)
                : Math.round(matchedProduct.price),
            note: draft.note.trim(),
          });
          addedLabels.push(`${matchedProduct.name} ×${qtyToAdd}`);
        } else {
          const customName = draft.name.trim() || 'Sản phẩm đặt thêm';
          const customUnit = draft.unit.trim() || 'Mục';
          const customPrice = Math.max(
            0,
            Math.round(Number(draft.unitPrice) || 0)
          );
          mergedItems.push({
            id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: customName,
            unit: customUnit,
            quantity: qtyToAdd,
            unitPrice: customPrice,
            note: draft.note.trim(),
          });
          addedLabels.push(`${customName} ×${qtyToAdd}`);
        }
      }

      const resolvedCustomerName =
        action.customerName.trim() || baseCustomer.name.trim();
      const resolvedCustomerPhone =
        action.customerPhone.trim() || baseCustomer.phone.trim();
      const resolvedCustomerCode =
        action.createNewBill || !baseCustomer.code.trim()
          ? generateCustomerCode(now)
          : baseCustomer.code.trim();

      const nextDiscount =
        action.discountAmount >= 0
          ? Math.round(action.discountAmount)
          : targetedSaved
            ? Math.round(targetedSaved.discountAmount || 0)
            : action.createNewBill
              ? 0
              : Math.round(active.discountAmount || 0);

      const nextShipping =
        action.shippingFee >= 0
          ? Math.round(action.shippingFee)
          : targetedSaved
            ? Math.round(targetedSaved.shippingFee || 0)
            : action.createNewBill
              ? 0
              : Math.round(active.shippingFee || 0);

      const nextDeposit =
        action.depositAmount >= 0
          ? Math.round(action.depositAmount)
          : targetedSaved
            ? Math.round(targetedSaved.depositAmount || 0)
            : action.createNewBill
              ? 0
              : Math.round(active.depositAmount || 0);

      const baseStage = targetedSaved
        ? targetedSaved.reportStage
        : action.createNewBill
          ? ''
          : active.draftInvoiceStage;

      const baseRemainingPaid = targetedSaved
        ? Boolean(
            targetedSaved.remainingPaid ||
              (targetedSaved.reportStage === 'hoan_thanh' &&
                targetedSaved.remainingPaid !== false)
          )
        : action.createNewBill
          ? false
          : Boolean(active.draftRemainingPaid);

      const baseRemainingPaidAt = targetedSaved
        ? sanitizeOptionalOrderDate(targetedSaved.remainingPaidAt)
        : action.createNewBill
          ? ''
          : sanitizeOptionalOrderDate(active.draftRemainingPaidAt);

      let resolvedStage: ReportStage | '' =
        sanitizeReportStage(action.reportStage) ||
        sanitizeReportStage(baseStage) ||
        'bao_gia';

      let nextRemainingPaid = baseRemainingPaid;
      let nextRemainingPaidAt = baseRemainingPaidAt;

      if (action.markRemainingPaid === true) {
        nextRemainingPaid = true;
        nextRemainingPaidAt =
          sanitizeOptionalOrderDate(action.remainingPaidAt) ||
          baseRemainingPaidAt ||
          getLocalISODate(0);
        resolvedStage = 'hoan_thanh';
      } else if (action.markRemainingPaid === false) {
        nextRemainingPaid = false;
        nextRemainingPaidAt = '';
        if (resolvedStage === 'hoan_thanh') {
          resolvedStage = nextDeposit > 0 ? 'coc' : 'bao_gia';
        }
      } else if (sanitizeReportStage(action.reportStage) === 'hoan_thanh') {
        nextRemainingPaid = true;
        nextRemainingPaidAt =
          sanitizeOptionalOrderDate(action.remainingPaidAt) ||
          baseRemainingPaidAt ||
          getLocalISODate(0);
      } else if (
        sanitizeReportStage(action.reportStage) &&
        sanitizeReportStage(action.reportStage) !== 'hoan_thanh'
      ) {
        nextRemainingPaid = false;
        nextRemainingPaidAt = '';
      } else if (resolvedStage === 'hoan_thanh') {
        nextRemainingPaid = true;
        nextRemainingPaidAt =
          sanitizeOptionalOrderDate(action.remainingPaidAt) ||
          baseRemainingPaidAt ||
          getLocalISODate(0);
      }

      const billUpdateNotes: string[] = [];
      if (action.discountAmount >= 0) {
        billUpdateNotes.push(
          nextDiscount > 0 ? `Giảm khách ${formatVND(nextDiscount)}` : 'Bỏ giảm giá'
        );
      }
      if (action.depositAmount >= 0) {
        billUpdateNotes.push(
          nextDeposit > 0 ? `Cọc ${formatVND(nextDeposit)}` : 'Cọc 0đ'
        );
      }
      if (action.shippingFee >= 0 && nextShipping > 0) {
        billUpdateNotes.push(`Ship ${formatVND(nextShipping)}`);
      }
      if (action.customerName.trim()) {
        billUpdateNotes.push(`KH ${resolvedCustomerName}`);
      }
      if (action.markRemainingPaid === true) {
        billUpdateNotes.push(
          `Đã thu phần còn lại (${formatISODateVN(nextRemainingPaidAt)})`
        );
      } else if (action.markRemainingPaid === false) {
        billUpdateNotes.push('Chưa thu phần còn lại');
      } else if (sanitizeReportStage(action.reportStage)) {
        billUpdateNotes.push(
          resolvedStage === 'hoan_thanh'
            ? `Hoàn thành & tất toán (${formatISODateVN(nextRemainingPaidAt)})`
            : 'Cập nhật giai đoạn'
        );
      }

      // If draft bill currently has 0 items and user updated bill-level info (discount, customer, deposit)
      if (mergedItems.length === 0) {
        if (billUpdateNotes.length === 0) {
          return null;
        }
        setCustomer({
          name: resolvedCustomerName,
          code: resolvedCustomerCode,
          phone: resolvedCustomerPhone,
        });
        setDiscountAmount(nextDiscount);
        setShippingFee(nextShipping);
        setDepositAmount(nextDeposit);
        if (
          sanitizeReportStage(action.reportStage) ||
          typeof action.markRemainingPaid === 'boolean'
        ) {
          setDraftInvoiceStage(resolvedStage);
          setDraftRemainingPaid(nextRemainingPaid);
          setDraftRemainingPaidAt(nextRemainingPaidAt);
        }
        const draftTotals = calculateQuoteTotals(
          [],
          nextDiscount,
          nextShipping,
          nextDeposit
        );
        return {
          invoiceId: '',
          invoiceCode: 'Bill đang soạn',
          customerLabel: resolvedCustomerName
            ? `KH: ${resolvedCustomerName}${resolvedCustomerPhone ? ` (${resolvedCustomerPhone})` : ''}`
            : 'Khách lẻ trên bill',
          addedItemsSummary: billUpdateNotes.join(' · '),
          discountAmount: nextDiscount,
          voucherDeductedAmount: 0,
          remainingAmount: nextRemainingPaid ? 0 : draftTotals.remainingAmount,
          isDraftOnly: true,
        };
      }

      const usedItemIds = new Set<string>();
      const sanitizedItems: QuoteItem[] = mergedItems.map((item, idx) => {
        let itemId = sanitizeSafeId(item.id || `item-${idx}`, `item-${idx}`);
        if (usedItemIds.has(itemId)) {
          itemId = sanitizeSafeId(`${itemId}-${idx}`, `item-${idx}`);
        }
        usedItemIds.add(itemId);
        return {
          id: itemId,
          productId: item.productId,
          name: item.name,
          unit: item.unit,
          quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
          unitPrice: Math.max(0, Math.round(Number(item.unitPrice) || 0)),
          note: item.note || '',
        };
      });

      const resolvedCreatedAt =
        isUpdatingExisting && baseInvoice
          ? baseInvoice.createdAt
          : action.createNewBill
            ? nowISO
            : active.createdAt || nowISO;

      const resolvedDemoDate = targetedSaved
        ? targetedSaved.expectedDemoDate
        : action.createNewBill
          ? getLocalISODate(1)
          : active.expectedDemoDate;

      const resolvedIllustration = targetedSaved
        ? targetedSaved.designIllustration ?? ''
        : action.createNewBill
          ? DEFAULT_DESIGN_ILLUSTRATION
          : active.designIllustration;

      const resolvedNote = targetedSaved
        ? targetedSaved.invoiceNote
        : action.createNewBill
          ? storeSettingsRef.current.footerNote
          : active.invoiceNote;

      const computedTotals = calculateQuoteTotals(
        sanitizedItems,
        nextDiscount,
        nextShipping,
        nextDeposit
      );

      const prevUpdatedMs =
        isUpdatingExisting && baseInvoice
          ? new Date(baseInvoice.updatedAt).getTime()
          : 0;
      const effectiveUpdatedISO = new Date(
        Math.max(
          now.getTime(),
          (Number.isFinite(prevUpdatedMs) ? prevUpdatedMs : 0) + 1000
        )
      ).toISOString();

      const localRecord: SavedInvoice = {
        id: targetId,
        code: targetCode,
        createdAt: resolvedCreatedAt,
        updatedAt: effectiveUpdatedISO,
        expectedDemoDate: resolvedDemoDate,
        customer: {
          name: resolvedCustomerName,
          code: resolvedCustomerCode,
          phone: resolvedCustomerPhone,
        },
        items: sanitizedItems,
        discountAmount: nextDiscount,
        shippingFee: nextShipping,
        depositAmount: nextDeposit,
        designIllustration: resolvedIllustration.slice(0, 200),
        invoiceNote: resolvedNote.slice(0, 3000),
        reportStage: resolvedStage,
        remainingPaid: nextRemainingPaid,
        remainingPaidAt: nextRemainingPaidAt,
        totals: computedTotals,
        syncedToCloud: false,
        syncedOwnerUid: undefined,
      };

      // Sync active Workspace Bill UI immediately so bill & saved order are 100% linked
      setEditingInvoiceId(localRecord.id);
      setCreatedAt(localRecord.createdAt);
      setExpectedDemoDate(localRecord.expectedDemoDate);
      setCustomer(localRecord.customer);
      setQuoteItems(localRecord.items);
      setDiscountAmount(localRecord.discountAmount);
      setShippingFee(localRecord.shippingFee);
      setDepositAmount(localRecord.depositAmount);
      setDesignIllustration(localRecord.designIllustration);
      setInvoiceNote(localRecord.invoiceNote);
      setDraftInvoiceStage(resolvedStage);
      setDraftRemainingPaid(nextRemainingPaid);
      setDraftRemainingPaidAt(nextRemainingPaidAt);

      clearDeletedTombstone(wsId, localRecord.id);
      inFlightSaveIdsRef.current.add(localRecord.id);
      recentlySavedAtRef.current.set(localRecord.id, Date.now());

      const nextLocalList = [
        localRecord,
        ...currentSavedList.filter((inv) => inv.id !== localRecord.id),
      ];
      setSavedInvoices(nextLocalList);
      await saveLocalSavedInvoicesAsync(wsId, nextLocalList);

      triggerSaveSuccessBanner();
      triggerSaleCheer('save');

      // Auto-register customer in Kế Hoạch -> Danh sách KH if name & phone exist
      if (resolvedCustomerName && resolvedCustomerPhone) {
        const phoneDigits = normalizePhoneDigits(resolvedCustomerPhone);
        const matchedExisting = workspaceCustomersRef.current.find((c) =>
          phoneDigits.length >= 6
            ? normalizePhoneDigits(c.phone) === phoneDigits
            : c.name.toLowerCase() === resolvedCustomerName.toLowerCase() &&
              c.phone === resolvedCustomerPhone
        );
        if (
          !matchedExisting ||
          matchedExisting.name !== resolvedCustomerName ||
          matchedExisting.phone !== resolvedCustomerPhone
        ) {
          const autoContact = normalizeCustomerContact({
            id:
              matchedExisting?.id ||
              buildPhoneCustomerId(resolvedCustomerPhone),
            name: resolvedCustomerName,
            phone: resolvedCustomerPhone,
            customerDate:
              matchedExisting?.customerDate ||
              localRecord.createdAt.slice(0, 10),
            note: matchedExisting?.note || '',
            createdAt: matchedExisting?.createdAt || nowISO,
            updatedAt: nowISO,
          });
          if (autoContact) {
            clearCustomerDeletedTombstone(wsId, autoContact.id);
            setWorkspaceCustomers((prev) => {
              const nextContacts = [
                autoContact,
                ...prev.filter((item) => item.id !== autoContact.id),
              ];
              saveLocalCustomers(wsId, nextContacts);
              return nextContacts;
            });
            void upsertCustomerToCloud(sess, autoContact);
          }
        }
      }

      // Sync linked invoice to Cloud in background
      void (async () => {
        try {
          await upsertCloudInvoice(sess, localRecord);
          recentlySavedAtRef.current.set(localRecord.id, Date.now());
          previousServerCloudIdsRef.current.add(localRecord.id);
          setServerConnected(true);
          setSavedInvoices((prev) => {
            const next = prev.map((inv) =>
              inv.id === localRecord.id
                ? {
                    ...inv,
                    syncedToCloud: true,
                    syncedOwnerUid: wsId,
                  }
                : inv
            );
            saveLocalSavedInvoices(wsId, next);
            return next;
          });
        } catch {
          setServerConnected(false);
        } finally {
          inFlightSaveIdsRef.current.delete(localRecord.id);
        }
      })();

      const savedVoucherAudit = auditInvoiceVoucher(
        localRecord,
        storeSettingsRef.current.footerNote
      );
      const summaryParts: string[] = [];
      if (addedLabels.length > 0) {
        summaryParts.push(addedLabels.join(', '));
      }
      if (billUpdateNotes.length > 0) {
        summaryParts.push(billUpdateNotes.join(' · '));
      }

      return {
        invoiceId: localRecord.id,
        invoiceCode: localRecord.code,
        customerLabel: resolvedCustomerName
          ? `KH: ${resolvedCustomerName}${resolvedCustomerPhone ? ` (${resolvedCustomerPhone})` : ''}`
          : 'Khách lẻ trên bill',
        addedItemsSummary:
          summaryParts.length > 0
            ? summaryParts.join(' | ')
            : `${localRecord.items.length} dòng sản phẩm`,
        discountAmount: localRecord.discountAmount,
        voucherDeductedAmount: savedVoucherAudit.voucherDeductAmount,
        remainingAmount: getUncollectedRemainingAmount(localRecord),
      };
    },
    [triggerSaveSuccessBanner, triggerSaleCheer]
  );

  const handleInsertCalculatorItem = useCallback(
    (name: string, amount: number) => {
      handleAddCustomItem(name, 'Gói', 1, amount);
    },
    [handleAddCustomItem]
  );

  if (!accountSession) {
    return (
      <AuthGate
        onAuthenticated={handleAuthenticated}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <Header
        companyName={storeSettings.companyName}
        logoDataUrl={activeLogoDataUrl}
        accountSession={accountSession}
        onLogout={handleLogout}
        onManualSync={handleManualSync}
        serverConnected={serverConnected}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onOpenReorderTable={handleOpenReorderTable}
        onFallbackImage={handlePriceSheetFallbackImage}
        itemCount={totals.totalQuantity}
        savedCount={savedInvoices.length}
        reportCount={reportCount}
        inventoryAlerts={inventoryAlerts}
        onQuickRestockAlert={handleAddInventoryStock}
        unsyncedCount={unsyncedCount}
        isLoadingCloud={isLoadingCloud}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        onQuickCopyInvoice={handleCopyInvoiceImage}
        copySuccess={copySuccess}
        isCopying={isExporting}
      />

      <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 pt-5 sm:pt-6 pb-8 sm:pb-10">
        <div key={activeTab} className="view-smooth-enter">
          {activeTab === AppTab.WORKSPACE && (
            <div className="space-y-4 sm:space-y-5">
              <PrintPriceSheetCard
                products={products}
                store={storeSettings}
                logoDataUrl={activeLogoDataUrl}
                onOpenSettingsTab={handleOpenSettingsFromPriceSheet}
                onFallbackImage={handlePriceSheetFallbackImage}
                onCopiedCheer={handlePriceSheetCopiedCheer}
              />

              <ProductSelector
                products={products}
                quoteItems={quoteItems}
                onAppendProduct={handleAppendProduct}
                onUpdatePickedItemQuantity={handleUpdatePickedItemQuantity}
                onAddCustomItem={handleAddCustomItem}
              />

              <LiveQuoteSidebar
                createdAt={createdAt}
                expectedDemoDate={expectedDemoDate}
                onChangeExpectedDemoDate={setExpectedDemoDate}
                store={storeSettings}
                logoDataUrl={activeLogoDataUrl}
                signatureDataUrl={activeSignatureDataUrl}
                customer={customer}
                onChangeCustomer={setCustomer}
                items={quoteItems}
                onUpdateItem={handleUpdateQuoteItem}
                onRemoveItem={handleRemoveQuoteItem}
                onDuplicateItem={handleDuplicateQuoteItem}
                onMoveItem={handleMoveQuoteItem}
                onResetQuote={handleResetQuote}
                discountAmount={discountAmount}
                onChangeDiscountAmount={setDiscountAmount}
                shippingFee={shippingFee}
                onChangeShippingFee={setShippingFee}
                depositAmount={depositAmount}
                onChangeDepositAmount={setDepositAmount}
                designIllustration={designIllustration}
                onChangeDesignIllustration={setDesignIllustration}
                invoiceNote={invoiceNote}
                onChangeInvoiceNote={setInvoiceNote}
                reportStage={draftInvoiceStage}
                onChangeReportStage={handleChangeDraftStage}
                remainingPaid={draftRemainingPaid}
                remainingPaidAt={draftRemainingPaidAt}
                onChangeRemainingPaid={handleToggleDraftRemainingPaid}
                totals={totals}
                savedCount={savedInvoices.length}
                editingInvoiceCode={editingInvoice ? editingInvoice.code : null}
                saveSuccess={saveSuccess}
                isSaving={isSaving}
                cloudError={cloudError}
                onSaveInvoice={() => void persistInvoiceRecord(false)}
                onSaveAsNewInvoice={() => void persistInvoiceRecord(true)}
                onViewEditingInvoice={
                  editingInvoice
                    ? () => setViewingInvoiceId(editingInvoice.id)
                    : undefined
                }
                onOpenSavedTab={() => handleSelectTab(AppTab.SAVED)}
                onCopyImage={handleCopyInvoiceImage}
                onDownloadImage={handleDownloadPNG}
                onOpenPrintView={() => handleSelectTab(AppTab.INVOICE)}
                onOpenCalculator={
                  storeSettings.showCalculator
                    ? handleOpenCalculator
                    : undefined
                }
                copySuccess={copySuccess}
                isCopying={isExporting}
              />
            </div>
          )}

          {activeTab === AppTab.SAVED && (
            <SavedInvoicesView
              accountUsername={accountSession.usernameKey}
              invoices={savedInvoices}
              activeEditingId={editingInvoiceId}
              isLoadingCloud={isLoadingCloud}
              unsyncedCount={unsyncedCount}
              cloudError={cloudError}
              legacyQuoteCount={unimportedLegacyQuotes.length}
              isImportingLegacy={isImportingLegacy}
              onImportLegacyQuotes={() => void handleImportLegacyQuotes()}
              onDismissLegacyQuotes={handleDismissLegacyQuotes}
              onRetrySync={() => flushPendingCloudOperations(true)}
              onSaveInvoiceStage={handleSaveInvoiceStage}
              onOpenReportsTab={handleOpenReportsTab}
              onViewInvoice={(inv) => setViewingInvoiceId(inv.id)}
              onEditInvoice={(inv) =>
                handleLoadSavedInvoice(inv, AppTab.WORKSPACE)
              }
              onCopySavedInvoiceImage={handleCopySavedInvoiceImage}
              onDeleteInvoice={(id) => void handleDeleteSavedInvoice(id)}
              onCreateNewInvoice={() => {
                handleResetQuote();
                handleSelectTab(AppTab.WORKSPACE);
              }}
            />
          )}

          {activeTab === AppTab.REPORTS && (
            <ReportsView
              activeSubView={activeReportSubView}
              onSelectSubView={handleSelectReportSubView}
              revenueEntries={revenueEntries}
              onAddManualRevenueEntry={handleAddManualRevenueEntry}
              onUpdateRevenueEntry={handleUpdateRevenueEntry}
              onDeleteRevenueEntry={handleDeleteRevenueEntry}
              onRestoreRevenueEntry={handleRestoreRevenueEntry}
              invoices={savedInvoices}
              activeStage={activeReportStage}
              onSelectStage={handleSelectReportStage}
              activeEditingId={editingInvoiceId}
              isLoadingCloud={isLoadingCloud}
              onSaveInvoiceStage={handleSaveInvoiceStage}
              onViewInvoice={(inv) => setViewingInvoiceId(inv.id)}
              onEditInvoice={(inv) =>
                handleLoadSavedInvoice(inv, AppTab.WORKSPACE)
              }
              onCopySavedInvoiceImage={handleCopySavedInvoiceImage}
              onOpenSavedTab={() => handleSelectTab(AppTab.SAVED)}
              onCreateNewInvoice={() => {
                handleResetQuote();
                handleSelectTab(AppTab.WORKSPACE);
              }}
            />
          )}

          {activeTab === AppTab.PLAN && (
            <PlanView
              activeSubTab={activePlanSubTab}
              onSelectSubTab={handleSelectPlanSubTab}
              invoices={savedInvoices}
              voucherBudgets={voucherBudgets}
              customers={workspaceCustomers}
              storeFooterNote={storeSettings.footerNote}
              onSaveVoucherBudget={handleSaveVoucherBudget}
              onSaveInvoiceStage={handleSaveInvoiceStage}
              onUpsertCustomer={handleUpsertCustomer}
              onDeleteCustomer={handleDeleteCustomer}
              onViewInvoice={(inv) => setViewingInvoiceId(inv.id)}
              onEditInvoice={(inv) =>
                handleLoadSavedInvoice(inv, AppTab.WORKSPACE)
              }
              onCreateNewInvoice={() => {
                handleResetQuote();
                handleSelectTab(AppTab.WORKSPACE);
              }}
              onCreateInvoiceForCustomer={handleCreateInvoiceForCustomer}
            />
          )}

          {activeTab === AppTab.INVENTORY && (
            <InventoryView
              items={inventoryItems}
              alerts={inventoryAlerts}
              activeSubTab={activeInventorySubTab}
              onSelectSubTab={setActiveInventorySubTab}
              onFallbackImage={handlePriceSheetFallbackImage}
              onDeductUsage={handleDeductInventoryUsage}
              onAddStock={handleAddInventoryStock}
              onSaveItem={handleSaveInventoryItem}
              onAddNewItem={handleAddNewInventoryItem}
              onDeleteItem={handleDeleteInventoryItem}
              onResetDefaultInventory={handleResetDefaultInventory}
            />
          )}

          {activeTab === AppTab.INVOICE && (
            <InvoicePreview
              createdAt={createdAt}
              expectedDemoDate={expectedDemoDate}
              onChangeExpectedDemoDate={setExpectedDemoDate}
              store={storeSettings}
              logoDataUrl={activeLogoDataUrl}
              signatureDataUrl={activeSignatureDataUrl}
              customer={customer}
              onChangeCustomer={setCustomer}
              items={quoteItems}
              onUpdateItem={handleUpdateQuoteItem}
              onRemoveItem={handleRemoveQuoteItem}
              onDuplicateItem={handleDuplicateQuoteItem}
              onMoveItem={handleMoveQuoteItem}
              discountAmount={discountAmount}
              onChangeDiscountAmount={setDiscountAmount}
              shippingFee={shippingFee}
              onChangeShippingFee={setShippingFee}
              depositAmount={depositAmount}
              onChangeDepositAmount={setDepositAmount}
              designIllustration={designIllustration}
              onChangeDesignIllustration={setDesignIllustration}
              invoiceNote={invoiceNote}
              onChangeInvoiceNote={setInvoiceNote}
              reportStage={draftInvoiceStage}
              onChangeReportStage={handleChangeDraftStage}
              remainingPaid={draftRemainingPaid}
              remainingPaidAt={draftRemainingPaidAt}
              onChangeRemainingPaid={handleToggleDraftRemainingPaid}
              totals={totals}
              savedCount={savedInvoices.length}
              editingInvoiceCode={editingInvoice ? editingInvoice.code : null}
              saveSuccess={saveSuccess}
              isSaving={isSaving}
              cloudError={cloudError}
              onSaveInvoice={() => void persistInvoiceRecord(false)}
              onOpenSavedTab={() => handleSelectTab(AppTab.SAVED)}
              onBackToWorkspace={() => handleSelectTab(AppTab.WORKSPACE)}
              onCopyImage={handleCopyInvoiceImage}
              onDownloadPNG={handleDownloadPNG}
              onDownloadPDF={handleDownloadPDF}
              onOpenCalculator={
                storeSettings.showCalculator ? handleOpenCalculator : undefined
              }
              copySuccess={copySuccess}
              isExporting={isExporting}
            />
          )}

          {activeTab === AppTab.CATALOG && (
            <CatalogManager
              products={products}
              onAddProductToCatalog={handleAddCatalogProduct}
              onUpdateCatalogProduct={handleUpdateCatalogProduct}
              onDeleteCatalogProduct={handleDeleteCatalogProduct}
              onResetCatalog={handleResetCatalog}
            />
          )}

          {activeTab === AppTab.SETTINGS && (
            <StoreSettingsView
              settings={storeSettings}
              logoDataUrl={activeLogoDataUrl}
              isUploadingLogo={isUploadingLogo}
              onUploadLogo={handleUploadWorkspaceLogo}
              onRemoveLogo={handleRemoveWorkspaceLogo}
              signatureDataUrl={activeSignatureDataUrl}
              isUploadingSignature={isUploadingSignature}
              onUploadSignature={handleUploadWorkspaceSignature}
              onRemoveSignature={handleRemoveWorkspaceSignature}
              onSaveSettings={(next) => {
                const normalized = normalizeStoreSettings(next);
                setStoreSettings(normalized);
                saveLocalWorkspaceSettings(
                  accountSession.workspaceId,
                  normalized
                );
                void upsertWorkspaceSettingsToCloud(accountSession, normalized);
                if (
                  !invoiceNote.trim() ||
                  invoiceNote === storeSettings.footerNote
                ) {
                  setInvoiceNote(normalized.footerNote);
                }
              }}
            />
          )}
        </div>
      </main>

      <footer className="no-print w-full border-t border-slate-200/80 bg-slate-50 pt-3 pb-16 sm:py-3.5 px-4 text-center">
        <p className="text-[11px] font-medium text-slate-400">
          Một Sản Phẩm Của ATD Color
        </p>
      </footer>

      <SavedQuoteDetailModal
        invoice={viewingInvoice}
        store={storeSettings}
        logoDataUrl={activeLogoDataUrl}
        signatureDataUrl={activeSignatureDataUrl}
        onClose={() => setViewingInvoiceId(null)}
        onEditInvoice={(inv) => handleLoadSavedInvoice(inv, AppTab.WORKSPACE)}
        onOpenPrintInvoice={(inv) =>
          handleLoadSavedInvoice(inv, AppTab.INVOICE)
        }
        onCopySavedInvoiceImage={handleCopySavedInvoiceImage}
        onDownloadSavedInvoicePDF={handleDownloadSavedInvoicePDF}
        onSaveInvoiceStage={handleSaveInvoiceStage}
      />

      {fallbackImageUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="no-print fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-4"
          onClick={() => setFallbackImageUrl(null)}
        >
          <div
            className="modal-panel-enter bg-white rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="text-sm font-bold text-slate-900">
                Nhấn giữ hoặc chuột phải vào ảnh để Sao chép ảnh
              </div>
              <button
                type="button"
                onClick={() => setFallbackImageUrl(null)}
                aria-label="Đóng"
                className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto bg-slate-100 flex justify-center">
              <img
                src={fallbackImageUrl}
                alt={fallbackImageMeta.altText}
                referrerPolicy="no-referrer"
                className="max-w-full h-auto rounded border border-slate-200 bg-white"
              />
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <a
                href={fallbackImageUrl}
                download={fallbackImageMeta.downloadName}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg whitespace-nowrap shrink-0"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>Tải ảnh về máy</span>
              </a>
              <button
                type="button"
                onClick={() => setFallbackImageUrl(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {saleCheerAction && (
        <div
          role="status"
          aria-live="polite"
          className="no-print fixed top-4 sm:top-5 left-1/2 -translate-x-1/2 z-[60] w-[calc(100vw-2rem)] max-w-md"
        >
          <div className="modal-panel-enter bg-[#4887EE] text-white border border-[#3674DC] rounded-xl shadow-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <CheckCircle2 className="w-5 h-5 text-white shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-medium text-white/90">
                  {saleCheerAction === 'save'
                    ? 'Đã lưu phiếu báo giá'
                    : saleCheerAction === 'price_sheet'
                      ? 'Đã sao chép ảnh bảng giá in ấn'
                      : 'Đã sao chép ảnh hóa đơn'}
                </div>
                <div className="text-sm sm:text-base font-extrabold text-white leading-snug">
                  Chúc Sale Tuấn Đạt chốt thành công nha.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSaleCheerAction(null)}
              aria-label="Đóng thông báo"
              className="p-1 text-white/80 hover:text-white rounded-md transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {storeSettings.showAiChat && (
        <AiChatBox
          isOpen={isAiChatOpen}
          onToggle={handleToggleAiChat}
          onClose={handleCloseAiChat}
          calculatorVisible={storeSettings.showCalculator}
          accountSession={accountSession}
          activeTab={activeTab}
          store={storeSettings}
          hasLogo={Boolean(activeLogoDataUrl)}
          hasSignature={Boolean(activeSignatureDataUrl)}
          products={products}
          editingInvoiceId={editingInvoiceId}
          editingInvoiceCode={editingInvoice?.code || null}
          createdAt={createdAt}
          expectedDemoDate={expectedDemoDate}
          customer={customer}
          quoteItems={quoteItems}
          totals={totals}
          designIllustration={designIllustration}
          invoiceNote={invoiceNote}
          draftInvoiceStage={draftInvoiceStage}
          draftRemainingPaid={draftRemainingPaid}
          draftRemainingPaidAt={draftRemainingPaidAt}
          savedInvoices={savedInvoices}
          revenueEntries={revenueEntries}
          voucherBudgets={voucherBudgets}
          workspaceCustomers={workspaceCustomers}
          inventoryItems={inventoryItems}
          inventoryAlerts={inventoryAlerts}
          onExecuteOrderAction={handleExecuteAiOrderAction}
          onJumpToWorkspaceBill={handleJumpToWorkspaceBill}
          onNavigateTarget={handleAiNavigateTarget}
        />
      )}

      {storeSettings.showCalculator && (
        <HandBillCalculator
          isOpen={isCalculatorOpen}
          onToggle={handleToggleCalculator}
          onClose={handleCloseCalculator}
          onInsertToQuote={handleInsertCalculatorItem}
        />
      )}
    </div>
  );
}

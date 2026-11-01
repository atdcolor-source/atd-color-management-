import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Loader2,
  MessageSquareText,
  RotateCcw,
  Send,
  X,
} from 'lucide-react';
import { apiSendAiChatMessage } from '../services/cloudApiClient';
import {
  AccountSession,
  AiChatMessage,
  AiNavigateTarget,
  AiOrderAction,
  AiOrderExecutionSummary,
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
  buildFullWebContextSummary,
  FullWebContextInput,
  hasMeaningfulOrderChanges,
} from '../utils/aiWorkspaceContext';
import { formatISODateVN, formatVND } from '../utils/formatters';
import {
  isPureConfirmationInput,
  runSmartWorkspaceAssistant,
} from '../utils/smartWorkspaceAssistant';
import { MIN_VOUCHER_DISCOUNT_AMOUNT } from '../utils/voucherAudit';

interface AiChatBoxProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  calculatorVisible: boolean;
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
  draftRemainingPaid: boolean;
  draftRemainingPaidAt: string;
  savedInvoices: SavedInvoice[];
  revenueEntries: RevenueEntry[];
  voucherBudgets: VoucherBudget[];
  workspaceCustomers: CustomerContact[];
  inventoryItems: InventoryItem[];
  inventoryAlerts: InventoryAlert[];
  onExecuteOrderAction: (
    action: AiOrderAction
  ) => Promise<AiOrderExecutionSummary | null>;
  onJumpToWorkspaceBill: () => void;
  onNavigateTarget: (target: AiNavigateTarget) => void;
}

const INITIAL_WELCOME_MESSAGE: AiChatMessage = {
  id: 'welcome-msg',
  role: 'model',
  text: 'Xin chào! Tôi đã đồng bộ trực tiếp 100% với toàn bộ dữ liệu trên web: Doanh thu 2 giai đoạn (Cọc Đợt 1 & Phần còn lại Đợt 2 theo đúng ngày/tháng xác nhận Hoàn thành), Tiến độ 6 giai đoạn, Quỹ Voucher (giảm từ 1.000đ trừ thẳng vào quỹ), Date Khách hàng, Bảng đặt kho (Băng keo tính theo cây) và lên đơn trực tiếp trên bill.',
  createdAt: new Date(0).toISOString(),
};

const QUICK_PROMPTS = [
  'Kiểm tra doanh thu hôm nay bao nhiêu?',
  'Đặt 1 menu ép nhựa A4 2 mặt giảm 10k và ok',
  'Kiểm tra Quỹ Voucher tháng này còn bao nhiêu',
  'Xem danh sách Bảng sản phẩm cần đặt trong kho',
];

const NAVIGATE_TARGET_LABELS: Record<Exclude<AiNavigateTarget, ''>, string> = {
  workspace: 'Mở Chọn & Báo giá',
  saved: 'Mở Báo giá đã lưu',
  reports_revenue: 'Mở Báo cáo doanh thu',
  reports_pipeline: 'Mở Phân loại tiến độ khách',
  plan_voucher: 'Mở Quỹ Voucher tháng',
  plan_customers: 'Mở Danh sách Date KH',
  inventory_stock: 'Mở Quản lý tồn kho',
  inventory_reorder: 'Mở Bảng sản phẩm cần đặt',
  invoice: 'Mở Xem bản in / PDF',
  catalog: 'Mở Sửa bảng giá',
  settings: 'Mở Cài đặt chung',
};

function getChatSessionKey(workspaceId: string): string {
  return `atdcolor_ai_chat_v3_${workspaceId.slice(0, 27)}`;
}

function loadPersistedMessages(workspaceId: string): AiChatMessage[] {
  try {
    const raw = sessionStorage.getItem(getChatSessionKey(workspaceId));
    if (!raw) return [INITIAL_WELCOME_MESSAGE];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const valid = parsed
        .filter(
          (m) =>
            m &&
            typeof m === 'object' &&
            (m.role === 'user' || m.role === 'model') &&
            typeof m.text === 'string' &&
            m.text.trim().length > 0
        )
        .slice(-30) as AiChatMessage[];
      if (valid.length > 0) {
        return valid[0].id === INITIAL_WELCOME_MESSAGE.id
          ? [INITIAL_WELCOME_MESSAGE, ...valid.slice(1)]
          : [INITIAL_WELCOME_MESSAGE, ...valid];
      }
    }
  } catch {
    // Ignore storage read issues
  }
  return [INITIAL_WELCOME_MESSAGE];
}

const COMPACT_ACTION_CHIPS: { label: string; prompt: string }[] = [
  { label: 'Doanh thu hôm nay', prompt: 'Kiểm tra doanh thu hôm nay bao nhiêu?' },
  { label: 'Doanh thu tháng', prompt: 'Tóm tắt doanh thu tháng này (Thiết kế & In)' },
  { label: '+1 Ép nhựa A4 2M', prompt: 'Đặt 1 menu ép nhựa A4 2 mặt và ok' },
  { label: 'Giảm 10k', prompt: 'Giảm cho khách trên bill 10k và ok' },
  { label: 'Quỹ Voucher', prompt: 'Kiểm tra Quỹ Voucher tháng này còn bao nhiêu' },
  { label: 'Bảng đặt kho', prompt: 'Xem danh sách Bảng sản phẩm cần đặt trong kho' },
  { label: 'Tiến độ hôm nay', prompt: 'Thống kê tiến độ khách hàng hôm nay' },
];

export const AiChatBox = memo(function AiChatBox({
  isOpen,
  onToggle,
  onClose,
  calculatorVisible,
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
  revenueEntries,
  voucherBudgets,
  workspaceCustomers,
  inventoryItems,
  inventoryAlerts,
  onExecuteOrderAction,
  onJumpToWorkspaceBill,
  onNavigateTarget,
}: AiChatBoxProps) {
  const [messages, setMessages] = useState<AiChatMessage[]>(() =>
    loadPersistedMessages(accountSession.workspaceId)
  );
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [executingMsgId, setExecutingMsgId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync messages when switching workspace accounts
  useEffect(() => {
    setMessages(loadPersistedMessages(accountSession.workspaceId));
    setErrorMsg(null);
  }, [accountSession.workspaceId]);

  // Persist conversation in sessionStorage so switching tabs or reloading preserves active work
  useEffect(() => {
    try {
      sessionStorage.setItem(
        getChatSessionKey(accountSession.workspaceId),
        JSON.stringify(messages.slice(-30))
      );
    } catch {
      // Ignore storage quota issues
    }
  }, [accountSession.workspaceId, messages]);

  useEffect(() => {
    if (!isOpen) return;
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 60);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages.length, isSending]);

  const latestPendingProposalMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (
        m.role === 'model' &&
        !m.proposalHandled &&
        m.orderAction?.actionType === 'PROPOSE_ORDER' &&
        hasMeaningfulOrderChanges(m.orderAction)
      ) {
        return m;
      }
    }
    return null;
  }, [messages]);

  const fullContextInput = useMemo<FullWebContextInput>(
    () => ({
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
      revenueEntries,
      voucherBudgets,
      workspaceCustomers,
      inventoryItems,
      inventoryAlerts,
      pendingProposal: latestPendingProposalMsg?.orderAction ?? null,
    }),
    [
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
      revenueEntries,
      voucherBudgets,
      workspaceCustomers,
      inventoryItems,
      inventoryAlerts,
      latestPendingProposalMsg,
    ]
  );

  const handleConfirmProposalButton = async (
    msgId: string,
    proposal: AiOrderAction
  ) => {
    if (executingMsgId || isSending) return;
    setExecutingMsgId(msgId);
    setErrorMsg(null);
    try {
      const execAction: AiOrderAction = {
        ...proposal,
        actionType: 'EXECUTE_ORDER',
      };
      const summary = await onExecuteOrderAction(execAction);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                proposalHandled: true,
                executedSummary: summary || undefined,
              }
            : m.orderAction?.actionType === 'PROPOSE_ORDER'
              ? { ...m, proposalHandled: true }
              : m
        )
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Không thể cập nhật đơn hàng lúc này. Vui lòng thử lại.'
      );
    } finally {
      setExecutingMsgId(null);
    }
  };

  const sendPrompt = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || isSending) return;

    const pendingBeforeSend = latestPendingProposalMsg?.orderAction ?? null;
    const isDirectOkConfirm =
      Boolean(pendingBeforeSend) && isPureConfirmationInput(trimmed);

    const userMessage: AiChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
      createdAt: new Date().toISOString(),
    };

    const nextConversation = [...messages, userMessage];
    setMessages(nextConversation);
    setInput('');
    setErrorMsg(null);
    setIsSending(true);

    try {
      // Fast-path 0: Instant local execution when confirming a pending proposal with "ok"
      if (isDirectOkConfirm && pendingBeforeSend) {
        const execAction: AiOrderAction = {
          ...pendingBeforeSend,
          actionType: 'EXECUTE_ORDER',
        };
        const instantSummary = await onExecuteOrderAction(execAction);
        const deductInfo =
          instantSummary &&
          instantSummary.voucherDeductedAmount >= MIN_VOUCHER_DISCOUNT_AMOUNT
            ? ` (đã tự động trừ -${formatVND(instantSummary.voucherDeductedAmount)} vào Quỹ Voucher tháng)`
            : '';
        const localOkMsg: AiChatMessage = {
          id: `m-${Date.now()}`,
          role: 'model',
          text: instantSummary?.isDraftOnly
            ? 'Đã cập nhật trực tiếp thông tin lên bill đang mở!'
            : instantSummary
              ? `Đã chốt cập nhật vào bill và liên kết đơn ${instantSummary.invoiceCode} thành công${deductInfo}!`
              : 'Đã ghi nhận xác nhận trên bill!',
          createdAt: new Date().toISOString(),
          orderAction: execAction,
          proposalHandled: true,
          executedSummary: instantSummary || undefined,
        };
        setMessages((prev) => [
          ...prev.map((m) =>
            m.orderAction?.actionType === 'PROPOSE_ORDER'
              ? { ...m, proposalHandled: true }
              : m
          ),
          localOkMsg,
        ]);
        return;
      }

      const apiMessages = nextConversation
        .filter((m) => m.id !== INITIAL_WELCOME_MESSAGE.id)
        .slice(-14)
        .map((m) => ({
          role: m.role,
          text: m.text,
        }));

      const priorHistory = apiMessages.slice(0, -1);
      const smartPrecheck = runSmartWorkspaceAssistant(trimmed, {
        ...fullContextInput,
        pendingProposal: pendingBeforeSend,
        latestUserQuery: trimmed,
        recentMessages: priorHistory,
      });

      const liveContextSummary = buildFullWebContextSummary({
        ...fullContextInput,
        pendingProposal: pendingBeforeSend,
        latestUserQuery: trimmed,
        recentMessages: priorHistory,
        verifiedQueryBrief:
          smartPrecheck.orderAction.actionType === 'NONE'
            ? smartPrecheck.reply
            : undefined,
      });

      let replyText = '';
      let effectiveAction: AiOrderAction | undefined;

      try {
        const res = await apiSendAiChatMessage({
          messages: apiMessages,
          contextSummary: liveContextSummary,
        });
        if (res.useSmartEngine || !res.reply?.trim()) {
          replyText = smartPrecheck.reply;
          effectiveAction = smartPrecheck.orderAction;
        } else {
          replyText = res.reply.trim();
          effectiveAction = res.orderAction;
          if (
            effectiveAction &&
            !effectiveAction.navigateTarget &&
            smartPrecheck.orderAction.navigateTarget
          ) {
            effectiveAction = {
              ...effectiveAction,
              navigateTarget: smartPrecheck.orderAction.navigateTarget,
            };
          }
        }
      } catch {
        replyText = smartPrecheck.reply;
        effectiveAction = smartPrecheck.orderAction;
      }

      // Deterministic merge if EXECUTE_ORDER references an active pending proposal
      if (effectiveAction?.actionType === 'EXECUTE_ORDER' && pendingBeforeSend) {
        effectiveAction = {
          ...pendingBeforeSend,
          ...effectiveAction,
          actionType: 'EXECUTE_ORDER',
          targetSavedInvoiceId:
            effectiveAction.targetSavedInvoiceId ||
            pendingBeforeSend.targetSavedInvoiceId,
          customerName:
            effectiveAction.customerName || pendingBeforeSend.customerName,
          customerPhone:
            effectiveAction.customerPhone || pendingBeforeSend.customerPhone,
          discountAmount:
            effectiveAction.discountAmount >= 0
              ? effectiveAction.discountAmount
              : pendingBeforeSend.discountAmount,
          shippingFee:
            effectiveAction.shippingFee >= 0
              ? effectiveAction.shippingFee
              : pendingBeforeSend.shippingFee,
          depositAmount:
            effectiveAction.depositAmount >= 0
              ? effectiveAction.depositAmount
              : pendingBeforeSend.depositAmount,
          reportStage:
            effectiveAction.reportStage || pendingBeforeSend.reportStage,
          markRemainingPaid:
            typeof effectiveAction.markRemainingPaid === 'boolean'
              ? effectiveAction.markRemainingPaid
              : pendingBeforeSend.markRemainingPaid,
          remainingPaidAt:
            effectiveAction.remainingPaidAt ||
            pendingBeforeSend.remainingPaidAt,
          itemsToAdd:
            effectiveAction.itemsToAdd.length > 0
              ? effectiveAction.itemsToAdd
              : pendingBeforeSend.itemsToAdd,
        };
      }

      let executedSummary: AiOrderExecutionSummary | undefined;
      if (
        effectiveAction?.actionType === 'EXECUTE_ORDER' &&
        hasMeaningfulOrderChanges(effectiveAction)
      ) {
        const result = await onExecuteOrderAction(effectiveAction);
        if (result) {
          executedSummary = result;
        }
      }

      if (effectiveAction?.autoNavigate && effectiveAction.navigateTarget) {
        onNavigateTarget(effectiveAction.navigateTarget);
      }

      const assistantMsg: AiChatMessage = {
        id: `m-${Date.now()}`,
        role: 'model',
        text: replyText,
        createdAt: new Date().toISOString(),
        orderAction: effectiveAction,
        proposalHandled:
          effectiveAction?.actionType === 'EXECUTE_ORDER' ? true : false,
        executedSummary,
      };

      setMessages((prev) => {
        const updatedPrev =
          effectiveAction?.actionType === 'EXECUTE_ORDER' ||
          effectiveAction?.actionType === 'PROPOSE_ORDER'
            ? prev.map((m) =>
                m.orderAction?.actionType === 'PROPOSE_ORDER'
                  ? { ...m, proposalHandled: true }
                  : m
              )
            : prev;
        return [...updatedPrev, assistantMsg];
      });
    } catch {
      setErrorMsg(
        'Không thể thực thi thao tác trên đơn hàng lúc này. Vui lòng thử lại.'
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendPrompt(input);
  };

  const handleClearChat = () => {
    setMessages([INITIAL_WELCOME_MESSAGE]);
    setErrorMsg(null);
    try {
      sessionStorage.removeItem(getChatSessionKey(accountSession.workspaceId));
    } catch {
      // Ignore storage clear issues
    }
  };

  const activeCustomerLabel = customer.name.trim()
    ? `${customer.name.trim()}${editingInvoiceCode ? ` · ${editingInvoiceCode}` : ''}`
    : editingInvoiceCode
      ? `Đơn ${editingInvoiceCode}`
      : 'Bill đang mở';

  return (
    <>
      {/* Floating Chat AI Launcher Button */}
      <div
        className={`no-print fixed bottom-4 sm:bottom-5 z-40 ${
          calculatorVisible
            ? 'right-[140px] sm:right-[154px]'
            : 'right-4 sm:right-6'
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className={`h-11 inline-flex items-center gap-2 px-4 rounded-xl text-sm font-bold shadow-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            isOpen
              ? 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900'
              : 'bg-white hover:bg-slate-50 text-slate-900 border-slate-300'
          }`}
        >
          <MessageSquareText className="w-4 h-4 text-[#4887EE] shrink-0" />
          <span>Chat AI</span>
        </button>
      </div>

      {/* Expandable Chat AI Box */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Hộp chat Trợ lý AI"
          className="no-print modal-panel-enter fixed bottom-18 right-3 left-3 sm:left-auto sm:right-6 z-50 sm:w-[436px] h-[575px] max-h-[calc(100vh-5.5rem)] flex flex-col bg-white border border-slate-300 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 py-3 bg-[#4887EE] text-white flex items-center justify-between gap-2 border-b border-[#3674DC] shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <MessageSquareText className="w-4 h-4 text-white shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-bold truncate">
                  Trợ lý AI Đồng Bộ Web & Đặt Đơn
                </div>
                <div className="text-[11px] text-white/90 truncate num-clean">
                  {activeCustomerLabel} · {quoteItems.length} món
                  {totals.discountAmount >= MIN_VOUCHER_DISCOUNT_AMOUNT
                    ? ` · Giảm ${formatVND(totals.discountAmount)}`
                    : ''}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleClearChat}
                title="Làm mới cuộc trò chuyện"
                aria-label="Làm mới cuộc trò chuyện"
                className="p-1.5 text-white/85 hover:text-white rounded-md transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Đóng hộp chat AI"
                className="p-1.5 text-white/85 hover:text-white rounded-md transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Web Navigation Bar */}
          <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto shrink-0">
            <button
              type="button"
              onClick={onJumpToWorkspaceBill}
              className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white hover:bg-blue-50 hover:text-[#3674DC] border border-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Phiếu báo giá
            </button>
            <button
              type="button"
              onClick={() => onNavigateTarget('plan_voucher')}
              className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white hover:bg-blue-50 hover:text-[#3674DC] border border-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Quỹ Voucher
            </button>
            <button
              type="button"
              onClick={() => onNavigateTarget('inventory_reorder')}
              className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white hover:bg-blue-50 hover:text-[#3674DC] border border-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 num-clean"
            >
              Bảng đặt kho
              {inventoryAlerts.length > 0 ? ` (${inventoryAlerts.length})` : ''}
            </button>
            <button
              type="button"
              onClick={() => onNavigateTarget('reports_revenue')}
              className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white hover:bg-blue-50 hover:text-[#3674DC] border border-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Doanh thu
            </button>
          </div>

          {/* Messages Viewport */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-slate-50/70">
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              const showPendingProposal =
                !isUser &&
                !msg.proposalHandled &&
                msg.orderAction?.actionType === 'PROPOSE_ORDER' &&
                hasMeaningfulOrderChanges(msg.orderAction);
              const summary = msg.executedSummary;
              const navTarget =
                !isUser && msg.orderAction?.navigateTarget
                  ? msg.orderAction.navigateTarget
                  : '';

              return (
                <div
                  key={msg.id}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words num-clean ${
                      isUser
                        ? 'bg-[#4887EE] text-white font-medium'
                        : 'bg-white text-slate-800 border border-slate-200'
                    }`}
                  >
                    <div>{msg.text}</div>

                    {/* Pending Order / Discount Proposal Action Strip */}
                    {showPendingProposal && msg.orderAction && (
                      <div className="mt-2.5 pt-2.5 border-t border-slate-200 space-y-2 whitespace-normal">
                        <div className="text-xs font-bold text-slate-900">
                          {msg.orderAction.itemsToAdd.length > 0
                            ? 'Chi tiết chờ cập nhật vào bill:'
                            : 'Thông tin chờ áp dụng lên bill:'}
                        </div>
                        {msg.orderAction.itemsToAdd.length > 0 && (
                          <div className="space-y-1 text-xs text-slate-700">
                            {msg.orderAction.itemsToAdd.map((it, idx) => (
                              <div
                                key={`${it.productId || it.name}-${idx}`}
                                className="flex items-baseline justify-between gap-2"
                              >
                                <span className="font-medium text-slate-800">
                                  {it.name} × {it.quantity} {it.unit}
                                </span>
                                <span className="font-bold text-blue-700 whitespace-nowrap shrink-0">
                                  {formatVND(it.quantity * it.unitPrice)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {(msg.orderAction.discountAmount >= 0 ||
                          msg.orderAction.depositAmount >= 0 ||
                          msg.orderAction.shippingFee >= 0 ||
                          typeof msg.orderAction.markRemainingPaid ===
                            'boolean' ||
                          msg.orderAction.customerName.trim()) && (
                          <div className="text-xs text-slate-600 space-y-0.5">
                            {msg.orderAction.customerName.trim() && (
                              <div>
                                Khách hàng:{' '}
                                <strong className="text-slate-900">
                                  {msg.orderAction.customerName}
                                  {msg.orderAction.customerPhone
                                    ? ` (${msg.orderAction.customerPhone})`
                                    : ''}
                                </strong>
                              </div>
                            )}
                            {msg.orderAction.discountAmount >= 0 && (
                              <div className="text-rose-700 font-semibold">
                                Giảm giá:{' '}
                                {formatVND(msg.orderAction.discountAmount)}
                                {msg.orderAction.discountAmount >=
                                MIN_VOUCHER_DISCOUNT_AMOUNT
                                  ? ` (Trừ Quỹ Voucher -${formatVND(msg.orderAction.discountAmount)})`
                                  : ''}
                              </div>
                            )}
                            {msg.orderAction.depositAmount >= 0 && (
                              <div className="text-blue-700 font-semibold">
                                Đã cọc Đợt 1:{' '}
                                {formatVND(msg.orderAction.depositAmount)}
                              </div>
                            )}
                            {msg.orderAction.shippingFee >= 0 && (
                              <div>
                                Tiền ship:{' '}
                                {formatVND(msg.orderAction.shippingFee)}
                              </div>
                            )}
                            {msg.orderAction.markRemainingPaid === true && (
                              <div className="text-emerald-700 font-semibold">
                                Đợt 2: Đã thu phần còn lại (
                                {formatISODateVN(
                                  msg.orderAction.remainingPaidAt || ''
                                ) || 'Hôm nay'}
                                )
                              </div>
                            )}
                            {msg.orderAction.markRemainingPaid === false && (
                              <div className="text-slate-700 font-semibold">
                                Đợt 2: Bỏ tích đã thu phần còn lại
                              </div>
                            )}
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={executingMsgId === msg.id || isSending}
                          onClick={() =>
                            void handleConfirmProposalButton(
                              msg.id,
                              msg.orderAction!
                            )
                          }
                          className="w-full h-8 px-3 inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                        >
                          {executingMsgId === msg.id ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                              <span>Đang đồng bộ đơn...</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5 shrink-0" />
                              <span>OK · Áp dụng & liên kết ngay</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {/* Executed & Linked Bill Confirmation Strip */}
                    {summary && (
                      <div className="mt-2.5 pt-2.5 border-t border-slate-200 space-y-1.5 whitespace-normal">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                          <Check className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {summary.isDraftOnly
                              ? 'Đã cập nhật trực tiếp trên bill đang mở'
                              : `Đã lưu & liên kết đơn ${summary.invoiceCode}`}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 leading-snug">
                          <span>{summary.customerLabel}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{summary.addedItemsSummary}</span>
                          {summary.voucherDeductedAmount >=
                            MIN_VOUCHER_DISCOUNT_AMOUNT && (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span className="font-semibold text-rose-700">
                                Đã trừ Quỹ Voucher -
                                {formatVND(summary.voucherDeductedAmount)}
                              </span>
                            </>
                          )}
                          <span aria-hidden="true"> · </span>
                          <span className="font-semibold text-slate-900">
                            Còn lại: {formatVND(summary.remainingAmount)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <button
                            type="button"
                            onClick={onJumpToWorkspaceBill}
                            className="h-7 px-2.5 inline-flex items-center gap-1 text-xs font-bold text-[#3674DC] bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <span>Xem trên Phiếu báo giá</span>
                            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                          </button>
                          {summary.voucherDeductedAmount >=
                            MIN_VOUCHER_DISCOUNT_AMOUNT && (
                            <button
                              type="button"
                              onClick={() => onNavigateTarget('plan_voucher')}
                              className="h-7 px-2.5 inline-flex items-center gap-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <span>Xem Quỹ Voucher</span>
                              <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Direct Web Screen Jump Button when AI answers about a specific section */}
                    {!summary &&
                      navTarget &&
                      navTarget in NAVIGATE_TARGET_LABELS && (
                        <div className="mt-2 pt-2 border-t border-slate-100 whitespace-normal">
                          <button
                            type="button"
                            onClick={() => onNavigateTarget(navTarget)}
                            className="h-7 px-2.5 inline-flex items-center gap-1 text-xs font-bold text-[#3674DC] bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <span>
                              {
                                NAVIGATE_TARGET_LABELS[
                                  navTarget as Exclude<AiNavigateTarget, ''>
                                ]
                              }
                            </span>
                            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                          </button>
                        </div>
                      )}
                  </div>
                </div>
              );
            })}

            {messages.length === 1 && !isSending && (
              <div className="pt-1 space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-500">
                  Gợi ý sử dụng nhanh trên web:
                </div>
                <div className="flex flex-col gap-1.5">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void sendPrompt(prompt)}
                      className="text-left px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-blue-50 hover:text-[#3674DC] border border-slate-200 rounded-lg transition-colors cursor-pointer"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isSending && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-medium text-slate-600 bg-white border border-slate-200">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4887EE] shrink-0" />
                  <span>Đang đồng bộ dữ liệu...</span>
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="flex items-start gap-2 px-3 py-2.5 text-xs font-medium text-rose-800 bg-rose-50 border border-rose-200 rounded-xl">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div ref={scrollEndRef} />
          </div>

          {/* Persistent 1-Click Quick Command Chips */}
          {messages.length > 1 && (
            <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-200 flex items-center gap-1.5 overflow-x-auto shrink-0">
              {COMPACT_ACTION_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  disabled={isSending}
                  onClick={() => void sendPrompt(chip.prompt)}
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white hover:bg-blue-50 hover:text-[#3674DC] border border-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-45"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}

          {/* Input Box */}
          <form
            onSubmit={handleFormSubmit}
            className="p-3 bg-white border-t border-slate-200 flex items-end gap-2 shrink-0"
          >
            <textarea
              ref={inputRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendPrompt(input);
                }
              }}
              placeholder="Đặt đơn, giảm giá từ 1.000đ, hỏi kho hoặc quỹ voucher..."
              className="flex-1 px-3 py-2 text-xs sm:text-sm text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#4887EE] resize-none leading-snug"
            />
            <button
              type="submit"
              disabled={!input.trim() || isSending}
              aria-label="Gửi tin nhắn"
              className="h-10 px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4 shrink-0" />
              <span>Gửi</span>
            </button>
          </form>
        </div>
      )}
    </>
  );
});

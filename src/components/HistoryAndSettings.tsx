import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Calculator,
  Check,
  ImagePlus,
  MessageSquare,
  PenTool,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { INITIAL_STORE_SETTINGS } from '../data/initialData';
import { StoreSettings } from '../types';
import { formatSignatureDateVN } from '../utils/formatters';

interface StoreSettingsViewProps {
  settings: StoreSettings;
  logoDataUrl: string | null;
  isUploadingLogo?: boolean;
  onUploadLogo: (file: File) => Promise<void>;
  onRemoveLogo: () => Promise<void>;
  signatureDataUrl: string | null;
  isUploadingSignature?: boolean;
  onUploadSignature: (file: File) => Promise<void>;
  onRemoveSignature: () => Promise<void>;
  onSaveSettings: (next: StoreSettings) => void;
}

export function StoreSettingsView({
  settings,
  logoDataUrl,
  isUploadingLogo = false,
  onUploadLogo,
  onRemoveLogo,
  signatureDataUrl,
  isUploadingSignature = false,
  onUploadSignature,
  onRemoveSignature,
  onSaveSettings,
}: StoreSettingsViewProps) {
  const [draft, setDraft] = useState<StoreSettings>(settings);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [logoFeedback, setLogoFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [signatureFeedback, setSignatureFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  const [isDraggingSignature, setIsDraggingSignature] = useState(false);
  const [brokenLogoSrc, setBrokenLogoSrc] = useState<string | null>(null);
  const [brokenSignatureSrc, setBrokenSignatureSrc] = useState<string | null>(
    null
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const signatureInputRef = useRef<HTMLInputElement | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const logoNoticeTimerRef = useRef<number | null>(null);
  const signatureNoticeTimerRef = useRef<number | null>(null);
  const prevSettingsRef = useRef<StoreSettings>(settings);

  useEffect(() => {
    const prev = prevSettingsRef.current;
    prevSettingsRef.current = settings;
    const onlyMediaVersionChanged =
      prev.companyName === settings.companyName &&
      prev.address === settings.address &&
      prev.phone === settings.phone &&
      prev.email === settings.email &&
      prev.tiktok === settings.tiktok &&
      prev.preparerName === settings.preparerName &&
      prev.invoiceTitle === settings.invoiceTitle &&
      prev.footerNote === settings.footerNote &&
      prev.showCalculator === settings.showCalculator &&
      prev.showAiChat === settings.showAiChat &&
      (prev.logoVersion !== settings.logoVersion ||
        prev.signatureVersion !== settings.signatureVersion);

    if (onlyMediaVersionChanged) {
      setDraft((curr) => ({
        ...curr,
        logoVersion: settings.logoVersion,
        signatureVersion: settings.signatureVersion,
      }));
    } else {
      setDraft(settings);
    }
  }, [settings]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
      if (logoNoticeTimerRef.current !== null) {
        window.clearTimeout(logoNoticeTimerRef.current);
      }
      if (signatureNoticeTimerRef.current !== null) {
        window.clearTimeout(signatureNoticeTimerRef.current);
      }
    };
  }, []);

  const showSavedMessage = (msg: string) => {
    setSavedNotice(msg);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setSavedNotice(null);
      noticeTimerRef.current = null;
    }, 2400);
  };

  const showLogoFeedback = (type: 'success' | 'error', message: string) => {
    setLogoFeedback({ type, message });
    if (logoNoticeTimerRef.current !== null) {
      window.clearTimeout(logoNoticeTimerRef.current);
    }
    logoNoticeTimerRef.current = window.setTimeout(() => {
      setLogoFeedback(null);
      logoNoticeTimerRef.current = null;
    }, 3600);
  };

  const showSignatureFeedback = (
    type: 'success' | 'error',
    message: string
  ) => {
    setSignatureFeedback({ type, message });
    if (signatureNoticeTimerRef.current !== null) {
      window.clearTimeout(signatureNoticeTimerRef.current);
    }
    signatureNoticeTimerRef.current = window.setTimeout(() => {
      setSignatureFeedback(null);
      signatureNoticeTimerRef.current = null;
    }, 3600);
  };

  const handleProcessLogoFile = async (file: File | undefined | null) => {
    if (!file || isUploadingLogo) return;
    setLogoFeedback(null);
    try {
      await onUploadLogo(file);
      showLogoFeedback('success', 'Đã tải ảnh logo gốc và đặt ở góc Bill!');
    } catch (err) {
      showLogoFeedback(
        'error',
        err instanceof Error
          ? err.message
          : 'Không thể tải ảnh logo. Vui lòng thử lại.'
      );
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleClearLogo = async () => {
    if (isUploadingLogo || !logoDataUrl) return;
    setLogoFeedback(null);
    try {
      await onRemoveLogo();
      showLogoFeedback('success', 'Đã xóa logo khỏi góc Bill.');
    } catch {
      showLogoFeedback('error', 'Không thể xóa logo lúc này.');
    }
  };

  const handleProcessSignatureFile = async (file: File | undefined | null) => {
    if (!file || isUploadingSignature) return;
    setSignatureFeedback(null);
    try {
      await onUploadSignature(file);
      showSignatureFeedback(
        'success',
        'Đã cài đặt ảnh chữ ký (hiển thị trước họ và tên Người lập báo giá)!'
      );
    } catch (err) {
      showSignatureFeedback(
        'error',
        err instanceof Error
          ? err.message
          : 'Không thể tải ảnh chữ ký. Vui lòng thử lại.'
      );
    } finally {
      if (signatureInputRef.current) {
        signatureInputRef.current.value = '';
      }
    }
  };

  const handleClearSignature = async () => {
    if (isUploadingSignature || !signatureDataUrl) return;
    setSignatureFeedback(null);
    try {
      await onRemoveSignature();
      showSignatureFeedback(
        'success',
        'Đã xóa ảnh chữ ký tại mục Người lập báo giá.'
      );
    } catch {
      showSignatureFeedback('error', 'Không thể xóa ảnh chữ ký lúc này.');
    }
  };

  const handleToggleCalculator = () => {
    const nextEnabled = !draft.showCalculator;
    const nextDraft: StoreSettings = {
      ...draft,
      showCalculator: nextEnabled,
      logoVersion: settings.logoVersion,
      signatureVersion: settings.signatureVersion,
    };
    setDraft(nextDraft);
    onSaveSettings(nextDraft);
    showSavedMessage(
      nextEnabled ? 'Đã mở nút Máy tính' : 'Đã tắt nút Máy tính'
    );
  };

  const handleToggleAiChat = () => {
    const nextEnabled = !draft.showAiChat;
    const nextDraft: StoreSettings = {
      ...draft,
      showAiChat: nextEnabled,
      logoVersion: settings.logoVersion,
      signatureVersion: settings.signatureVersion,
    };
    setDraft(nextDraft);
    onSaveSettings(nextDraft);
    showSavedMessage(
      nextEnabled ? 'Đã mở Hộp Chat AI' : 'Đã tắt Hộp Chat AI'
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings({
      ...draft,
      logoVersion: settings.logoVersion,
      signatureVersion: settings.signatureVersion,
    });
    showSavedMessage('Đã lưu cài đặt chung');
  };

  const handleRestoreDefaults = () => {
    const nextDefaults: StoreSettings = {
      ...INITIAL_STORE_SETTINGS,
      logoVersion: settings.logoVersion,
      signatureVersion: settings.signatureVersion,
    };
    setDraft(nextDefaults);
    onSaveSettings(nextDefaults);
    showSavedMessage('Đã khôi phục mặc định ATD Color');
  };

  const canShowLogo = Boolean(logoDataUrl && logoDataUrl !== brokenLogoSrc);
  const canShowSignature = Boolean(
    signatureDataUrl && signatureDataUrl !== brokenSignatureSrc
  );

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Cài đặt chung
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Tùy chỉnh logo công ty, chữ ký người lập báo giá, công cụ hỗ trợ và thông tin mặc định trên phiếu đặt hàng
          </p>
        </div>

        <button
          type="button"
          onClick={handleRestoreDefaults}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5 shrink-0" />
          <span>Mặc định ATD Color</span>
        </button>
      </div>

      {/* Company Logo Upload Section (Placed at Bill Corner) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm sm:text-base font-bold text-slate-900">
              Ảnh Logo công ty (Đặt ở góc Bill)
            </div>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5 leading-relaxed">
              Tải ảnh logo gốc lên (ưu tiên PNG nền trong suốt, WebP, JPG hoặc SVG) để tự động đặt sắc nét ở góc trên bên trái phiếu đặt hàng, bản in và ảnh/PDF xuất ra.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,image/*"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                void handleProcessLogoFile(selected);
              }}
            />

            <button
              type="button"
              disabled={isUploadingLogo}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Upload className="w-4 h-4 shrink-0" />
              <span>
                {isUploadingLogo
                  ? 'Đang xử lý...'
                  : canShowLogo
                    ? 'Đổi ảnh logo gốc'
                    : 'Tải ảnh logo gốc lên'}
              </span>
            </button>

            {canShowLogo && (
              <button
                type="button"
                disabled={isUploadingLogo}
                onClick={() => void handleClearLogo()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span>Xóa logo</span>
              </button>
            )}
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!isDraggingLogo) setIsDraggingLogo(true);
          }}
          onDragLeave={() => setIsDraggingLogo(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingLogo(false);
            const droppedFile = e.dataTransfer.files?.[0];
            void handleProcessLogoFile(droppedFile);
          }}
          onClick={() => {
            if (!canShowLogo && !isUploadingLogo) {
              fileInputRef.current?.click();
            }
          }}
          className={`pt-3.5 border-t border-slate-100 transition-colors ${
            isDraggingLogo
              ? 'bg-blue-50/60 rounded-lg p-3.5'
              : !canShowLogo
                ? 'cursor-pointer hover:bg-slate-50/70 rounded-lg p-3.5'
                : ''
          }`}
        >
          {canShowLogo ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-500">
                Xem trước góc trên bên trái của Bill:
              </div>
              <div className="pt-1 flex items-center gap-3.5 sm:gap-4 overflow-hidden">
                <img
                  src={logoDataUrl!}
                  alt={`Logo ${draft.companyName || 'ATD Color'}`}
                  referrerPolicy="no-referrer"
                  decoding="async"
                  onError={() => setBrokenLogoSrc(logoDataUrl)}
                  className="h-14 sm:h-16 w-auto max-w-[140px] sm:max-w-[180px] object-contain object-left shrink-0 select-none"
                />
                <div className="min-w-0 space-y-1">
                  <div className="text-xs sm:text-sm text-slate-800 font-semibold truncate">
                    {[
                      draft.address,
                      draft.phone ? `ĐT: ${draft.phone}` : '',
                    ]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {[
                      draft.email ? `Email: ${draft.email}` : '',
                      draft.tiktok ? `TikTok: ${draft.tiktok}` : '',
                    ]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 py-2 text-center sm:text-left">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-[#4887EE] shrink-0">
                <ImagePlus className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">
                  Nhấn vào đây hoặc kéo thả ảnh logo gốc của công ty
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Giữ nguyên độ nét gốc và nền trong suốt · Tự động hiển thị ở góc Bill trên mọi thiết bị cùng tài khoản
                </div>
              </div>
            </div>
          )}
        </div>

        {logoFeedback && (
          <div
            className={`view-smooth-enter flex items-center gap-2 text-xs sm:text-sm font-semibold px-3.5 py-2.5 rounded-lg ${
              logoFeedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-rose-50 text-rose-800'
            }`}
          >
            {logoFeedback.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            )}
            <span>{logoFeedback.message}</span>
          </div>
        )}
      </div>

      {/* Preparer Signature Upload Section (Displayed directly underneath Preparer Name) */}
      <div
        id="signature-settings-section"
        onDragOver={(e) => {
          e.preventDefault();
          if (!isDraggingSignature) setIsDraggingSignature(true);
        }}
        onDragLeave={() => setIsDraggingSignature(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingSignature(false);
          const droppedFile = e.dataTransfer.files?.[0];
          void handleProcessSignatureFile(droppedFile);
        }}
        className={`bg-white border rounded-xl p-4 sm:p-5 space-y-4 transition-colors ${
          isDraggingSignature
            ? 'border-blue-500 bg-blue-50/40'
            : 'border-slate-200'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm sm:text-base font-bold text-slate-900">
              Ảnh chữ ký Người lập báo giá
            </div>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5 leading-relaxed">
              Đưa file ảnh chữ ký vào đây (ưu tiên PNG tách nền trong suốt, JPG, WebP hoặc SVG) để hiển thị ở góc phải bên dưới bảng thanh toán theo đúng thứ tự: ngày tháng năm, <strong>Người lập báo giá</strong>, <em>(Chữ ký, ghi rõ họ tên)</em>, ảnh chữ ký và họ tên.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={signatureInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,image/*"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                void handleProcessSignatureFile(selected);
              }}
            />

            <button
              type="button"
              disabled={isUploadingSignature}
              onClick={() => signatureInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Upload className="w-4 h-4 shrink-0" />
              <span>
                {isUploadingSignature
                  ? 'Đang xử lý...'
                  : canShowSignature
                    ? 'Đổi ảnh chữ ký'
                    : 'Tải ảnh chữ ký lên'}
              </span>
            </button>

            {canShowSignature && (
              <button
                type="button"
                disabled={isUploadingSignature}
                onClick={() => void handleClearSignature()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span>Xóa chữ ký</span>
              </button>
            )}
          </div>
        </div>

        <div
          onClick={() => {
            if (!canShowSignature && !isUploadingSignature) {
              signatureInputRef.current?.click();
            }
          }}
          className={`pt-3.5 border-t border-slate-100 ${
            !canShowSignature
              ? 'cursor-pointer hover:bg-slate-50/70 rounded-lg p-3.5'
              : ''
          }`}
        >
          {canShowSignature ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-500">
                Xem trước phần Người lập báo giá (hiển thị bên phải phiếu):
              </div>
              <div className="flex justify-end pt-1">
                <div className="w-full sm:w-72 text-center space-y-0.5 num-clean">
                  <div className="text-xs sm:text-sm italic text-slate-600">
                    {formatSignatureDateVN()}
                  </div>
                  <div className="text-sm sm:text-base font-bold text-slate-900">
                    Người lập báo giá
                  </div>
                  <div className="text-xs italic text-slate-500">
                    (Chữ ký, ghi rõ họ tên)
                  </div>
                  <div className="pt-1.5 pb-1 flex justify-center">
                    <img
                      src={signatureDataUrl!}
                      alt={`Chữ ký ${draft.preparerName || 'Người lập báo giá'}`}
                      referrerPolicy="no-referrer"
                      decoding="async"
                      onError={() => setBrokenSignatureSrc(signatureDataUrl)}
                      className="h-16 sm:h-[72px] w-auto max-w-[220px] object-contain mx-auto select-none"
                    />
                  </div>
                  <div className="text-base font-bold text-slate-900">
                    {draft.preparerName.trim() || 'Nguyễn Tuấn Đạt'}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 py-2 text-center sm:text-left">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-[#4887EE] shrink-0">
                <PenTool className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">
                  Nhấn vào đây hoặc kéo thả file ảnh chữ ký người lập báo giá
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Hiển thị chữ ký rồi tới họ và tên <strong>{draft.preparerName.trim() || 'Người lập báo giá'}</strong> · Đồng bộ tự động trên mọi thiết bị
                </div>
              </div>
            </div>
          )}
        </div>

        {signatureFeedback && (
          <div
            className={`view-smooth-enter flex items-center gap-2 text-xs sm:text-sm font-semibold px-3.5 py-2.5 rounded-lg ${
              signatureFeedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-rose-50 text-rose-800'
            }`}
          >
            {signatureFeedback.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            )}
            <span>{signatureFeedback.message}</span>
          </div>
        )}
      </div>

      {/* Quick Utility Toggle: Manual Bill Calculator */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
              draft.showCalculator
                ? 'bg-blue-50 text-blue-600'
                : 'bg-slate-100 text-slate-400'
            }`}
          >
            <Calculator className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm sm:text-base font-bold text-slate-900">
              Máy tính
            </div>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5 leading-relaxed">
              Bật hoặc tắt nút <strong>Máy tính</strong> ở góc dưới màn hình và trong phiếu đặt hàng khi cần tính nhẩm nhanh.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <span
            className={`text-xs font-bold whitespace-nowrap ${
              draft.showCalculator ? 'text-emerald-700' : 'text-slate-500'
            }`}
          >
            {draft.showCalculator ? 'Đang mở' : 'Đang tắt'}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={draft.showCalculator}
            aria-label="Bật hoặc tắt máy tính tính bill tay"
            onClick={handleToggleCalculator}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4887EE] ${
              draft.showCalculator ? 'bg-[#4887EE]' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                draft.showCalculator ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Quick Utility Toggle: AI Chat Assistant Box */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
              draft.showAiChat
                ? 'bg-blue-50 text-blue-600'
                : 'bg-slate-100 text-slate-400'
            }`}
          >
            <MessageSquare className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm sm:text-base font-bold text-slate-900">
              Hộp Chat AI
            </div>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5 leading-relaxed">
              Mở hoặc tắt mục <strong>Chat AI</strong> ở góc dưới bên phải màn hình (tra cứu dữ liệu toàn web &amp; đặt hàng liên kết trực tiếp vào bill khách).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <span
            className={`text-xs font-bold whitespace-nowrap ${
              draft.showAiChat ? 'text-emerald-700' : 'text-slate-500'
            }`}
          >
            {draft.showAiChat ? 'Đang mở' : 'Đang tắt'}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={draft.showAiChat}
            aria-label="Mở hoặc tắt hộp Chat AI"
            onClick={handleToggleAiChat}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4887EE] ${
              draft.showAiChat ? 'bg-[#4887EE]' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                draft.showAiChat ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Tên thương hiệu (Thanh tiêu đề web)
            </label>
            <input
              type="text"
              required
              value={draft.companyName}
              onChange={(e) =>
                setDraft({ ...draft, companyName: e.target.value })
              }
              className="w-full h-10 px-3 text-sm font-semibold border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Tiêu đề phiếu
            </label>
            <input
              type="text"
              required
              value={draft.invoiceTitle}
              onChange={(e) =>
                setDraft({ ...draft, invoiceTitle: e.target.value })
              }
              className="w-full h-10 px-3 text-sm font-semibold border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Địa chỉ
            </label>
            <input
              type="text"
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Số điện thoại
            </label>
            <input
              type="text"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              className="w-full h-10 px-3 text-sm num-clean border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Email
            </label>
            <input
              type="text"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              TikTok
            </label>
            <input
              type="text"
              value={draft.tiktok}
              onChange={(e) => setDraft({ ...draft, tiktok: e.target.value })}
              className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
            />
          </div>

          <div className="sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <label className="block text-xs font-semibold text-slate-700">
                Người lập báo giá
              </label>
              <button
                type="button"
                disabled={isUploadingSignature}
                onClick={() => signatureInputRef.current?.click()}
                className="text-xs font-semibold text-[#4887EE] hover:text-[#3674DC] underline underline-offset-2 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {canShowSignature
                  ? 'Đổi file ảnh chữ ký người lập'
                  : '+ Đưa file ảnh chữ ký người lập vào'}
              </button>
            </div>
            {canShowSignature && (
              <div className="mb-2 flex items-center gap-3 text-xs text-slate-500">
                <span>Chữ ký (trên họ và tên):</span>
                <img
                  src={signatureDataUrl!}
                  alt={`Chữ ký ${draft.preparerName || 'Người lập báo giá'}`}
                  referrerPolicy="no-referrer"
                  decoding="async"
                  onError={() => setBrokenSignatureSrc(signatureDataUrl)}
                  className="h-10 w-auto max-w-[140px] object-contain object-left select-none"
                />
              </div>
            )}
            <input
              type="text"
              value={draft.preparerName}
              onChange={(e) =>
                setDraft({ ...draft, preparerName: e.target.value })
              }
              className="w-full h-10 px-3 text-sm font-semibold border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Ghi chú mặc định khi tạo đơn mới
            </label>
            <textarea
              rows={6}
              value={draft.footerNote}
              onChange={(e) =>
                setDraft({ ...draft, footerNote: e.target.value })
              }
              className="w-full p-3 text-sm leading-relaxed border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900 resize-y"
            />
          </div>
        </div>

        <div className="pt-2 flex items-center justify-end gap-3">
          {savedNotice && (
            <span className="view-smooth-enter inline-flex items-center gap-1 text-sm font-semibold text-emerald-700">
              <Check className="w-4 h-4 shrink-0" />
              <span>{savedNotice}</span>
            </span>
          )}
          <button
            type="submit"
            className="px-5 py-2.5 text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg cursor-pointer whitespace-nowrap shrink-0"
          >
            Lưu thay đổi
          </button>
        </div>
      </form>
    </div>
  );
}

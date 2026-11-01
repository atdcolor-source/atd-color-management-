import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  FileText,
} from 'lucide-react';
import { Product, StoreSettings } from '../types';
import {
  buildPrintPriceSheetGroups,
  copyPriceSheetImageToClipboard,
  exportPriceSheetPNG,
  formatPriceSheetPlainText,
} from '../utils/exportPriceSheet';
import { formatVND } from '../utils/formatters';

interface PrintPriceSheetCardProps {
  products: Product[];
  store: StoreSettings;
  logoDataUrl?: string | null;
  onOpenSettingsTab?: () => void;
  onFallbackImage: (
    dataUrl: string,
    downloadName: string,
    altText: string
  ) => void;
  onCopiedCheer?: () => void;
}

async function copyPlainTextSafe(text: string): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'true');
    ta.className = 'sr-only';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export const PrintPriceSheetCard = memo(function PrintPriceSheetCard({
  products,
  store,
  logoDataUrl,
  onOpenSettingsTab,
  onFallbackImage,
  onCopiedCheer,
}: PrintPriceSheetCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [copiedMode, setCopiedMode] = useState<'image' | 'text' | null>(null);
  const [brokenLogoSrc, setBrokenLogoSrc] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  const canShowLogo = Boolean(logoDataUrl && logoDataUrl !== brokenLogoSrc);
  const groups = useMemo(() => buildPrintPriceSheetGroups(products), [products]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const flashCopied = useCallback((mode: 'image' | 'text') => {
    setCopiedMode(mode);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      setCopiedMode(null);
      copiedTimerRef.current = null;
    }, 3500);
  }, []);

  const handleCopyImage = useCallback(async () => {
    if (isWorking) return;
    setIsWorking(true);
    try {
      const result = await copyPriceSheetImageToClipboard({
        products,
        store,
        logoDataUrl,
      });
      if (result.status === 'copied') {
        flashCopied('image');
      } else {
        onFallbackImage(
          result.dataUrl,
          'Bang-Gia-In-An-ATD-Color.png',
          'Bảng giá in ấn ATD Color'
        );
      }
      onCopiedCheer?.();
    } finally {
      setIsWorking(false);
    }
  }, [
    isWorking,
    products,
    store,
    logoDataUrl,
    flashCopied,
    onFallbackImage,
    onCopiedCheer,
  ]);

  const handleCopyText = useCallback(async () => {
    const plain = formatPriceSheetPlainText(products, store);
    const ok = await copyPlainTextSafe(plain);
    if (ok) {
      flashCopied('text');
    }
  }, [products, store, flashCopied]);

  const handleDownloadImage = useCallback(async () => {
    if (isWorking) return;
    setIsWorking(true);
    try {
      await exportPriceSheetPNG({
        products,
        store,
        logoDataUrl,
      });
    } finally {
      setIsWorking(false);
    }
  }, [isWorking, products, store, logoDataUrl]);

  const contactLine1 = [
    store.address.trim(),
    store.phone.trim() ? `ĐT: ${store.phone.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const contactLine2 = [
    store.email.trim() ? `Email: ${store.email.trim()}` : '',
    store.tiktok.trim() ? `TikTok: ${store.tiktok.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      aria-label="Thông tin bảng giá in ấn gửi khách"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      {/* Compact bar — hidden table until staff clicks "Xem bảng giá" */}
      <div className="px-3.5 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
          <h2 className="text-xs sm:text-sm font-bold text-slate-900">
            Bảng giá in ấn gửi khách
          </h2>
          <span className="text-xs text-slate-500">
            · Ép nhựa Plastic (Giấy 300) · In Decal + Formex (5mm)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-expanded={isOpen}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isOpen
                ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
            }`}
          >
            {isOpen ? (
              <>
                <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                <span>Ẩn bảng giá</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5 shrink-0 text-[#4887EE]" />
                <span>Xem bảng giá</span>
                <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              </>
            )}
          </button>

          <button
            type="button"
            disabled={isWorking}
            onClick={() => void handleCopyImage()}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
              copiedMode === 'image'
                ? 'bg-emerald-600 text-white'
                : 'bg-[#4887EE] text-white hover:bg-[#3674DC]'
            }`}
          >
            {copiedMode === 'image' ? (
              <>
                <Check className="w-3.5 h-3.5 shrink-0" />
                <span>Đã sao chép ảnh</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 shrink-0" />
                <span>Sao chép ảnh gửi khách</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Expanded Preview & Export Controls — only shown when "Xem bảng giá" is clicked */}
      {isOpen && (
        <div className="view-smooth-enter border-t border-slate-200 bg-slate-50/70 p-3.5 sm:p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                Bấm <strong>Sao chép ảnh gửi khách</strong> để dán trực tiếp vào
                Zalo, Messenger cho khách xem.
              </span>
              {!canShowLogo && onOpenSettingsTab && (
                <button
                  type="button"
                  onClick={onOpenSettingsTab}
                  className="text-xs font-semibold text-[#3674DC] hover:underline underline-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  + Cài đặt ảnh Logo góc trái
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleCopyText()}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  copiedMode === 'text'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {copiedMode === 'text' ? (
                  <>
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span>Đã chép nội dung chữ</span>
                  </>
                ) : (
                  <>
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span>Sao chép chữ</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isWorking}
                onClick={() => void handleDownloadImage()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Tải ảnh PNG</span>
              </button>
            </div>
          </div>

          {/* Printable / Customer-Facing Ruled Price Card */}
          <div className="max-w-[880px] mx-auto bg-white border border-slate-300 rounded-lg overflow-hidden">
            <div className="h-1.5 bg-[#4887EE]" />

            <div className="p-4 sm:p-6 space-y-4">
              {/* Top Header with Logo in Top-Left Corner */}
              <div className="flex flex-wrap items-center justify-between gap-4 pb-3.5 border-b border-slate-200">
                <div className="shrink-0">
                  {canShowLogo ? (
                    <img
                      src={logoDataUrl!}
                      alt={store.companyName || 'ATD Color'}
                      referrerPolicy="no-referrer"
                      decoding="async"
                      onError={() => setBrokenLogoSrc(logoDataUrl || null)}
                      className="h-11 sm:h-14 w-auto max-w-[176px] object-contain object-left select-none"
                    />
                  ) : (
                    <div className="text-lg sm:text-xl font-extrabold tracking-tight text-[#4887EE]">
                      {store.companyName || 'ATD Color'}
                    </div>
                  )}
                </div>

                {(contactLine1 || contactLine2) && (
                  <div className="text-xs sm:text-[13px] text-slate-600 sm:text-right space-y-0.5 num-clean">
                    {contactLine1 && (
                      <div className="font-semibold text-slate-800">
                        {contactLine1}
                      </div>
                    )}
                    {contactLine2 && <div>{contactLine2}</div>}
                  </div>
                )}
              </div>

              {/* Centered Sheet Title */}
              <div className="text-center space-y-1 py-0.5">
                <h3 className="text-base sm:text-xl font-extrabold tracking-tight text-slate-900">
                  THÔNG TIN BẢNG GIÁ IN ẤN
                </h3>
                <p className="text-xs sm:text-[13px] font-bold text-slate-600">
                  (ĐƠN VỊ: GIÁ 1 / BẢNG / TỜ)
                </p>
              </div>

              {/* Crisp Full-Grid Ruled Price Table */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[540px] border-collapse border border-slate-400 text-sm num-clean">
                  <thead>
                    <tr className="bg-[#4887EE] text-white">
                      <th
                        rowSpan={2}
                        className="w-[40%] px-4 py-2.5 text-left text-xs sm:text-sm font-bold border border-white/40 align-middle"
                      >
                        CHẤT LIỆU
                      </th>
                      <th
                        rowSpan={2}
                        className="w-[18%] px-3 py-2.5 text-center text-xs sm:text-sm font-bold border border-white/40 align-middle whitespace-nowrap"
                      >
                        KÍCH THƯỚC
                      </th>
                      <th
                        colSpan={2}
                        className="w-[42%] px-4 py-2 text-center text-xs sm:text-sm font-bold border border-white/40"
                      >
                        GIÁ IN
                      </th>
                    </tr>
                    <tr className="bg-[#3674DC] text-white">
                      <th className="w-[21%] px-4 py-2 text-right text-xs sm:text-[13px] font-bold border border-white/40 whitespace-nowrap">
                        1 MẶT
                      </th>
                      <th className="w-[21%] px-4 py-2 text-right text-xs sm:text-[13px] font-bold border border-white/40 whitespace-nowrap">
                        2 MẶT
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {groups.map((group, groupIdx) =>
                      group.rows.map((row, rowIdx) => {
                        const isFirstInGroup = rowIdx === 0;
                        const topBorderClass =
                          isFirstInGroup && groupIdx > 0
                            ? 'border-t-2 border-t-slate-400'
                            : '';
                        return (
                          <tr
                            key={`${group.id}-${row.size}`}
                            className={`${
                              rowIdx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'
                            } hover:bg-blue-50/40 transition-colors`}
                          >
                            {isFirstInGroup && (
                              <td
                                rowSpan={group.rows.length}
                                className={`px-4 py-3 align-middle border border-slate-300 ${topBorderClass} ${
                                  groupIdx % 2 === 0
                                    ? 'bg-slate-50/60'
                                    : 'bg-slate-100/60'
                                }`}
                              >
                                <div className="font-extrabold text-slate-900 text-sm sm:text-[15px] leading-snug">
                                  {group.title}
                                </div>
                                <div className="font-semibold text-slate-700 text-xs sm:text-[13px] mt-0.5">
                                  {group.subtitle}
                                </div>
                                <div className="text-xs text-slate-500 mt-1">
                                  {group.unitLabel}
                                </div>
                              </td>
                            )}

                            <td
                              className={`px-3 py-2.5 text-center font-extrabold text-slate-900 border border-slate-300 ${topBorderClass} whitespace-nowrap`}
                            >
                              {row.size}
                            </td>

                            <td
                              className={`px-4 py-2.5 text-right font-bold text-slate-900 border border-slate-300 ${topBorderClass} whitespace-nowrap`}
                            >
                              {formatVND(row.price1Side)}
                            </td>

                            <td
                              className={`px-4 py-2.5 text-right font-bold text-blue-700 border border-slate-300 ${topBorderClass} whitespace-nowrap`}
                            >
                              {formatVND(row.price2Side)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-slate-500">
                * Đơn giá tính trên 1 bảng / 1 tờ thành phẩm (chưa bao gồm chi
                phí thiết kế và vận chuyển).
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
});

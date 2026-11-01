import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Minus,
  PackagePlus,
  Plus,
} from 'lucide-react';
import { InventoryAlert } from '../types';
import {
  copyReorderTableImageToClipboard,
  exportReorderTablePNG,
  ReorderTableRow,
} from '../utils/exportReorderTable';
import { formatNumberVN } from '../utils/formatters';

interface ReorderProductsTableProps {
  alerts: InventoryAlert[];
  compact?: boolean;
  onRestockItem: (itemId: string, addQty: number) => void;
  onOpenFullOrderTable?: () => void;
  onSwitchToStockTab?: () => void;
  onFallbackImage?: (
    dataUrl: string,
    downloadName: string,
    altText: string
  ) => void;
}

export const ReorderProductsTable = memo(function ReorderProductsTable({
  alerts,
  compact = false,
  onRestockItem,
  onOpenFullOrderTable,
  onSwitchToStockTab,
  onFallbackImage,
}: ReorderProductsTableProps) {
  const [customOrderQty, setCustomOrderQty] = useState<Record<string, number>>(
    {}
  );
  const [isExporting, setIsExporting] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const [confirmRestockAll, setConfirmRestockAll] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const effectiveRows = useMemo<ReorderTableRow[]>(() => {
    return alerts.map((alert) => {
      const override = customOrderQty[alert.itemId];
      const finalOrderQty =
        typeof override === 'number' && override >= 1
          ? Math.min(100_000, Math.round(override))
          : alert.orderQuantity;

      return {
        itemId: alert.itemId,
        itemName: alert.itemName,
        packSize: Math.max(1, alert.packSize),
        orderQuantity: finalOrderQty,
        orderUnitLabel: alert.orderUnitLabel,
      };
    });
  }, [alerts, customOrderQty]);

  const handleAdjustOrderQty = useCallback(
    (itemId: string, baseQty: number, delta: number) => {
      setCustomOrderQty((prev) => {
        const current = typeof prev[itemId] === 'number' ? prev[itemId] : baseQty;
        const next = Math.max(1, Math.min(100_000, current + delta));
        return { ...prev, [itemId]: next };
      });
    },
    []
  );

  const handleInputOrderQty = useCallback((itemId: string, raw: string) => {
    const digits = raw.replace(/[^\d]/g, '');
    if (!digits) {
      setCustomOrderQty((prev) => ({ ...prev, [itemId]: 1 }));
      return;
    }
    const parsed = Number.parseInt(digits, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      setCustomOrderQty((prev) => ({
        ...prev,
        [itemId]: Math.min(100_000, parsed),
      }));
    }
  }, []);

  const flashCopiedImage = useCallback(() => {
    setCopiedImage(true);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      setCopiedImage(false);
      copiedTimerRef.current = null;
    }, 3000);
  }, []);

  const handleCopyTableImage = useCallback(async () => {
    if (effectiveRows.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const result = await copyReorderTableImageToClipboard({
        rows: effectiveRows,
      });
      if (result.status === 'copied') {
        flashCopiedImage();
      } else {
        onFallbackImage?.(
          result.dataUrl,
          'Bang-San-Pham-Can-Dat.png',
          'Bảng sản phẩm cần đặt'
        );
      }
    } finally {
      setIsExporting(false);
    }
  }, [effectiveRows, isExporting, flashCopiedImage, onFallbackImage]);

  const handleDownloadTablePNG = useCallback(async () => {
    if (effectiveRows.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      await exportReorderTablePNG({
        rows: effectiveRows,
      });
    } finally {
      setIsExporting(false);
    }
  }, [effectiveRows, isExporting]);

  const handleRestockAllItems = useCallback(() => {
    effectiveRows.forEach((row) => {
      onRestockItem(row.itemId, row.orderQuantity * row.packSize);
    });
    setCustomOrderQty({});
    setConfirmRestockAll(false);
  }, [effectiveRows, onRestockItem]);

  if (compact) {
    return (
      <div className="num-clean">
        <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs sm:text-sm font-extrabold text-slate-900">
            Bảng sản phẩm cần đặt
            {effectiveRows.length > 0 ? ` (${effectiveRows.length})` : ''}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {effectiveRows.length > 0 && (
              <button
                type="button"
                disabled={isExporting}
                onClick={() => void handleCopyTableImage()}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 ${
                  copiedImage
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[#4887EE] text-white hover:bg-[#3674DC]'
                }`}
              >
                {copiedImage ? (
                  <>
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span>Đã chép ảnh bảng</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 shrink-0" />
                    <span>Sao chép ảnh bảng</span>
                  </>
                )}
              </button>
            )}

            {onOpenFullOrderTable && (
              <button
                type="button"
                onClick={onOpenFullOrderTable}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Mở bảng lớn</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </button>
            )}
          </div>
        </div>

        {effectiveRows.length > 0 ? (
          <div className="p-3 max-h-[380px] overflow-y-auto">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-slate-300 text-xs sm:text-sm">
                <thead>
                  <tr className="bg-[#4887EE] text-white">
                    <th className="py-2 px-3 text-left font-bold border border-white/40">
                      SẢN PHẨM ĐẶT
                    </th>
                    <th className="py-2 px-3 text-center font-bold border border-white/40 whitespace-nowrap w-36">
                      SỐ LƯỢNG ĐẶT
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveRows.map((row, idx) => (
                    <tr
                      key={row.itemId}
                      className={idx % 2 === 1 ? 'bg-slate-50/80' : 'bg-white'}
                    >
                      <td className="py-2.5 px-3 font-bold text-slate-900 border border-slate-300">
                        {row.itemName}
                      </td>
                      <td className="py-2.5 px-3 text-center font-extrabold text-[#3674DC] border border-slate-300 whitespace-nowrap">
                        {formatNumberVN(row.orderQuantity)} {row.orderUnitLabel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="p-4 text-xs text-slate-600 leading-relaxed">
            Hiện không có sản phẩm nào cần đặt thêm. Bảng này chỉ hiển thị những vật tư chạm mức tối thiểu hoặc đã hết.
          </div>
        )}
      </div>
    );
  }

  // Full Sheet Mode (in Kho hàng -> Bảng sản phẩm cần đặt)
  if (effectiveRows.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3 num-clean">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-emerald-50 text-emerald-600 mx-auto">
          <Check className="w-5 h-5" />
        </div>
        <div className="text-base font-extrabold text-slate-900">
          Hiện chưa có sản phẩm nào cần đặt thêm
        </div>
        <p className="text-xs sm:text-sm text-slate-600 max-w-lg mx-auto leading-relaxed">
          Bảng đặt hàng kho chỉ hiển thị những mặt hàng đã hết hoặc chạm ngưỡng báo động. Tất cả vật tư hiện đang đủ tồn kho.
        </p>
        {onSwitchToStockTab && (
          <div className="pt-1">
            <button
              type="button"
              onClick={onSwitchToStockTab}
              className="h-9 inline-flex items-center gap-1.5 px-4 text-xs sm:text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Xem bảng Quản lý tồn kho</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <section
      aria-label="Bảng sản phẩm cần đặt"
      className="bg-white border border-slate-300 rounded-xl overflow-hidden max-w-3xl num-clean"
    >
      {/* Top Action Bar */}
      <div className="px-4 sm:px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
          <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
            Bảng sản phẩm cần đặt
          </h2>
          <span className="text-xs text-slate-500">
            · {formatNumberVN(effectiveRows.length)} món cần đặt
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {confirmRestockAll ? (
            <div className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1">
              <span className="text-xs font-semibold text-slate-800 whitespace-nowrap">
                Xác nhận đã nhập kho {effectiveRows.length} món?
              </span>
              <button
                type="button"
                onClick={handleRestockAllItems}
                className="px-2.5 py-1 text-xs font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded cursor-pointer whitespace-nowrap shrink-0"
              >
                Đồng ý
              </button>
              <button
                type="button"
                onClick={() => setConfirmRestockAll(false)}
                className="px-2 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap shrink-0"
              >
                Hủy
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRestockAll(true)}
              className="h-8 inline-flex items-center gap-1.5 px-3 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <PackagePlus className="w-3.5 h-3.5 text-[#3674DC] shrink-0" />
              <span>Đã nhập kho ({effectiveRows.length})</span>
            </button>
          )}

          <button
            type="button"
            disabled={isExporting}
            onClick={() => void handleDownloadTablePNG()}
            className="h-8 inline-flex items-center gap-1.5 px-3 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>Tải ảnh bảng</span>
          </button>

          <button
            type="button"
            disabled={isExporting}
            onClick={() => void handleCopyTableImage()}
            className={`h-8 inline-flex items-center gap-1.5 px-3.5 text-xs font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 ${
              copiedImage
                ? 'bg-emerald-600 text-white'
                : 'bg-[#4887EE] text-white hover:bg-[#3674DC]'
            }`}
          >
            {copiedImage ? (
              <>
                <Check className="w-3.5 h-3.5 shrink-0" />
                <span>Đã sao chép ảnh bảng</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 shrink-0" />
                <span>Sao chép ảnh bảng đặt hàng</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Ruled Order Sheet Body — No Logo, Strictly 2 Columns (SẢN PHẨM ĐẶT | SỐ LƯỢNG ĐẶT) */}
      <div className="h-1 bg-[#4887EE]" />
      <div className="p-4 sm:p-6 space-y-4">
        <h3 className="text-center text-base sm:text-xl font-extrabold tracking-tight text-slate-900">
          BẢNG SẢN PHẨM CẦN ĐẶT
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-slate-400 text-sm">
            <thead>
              <tr className="bg-[#4887EE] text-white">
                <th className="py-2.5 px-4 text-left text-xs sm:text-sm font-bold border border-white/40">
                  SẢN PHẨM ĐẶT
                </th>
                <th className="w-52 py-2.5 px-4 text-center text-xs sm:text-sm font-bold border border-white/40 whitespace-nowrap">
                  SỐ LƯỢNG ĐẶT
                </th>
              </tr>
            </thead>

            <tbody>
              {effectiveRows.map((row, idx) => (
                <tr
                  key={row.itemId}
                  className={`${
                    idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'
                  } hover:bg-blue-50/35 transition-colors`}
                >
                  <td className="py-3 px-4 font-bold text-slate-900 border border-slate-300">
                    {row.itemName}
                  </td>

                  <td className="py-2.5 px-4 text-center border border-slate-300 whitespace-nowrap">
                    <div className="inline-flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          handleAdjustOrderQty(
                            row.itemId,
                            row.orderQuantity,
                            -1
                          )
                        }
                        aria-label={`Giảm số lượng đặt ${row.itemName}`}
                        className="w-7 h-7 inline-flex items-center justify-center rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 cursor-pointer shrink-0"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>

                      <input
                        type="text"
                        inputMode="numeric"
                        value={String(row.orderQuantity)}
                        onChange={(e) =>
                          handleInputOrderQty(row.itemId, e.target.value)
                        }
                        aria-label={`Số lượng cần đặt ${row.itemName}`}
                        className="w-12 h-7 text-center text-sm font-extrabold text-[#3674DC] bg-white border border-slate-300 rounded focus:outline-none focus:border-[#4887EE]"
                      />

                      <button
                        type="button"
                        onClick={() =>
                          handleAdjustOrderQty(row.itemId, row.orderQuantity, 1)
                        }
                        aria-label={`Tăng số lượng đặt ${row.itemName}`}
                        className="w-7 h-7 inline-flex items-center justify-center rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 cursor-pointer shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>

                      <span className="text-xs sm:text-sm font-extrabold text-[#3674DC] ml-0.5">
                        {row.orderUnitLabel}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
});

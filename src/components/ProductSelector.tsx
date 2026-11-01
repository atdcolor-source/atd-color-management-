import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import {
  CAT_FORMEX,
  CAT_MENU_DESIGN,
  CAT_PLASTIC,
  LEGACY_CAT_MENU_DESIGN,
} from '../data/initialData';
import { Product, QuoteItem } from '../types';
import { formatVND } from '../utils/formatters';
import { MoneyInput, QuantityInput } from './MoneyInput';

interface ProductSelectorProps {
  products: Product[];
  quoteItems: QuoteItem[];
  onAppendProduct: (product: Product, itemId: string) => void;
  onUpdatePickedItemQuantity: (itemId: string, quantity: number) => void;
  onAddCustomItem: (
    name: string,
    unit: string,
    quantity: number,
    unitPrice: number
  ) => void;
}

type DesignTypeOption = 'Menu' | 'Poster';

const DESIGN_SIZE_PRESETS: Record<DesignTypeOption, string[]> = {
  Menu: ['Khổ A3', 'Khổ A4', 'Khổ A5', 'Menu gấp 2', 'Menu gấp 3'],
  Poster: ['Khổ A3', 'Khổ A4', 'Khổ A2', 'Khổ A1', 'Poster 60x80cm'],
};

const OTHER_PRODUCT_PRESETS = ['Phụ phí thiết kế', 'Phụ phí chỉnh sửa'];

function areQuoteItemsSelectorEqual(a: QuoteItem[], b: QuoteItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].productId !== b[i].productId ||
      a[i].quantity !== b[i].quantity
    ) {
      return false;
    }
  }
  return true;
}

export const ProductSelector = memo(
  function ProductSelector({
    products,
    quoteItems,
    onAppendProduct,
    onUpdatePickedItemQuantity,
    onAddCustomItem,
  }: ProductSelectorProps) {
    const selectorRootRef = useRef<HTMLDivElement>(null);

    // Active temporary picking session for a newly appended row (never merges into finished rows)
    const [activePicking, setActivePicking] = useState<{
      productId: string;
      itemId: string;
    } | null>(null);
    const autoReturnTimerRef = useRef<number | null>(null);

    // 3. THIẾT KẾ (Menu & Poster)
    const [designType, setDesignType] = useState<DesignTypeOption>('Menu');
    const [selectedDesignPreset, setSelectedDesignPreset] =
      useState<string>('Khổ A4');
    const [isCustomDesignSize, setIsCustomDesignSize] =
      useState<boolean>(false);
    const [customDesignSizeText, setCustomDesignSizeText] =
      useState<string>('');
    const [designPrice, setDesignPrice] = useState<number>(0);
    const [designQty, setDesignQty] = useState<number>(1);
    const [designJustAdded, setDesignJustAdded] = useState<string | null>(null);
    const designAddedTimerRef = useRef<number | null>(null);
    const designPriceInputRef = useRef<HTMLInputElement>(null);

    // 4. SẢN PHẨM KHÁC (Phụ phí thiết kế, Phụ phí chỉnh sửa, Giá tự điền)
    const [selectedOtherPreset, setSelectedOtherPreset] =
      useState<string>('Phụ phí thiết kế');
    const [isCustomOtherItem, setIsCustomOtherItem] = useState<boolean>(false);
    const [customOtherItemText, setCustomOtherItemText] = useState<string>('');
    const [otherItemPrice, setOtherItemPrice] = useState<number>(0);
    const [otherItemQty, setOtherItemQty] = useState<number>(1);
    const [otherJustAdded, setOtherJustAdded] = useState<string | null>(null);
    const otherAddedTimerRef = useRef<number | null>(null);
    const otherPriceInputRef = useRef<HTMLInputElement>(null);

    // Extra custom item form
    const [showCustomPrintForm, setShowCustomPrintForm] = useState(false);
    const [customPrintType, setCustomPrintType] =
      useState('Ép Nhựa - Plastic');
    const [customPrintSize, setCustomPrintSize] = useState('');
    const [customPrintQty, setCustomPrintQty] = useState(1);
    const [customPrintPrice, setCustomPrintPrice] = useState(0);

    const clearAutoReturnTimer = useCallback(() => {
      if (autoReturnTimerRef.current !== null) {
        window.clearTimeout(autoReturnTimerRef.current);
        autoReturnTimerRef.current = null;
      }
    }, []);

    const scheduleAutoReturn = useCallback(
      (productId: string, itemId: string) => {
        clearAutoReturnTimer();
        autoReturnTimerRef.current = window.setTimeout(() => {
          const activeEl = document.activeElement;
          const rowEl = selectorRootRef.current?.querySelector(
            `[data-picking-row="${CSS.escape(productId)}"]`
          );
          if (
            rowEl &&
            activeEl &&
            rowEl.contains(activeEl) &&
            activeEl.tagName === 'INPUT'
          ) {
            scheduleAutoReturn(productId, itemId);
            return;
          }
          setActivePicking((curr) =>
            curr && curr.itemId === itemId ? null : curr
          );
          autoReturnTimerRef.current = null;
        }, 3200);
      },
      [clearAutoReturnTimer]
    );

    useEffect(() => {
      return () => {
        clearAutoReturnTimer();
        if (designAddedTimerRef.current !== null) {
          window.clearTimeout(designAddedTimerRef.current);
        }
        if (otherAddedTimerRef.current !== null) {
          window.clearTimeout(otherAddedTimerRef.current);
        }
      };
    }, [clearAutoReturnTimer]);

    useEffect(() => {
      if (!activePicking) return;
      const handlePointerDownOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        const insideActiveRow = target.closest(
          `[data-picking-row="${CSS.escape(activePicking.productId)}"]`
        );
        if (!insideActiveRow) {
          clearAutoReturnTimer();
          setActivePicking(null);
        }
      };
      document.addEventListener('mousedown', handlePointerDownOutside);
      return () => {
        document.removeEventListener('mousedown', handlePointerDownOutside);
      };
    }, [activePicking, clearAutoReturnTimer]);

    const statsByProductId = useMemo(() => {
      const map = new Map<string, { totalQty: number; rowCount: number }>();
      quoteItems.forEach((item) => {
        if (item.productId) {
          const prev = map.get(item.productId) || { totalQty: 0, rowCount: 0 };
          map.set(item.productId, {
            totalQty: prev.totalQty + item.quantity,
            rowCount: prev.rowCount + 1,
          });
        }
      });
      return map;
    }, [quoteItems]);

    const grouped = useMemo(() => {
      const plastic1M = products.filter(
        (p) => p.category === CAT_PLASTIC && p.sides === '1 MẶT'
      );
      const plastic2M = products.filter(
        (p) => p.category === CAT_PLASTIC && p.sides === '2 MẶT'
      );
      const formex1M = products.filter(
        (p) => p.category === CAT_FORMEX && p.sides === '1 MẶT'
      );
      const formex2M = products.filter(
        (p) => p.category === CAT_FORMEX && p.sides === '2 MẶT'
      );
      const extraItems = products.filter(
        (p) =>
          p.category !== CAT_PLASTIC &&
          p.category !== CAT_FORMEX &&
          p.category !== CAT_MENU_DESIGN &&
          p.category !== LEGACY_CAT_MENU_DESIGN
      );
      return { plastic1M, plastic2M, formex1M, formex2M, extraItems };
    }, [products]);

    const currentDesignPresets = DESIGN_SIZE_PRESETS[designType];

    const effectiveDesignSize = isCustomDesignSize
      ? customDesignSizeText.trim()
      : selectedDesignPreset;

    const handleSelectDesignType = (nextType: DesignTypeOption) => {
      setActivePicking(null);
      setDesignType(nextType);
      const allowedPresets = DESIGN_SIZE_PRESETS[nextType];
      if (!isCustomDesignSize && !allowedPresets.includes(selectedDesignPreset)) {
        setSelectedDesignPreset(allowedPresets[0]);
      }
    };

    const handleSelectDesignPreset = (preset: string) => {
      setActivePicking(null);
      setIsCustomDesignSize(false);
      setSelectedDesignPreset(preset);
      window.setTimeout(() => designPriceInputRef.current?.focus(), 20);
    };

    const handleAddDesignItem = (e: React.FormEvent) => {
      e.preventDefault();
      if (!effectiveDesignSize) return;
      const addedLabel = `Thiết kế ${designType} (${effectiveDesignSize})`;
      onAddCustomItem(
        addedLabel,
        'Mẫu',
        Math.max(1, designQty),
        Math.max(0, designPrice)
      );

      // Reset form completely back to default ready state so staff can pick more immediately
      setDesignType('Menu');
      setSelectedDesignPreset('Khổ A4');
      setIsCustomDesignSize(false);
      setCustomDesignSizeText('');
      setDesignQty(1);
      setDesignPrice(0);
      setActivePicking(null);

      setDesignJustAdded(`Đã thêm dòng mới: ${addedLabel}`);
      if (designAddedTimerRef.current !== null) {
        window.clearTimeout(designAddedTimerRef.current);
      }
      designAddedTimerRef.current = window.setTimeout(() => {
        setDesignJustAdded(null);
        designAddedTimerRef.current = null;
      }, 2800);
    };

    const effectiveOtherItemName = isCustomOtherItem
      ? customOtherItemText.trim()
      : selectedOtherPreset;

    const handleSelectOtherPreset = (preset: string) => {
      setActivePicking(null);
      setIsCustomOtherItem(false);
      setSelectedOtherPreset(preset);
      window.setTimeout(() => otherPriceInputRef.current?.focus(), 20);
    };

    const handleAddOtherItem = (e: React.FormEvent) => {
      e.preventDefault();
      if (!effectiveOtherItemName) return;
      const addedLabel = effectiveOtherItemName;
      onAddCustomItem(
        addedLabel,
        'Mục',
        Math.max(1, otherItemQty),
        Math.max(0, otherItemPrice)
      );

      // Reset form completely back to default ready state so staff can pick more immediately
      setSelectedOtherPreset('Phụ phí thiết kế');
      setIsCustomOtherItem(false);
      setCustomOtherItemText('');
      setOtherItemQty(1);
      setOtherItemPrice(0);
      setActivePicking(null);

      setOtherJustAdded(`Đã thêm dòng mới: ${addedLabel}`);
      if (otherAddedTimerRef.current !== null) {
        window.clearTimeout(otherAddedTimerRef.current);
      }
      otherAddedTimerRef.current = window.setTimeout(() => {
        setOtherJustAdded(null);
        otherAddedTimerRef.current = null;
      }, 2800);
    };

    const handleAddCustomPrint = (e: React.FormEvent) => {
      e.preventDefault();
      const sizeText = customPrintSize.trim();
      if (!sizeText) return;
      const itemName =
        customPrintType === 'Sản phẩm khác' || customPrintType === 'Mục khác'
          ? sizeText
          : `${customPrintType} (${sizeText})`;
      onAddCustomItem(
        itemName,
        'Cái',
        Math.max(1, customPrintQty),
        Math.max(0, customPrintPrice)
      );
      setCustomPrintType('Ép Nhựa - Plastic');
      setCustomPrintSize('');
      setCustomPrintQty(1);
      setCustomPrintPrice(0);
      setShowCustomPrintForm(false);
    };

    const handlePickCatalogProduct = (product: Product) => {
      const newItemId = `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      onAppendProduct(product, newItemId);
      setActivePicking({ productId: product.id, itemId: newItemId });
      scheduleAutoReturn(product.id, newItemId);
    };

    const handleAdjustPickedQuantity = (
      productId: string,
      itemId: string,
      nextQty: number
    ) => {
      onUpdatePickedItemQuantity(itemId, nextQty);
      if (nextQty <= 0) {
        clearAutoReturnTimer();
        setActivePicking(null);
      } else {
        scheduleAutoReturn(productId, itemId);
      }
    };

    const handleFinishPickingRow = () => {
      clearAutoReturnTimer();
      setActivePicking(null);
    };

    const renderCompactProductRow = (product: Product) => {
      const stats = statsByProductId.get(product.id);
      const totalQty = stats?.totalQty || 0;
      const rowCount = stats?.rowCount || 0;

      const activePickedItem =
        activePicking && activePicking.productId === product.id
          ? quoteItems.find((it) => it.id === activePicking.itemId)
          : undefined;
      const isPicking = Boolean(
        activePickedItem && activePickedItem.quantity > 0
      );
      const pickingQty = activePickedItem?.quantity ?? 1;

      return (
        <div
          key={product.id}
          data-picking-row={product.id}
          data-tin-sound={!isPicking ? 'true' : undefined}
          onClick={() => {
            if (!isPicking) {
              handlePickCatalogProduct(product);
            }
          }}
          className={`flex items-center justify-between gap-2 px-3 py-2.5 transition-colors duration-150 ${
            isPicking
              ? 'bg-blue-50/80'
              : 'hover:bg-slate-50 cursor-pointer'
          }`}
        >
          <div className="min-w-0">
            <div className="text-sm sm:text-base font-bold text-slate-900 leading-tight">
              {product.size || product.name}
            </div>
            <div className="flex flex-wrap items-center gap-x-1.5 text-xs sm:text-sm num-clean mt-0.5">
              <span className="font-semibold text-blue-700">
                {formatVND(product.price)}
              </span>
              {totalQty > 0 && !isPicking && (
                <>
                  <span className="text-slate-400" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-xs font-semibold text-emerald-700 whitespace-nowrap">
                    {rowCount > 1
                      ? `${rowCount} dòng (${totalQty})`
                      : `Đã có: ${totalQty}`}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {isPicking && activePickedItem ? (
              <div className="inline-flex items-center gap-1">
                <div className="inline-flex items-center border border-blue-600 rounded-md bg-white overflow-hidden">
                  <button
                    type="button"
                    aria-label="Giảm"
                    onClick={() =>
                      handleAdjustPickedQuantity(
                        product.id,
                        activePickedItem.id,
                        pickingQty - 1
                      )
                    }
                    className="w-6 h-8 flex items-center justify-center text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <QuantityInput
                    value={pickingQty}
                    min={0}
                    onChange={(nextQty) =>
                      handleAdjustPickedQuantity(
                        product.id,
                        activePickedItem.id,
                        nextQty
                      )
                    }
                    ariaLabel={`Số lượng ${product.name}`}
                    className="w-9 h-8 text-xs sm:text-sm"
                  />
                  <button
                    type="button"
                    aria-label="Tăng"
                    onClick={() =>
                      handleAdjustPickedQuantity(
                        product.id,
                        activePickedItem.id,
                        pickingQty + 1
                      )
                    }
                    className="w-6 h-8 flex items-center justify-center text-blue-700 hover:bg-blue-50 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleFinishPickingRow}
                  title="Hoàn tất mục này — lần chọn sau sẽ tự thêm dòng riêng ở dưới đơn hàng"
                  className="h-8 px-2 text-xs font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Xong
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handlePickCatalogProduct(product)}
                title={
                  totalQty > 0
                    ? 'Thêm dòng mới riêng ở cuối đơn hàng (không cộng dồn)'
                    : 'Chọn thêm vào đơn hàng'
                }
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-[#4887EE] hover:text-white rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {totalQty > 0 ? '+ Thêm dòng' : '+ Chọn'}
              </button>
            )}
          </div>
        </div>
      );
    };

    return (
      <div ref={selectorRootRef} className="space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          {/* 1. ÉP NHỰA - PLASTIC */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="px-3.5 py-2.5 bg-[#4887EE] text-white flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold tracking-tight">
                1. ÉP NHỰA - PLASTIC (Giấy 300)
              </h2>
              <span className="text-xs text-white/90 whitespace-nowrap shrink-0">
                ĐVT: Tờ
              </span>
            </div>

            <div className="flex-1 grid grid-cols-2 divide-x divide-slate-200">
              <div className="divide-y divide-slate-100">
                <div className="px-3 py-1.5 bg-slate-50 text-xs font-bold text-slate-700">
                  1 MẶT
                </div>
                {grouped.plastic1M.map((p) => renderCompactProductRow(p))}
              </div>

              <div className="divide-y divide-slate-100">
                <div className="px-3 py-1.5 bg-slate-50 text-xs font-bold text-slate-700">
                  2 MẶT
                </div>
                {grouped.plastic2M.map((p) => renderCompactProductRow(p))}
              </div>
            </div>
          </section>

          {/* 2. IN DECAL + FORMEX */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="px-3.5 py-2.5 bg-[#4887EE] text-white flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold tracking-tight">
                2. IN DECAL + FORMEX (5mm)
              </h2>
              <span className="text-xs text-white/90 whitespace-nowrap shrink-0">
                ĐVT: Bảng
              </span>
            </div>

            <div className="flex-1 grid grid-cols-2 divide-x divide-slate-200">
              <div className="divide-y divide-slate-100">
                <div className="px-3 py-1.5 bg-slate-50 text-xs font-bold text-slate-700">
                  1 MẶT
                </div>
                {grouped.formex1M.map((p) => renderCompactProductRow(p))}
              </div>

              <div className="divide-y divide-slate-100">
                <div className="px-3 py-1.5 bg-slate-50 text-xs font-bold text-slate-700">
                  2 MẶT
                </div>
                {grouped.formex2M.map((p) => renderCompactProductRow(p))}
              </div>
            </div>
          </section>

          {/* 3. THIẾT KẾ (CHỌN MENU HOẶC POSTER, GIÁ TỰ CHỈNH) */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="px-3.5 py-2.5 bg-[#4887EE] text-white flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold tracking-tight">3. THIẾT KẾ</h2>
              <span className="text-xs text-white/90 whitespace-nowrap shrink-0">
                Menu · Poster · Giá tự chỉnh
              </span>
            </div>

            <form
              onSubmit={handleAddDesignItem}
              className="flex-1 p-3.5 flex flex-col justify-between gap-3"
            >
              <div className="space-y-2.5">
                {/* Chọn loại thiết kế: Menu vs Poster */}
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-slate-700">
                    Chọn loại thiết kế:
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg">
                    {(['Menu', 'Poster'] as const).map((typeOpt) => {
                      const isActive = designType === typeOpt;
                      return (
                        <button
                          key={typeOpt}
                          type="button"
                          onClick={() => handleSelectDesignType(typeOpt)}
                          className={`h-8 px-3 text-xs sm:text-sm font-bold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                            isActive
                              ? 'bg-[#4887EE] text-white shadow-xs'
                              : 'text-slate-700 hover:text-slate-900 hover:bg-white/60'
                          }`}
                        >
                          {typeOpt === 'Menu' ? 'Menu' : 'Poster'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Chọn khổ thiết kế */}
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-slate-700">
                    Chọn khổ {designType}:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {currentDesignPresets.map((sz) => {
                      const active =
                        !isCustomDesignSize && selectedDesignPreset === sz;
                      return (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => handleSelectDesignPreset(sz)}
                          className={`px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            active
                              ? 'bg-[#4887EE] text-white border-[#4887EE]'
                              : 'bg-slate-50 text-slate-800 border-slate-200 hover:border-blue-300'
                          }`}
                        >
                          {sz}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setIsCustomDesignSize(true)}
                      className={`px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        isCustomDesignSize
                          ? 'bg-[#4887EE] text-white border-[#4887EE]'
                          : 'bg-slate-50 text-blue-700 border-blue-200 hover:border-blue-400'
                      }`}
                    >
                      + Tự chỉnh kích thước
                    </button>
                  </div>

                  {isCustomDesignSize && (
                    <input
                      type="text"
                      autoFocus
                      value={customDesignSizeText}
                      onChange={(e) => setCustomDesignSizeText(e.target.value)}
                      placeholder={
                        designType === 'Menu'
                          ? 'Nhập kích thước Menu tự chỉnh (VD: 20x30cm, A4 4 trang...)'
                          : 'Nhập kích thước Poster tự chỉnh (VD: 50x70cm, 80x120cm...)'
                      }
                      className="view-smooth-enter w-full h-9 px-3 text-sm bg-white border border-blue-400 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Số lượng
                    </label>
                    <QuantityInput
                      value={designQty}
                      min={1}
                      onChange={setDesignQty}
                      ariaLabel={`Số lượng thiết kế ${designType}`}
                      className="w-full h-9 px-2 text-sm border border-slate-300 rounded-lg bg-white focus:border-slate-900"
                    />
                  </div>
                  <div className="col-span-9">
                    <div className="flex items-center justify-between mb-1">
                      <label
                        htmlFor="design-custom-price"
                        className="text-[11px] font-semibold text-slate-600"
                      >
                        Giá thiết kế tự điền
                      </label>
                      {designPrice > 0 && designPrice < 1000000 && (
                        <button
                          type="button"
                          onClick={() => setDesignPrice(designPrice * 1000)}
                          className="px-1.5 py-0.5 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer whitespace-nowrap shrink-0"
                        >
                          .000 ({formatVND(designPrice * 1000)})
                        </button>
                      )}
                    </div>
                    <MoneyInput
                      id="design-custom-price"
                      inputRef={designPriceInputRef}
                      value={designPrice}
                      onChange={setDesignPrice}
                      placeholder="Gõ số tiền (VD: 100000)"
                      align="left"
                      textColorClass="text-blue-700"
                      className="w-full h-9 text-sm bg-white border border-slate-300 rounded-lg focus-within:border-slate-900"
                    />
                  </div>
                </div>

                {designJustAdded && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{designJustAdded}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!effectiveDesignSize}
                  className="w-full h-9 px-3 text-xs sm:text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  + Thêm Thiết kế {designType} ({effectiveDesignSize || 'Chọn khổ'})
                </button>
              </div>
            </form>
          </section>

          {/* 4. SẢN PHẨM KHÁC (PHỤ PHÍ THIẾT KẾ, PHỤ PHÍ CHỈNH SỬA, GIÁ TỰ ĐIỀN) */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="px-3.5 py-2.5 bg-[#4887EE] text-white flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold tracking-tight">
                4. SẢN PHẨM KHÁC
              </h2>
              <span className="text-xs text-white/90 whitespace-nowrap shrink-0">
                Giá tự điền
              </span>
            </div>

            <form
              onSubmit={handleAddOtherItem}
              className="flex-1 p-3.5 flex flex-col justify-between gap-3"
            >
              <div className="space-y-2.5">
                <div className="text-xs font-semibold text-slate-700">
                  Chọn nội dung:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {OTHER_PRODUCT_PRESETS.map((preset) => {
                    const active =
                      !isCustomOtherItem && selectedOtherPreset === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleSelectOtherPreset(preset)}
                        className={`px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          active
                            ? 'bg-[#4887EE] text-white border-[#4887EE]'
                            : 'bg-slate-50 text-slate-800 border-slate-200 hover:border-blue-300'
                        }`}
                      >
                        {preset}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setIsCustomOtherItem(true)}
                    className={`px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isCustomOtherItem
                        ? 'bg-[#4887EE] text-white border-[#4887EE]'
                        : 'bg-slate-50 text-blue-700 border-blue-200 hover:border-blue-400'
                    }`}
                  >
                    + Tự ghi nội dung
                  </button>
                </div>

                {isCustomOtherItem && (
                  <input
                    type="text"
                    autoFocus
                    value={customOtherItemText}
                    onChange={(e) => setCustomOtherItemText(e.target.value)}
                    placeholder="Nhập tên sản phẩm khác / phụ phí..."
                    className="view-smooth-enter w-full h-9 px-3 text-sm bg-white border border-blue-400 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Số lượng
                    </label>
                    <QuantityInput
                      value={otherItemQty}
                      min={1}
                      onChange={setOtherItemQty}
                      ariaLabel="Số lượng sản phẩm khác"
                      className="w-full h-9 px-2 text-sm border border-slate-300 rounded-lg bg-white focus:border-slate-900"
                    />
                  </div>
                  <div className="col-span-9">
                    <div className="flex items-center justify-between mb-1">
                      <label
                        htmlFor="other-product-custom-price"
                        className="text-[11px] font-semibold text-slate-600"
                      >
                        Giá tự điền
                      </label>
                      {otherItemPrice > 0 && otherItemPrice < 1000000 && (
                        <button
                          type="button"
                          onClick={() =>
                            setOtherItemPrice(otherItemPrice * 1000)
                          }
                          className="px-1.5 py-0.5 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer whitespace-nowrap shrink-0"
                        >
                          .000 ({formatVND(otherItemPrice * 1000)})
                        </button>
                      )}
                    </div>
                    <MoneyInput
                      id="other-product-custom-price"
                      inputRef={otherPriceInputRef}
                      value={otherItemPrice}
                      onChange={setOtherItemPrice}
                      placeholder="Gõ số tiền (VD: 50000)"
                      align="left"
                      textColorClass="text-blue-700"
                      className="w-full h-9 text-sm bg-white border border-slate-300 rounded-lg focus-within:border-slate-900"
                    />
                  </div>
                </div>

                {otherJustAdded && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{otherJustAdded}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!effectiveOtherItemName}
                  className="w-full h-9 px-3 text-xs sm:text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors truncate cursor-pointer"
                >
                  + Thêm {effectiveOtherItemName || 'Sản phẩm khác'}
                </button>
              </div>
            </form>
          </section>
        </div>

        {grouped.extraItems.length > 0 && (
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-3.5 py-2 bg-[#4887EE] text-white text-xs sm:text-sm font-bold">
              Sản phẩm thêm từ bảng giá
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
              {grouped.extraItems.map((p) => renderCompactProductRow(p))}
            </div>
          </section>
        )}

        <div>
          {!showCustomPrintForm ? (
            <button
              type="button"
              onClick={() => setShowCustomPrintForm(true)}
              className="text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 underline underline-offset-4 cursor-pointer whitespace-nowrap shrink-0"
            >
              + Thêm kích thước in tự chỉnh / sản phẩm khác ngoài bảng trên
            </button>
          ) : (
            <form
              onSubmit={handleAddCustomPrint}
              className="view-smooth-enter bg-white border border-slate-200 rounded-xl p-3.5 sm:px-4 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs sm:text-sm font-bold text-slate-900">
                  Thêm kích thước tự chỉnh vào hóa đơn
                </span>
                <button
                  type="button"
                  onClick={() => setShowCustomPrintForm(false)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Đóng
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                <select
                  value={customPrintType}
                  onChange={(e) => setCustomPrintType(e.target.value)}
                  className="sm:col-span-3 h-9 px-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                >
                  <option value="Ép Nhựa - Plastic">Ép Nhựa - Plastic</option>
                  <option value="In Decal + Formex 5mm">
                    In Decal + Formex 5mm
                  </option>
                  <option value="Thiết kế Menu">Thiết kế Menu</option>
                  <option value="Thiết kế Poster">Thiết kế Poster</option>
                  <option value="Phụ phí thiết kế">Phụ phí thiết kế</option>
                  <option value="Phụ phí chỉnh sửa">Phụ phí chỉnh sửa</option>
                  <option value="Sản phẩm khác">
                    Sản phẩm khác (tự nhập tên)
                  </option>
                </select>

                <input
                  type="text"
                  required
                  value={customPrintSize}
                  onChange={(e) => setCustomPrintSize(e.target.value)}
                  placeholder="Kích thước tự chỉnh / nội dung (VD: 40x60cm - 1 Mặt)"
                  className="sm:col-span-4 h-9 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                />

                <QuantityInput
                  value={customPrintQty}
                  min={1}
                  onChange={setCustomPrintQty}
                  ariaLabel="Số lượng"
                  className="sm:col-span-1 h-9 px-2 text-sm border border-slate-300 rounded-lg bg-white focus:border-slate-900"
                />

                <MoneyInput
                  value={customPrintPrice}
                  onChange={setCustomPrintPrice}
                  placeholder="Đơn giá"
                  align="right"
                  className="sm:col-span-2 h-9 text-sm bg-white border border-slate-300 rounded-lg focus-within:border-slate-900"
                />

                <button
                  type="submit"
                  className="sm:col-span-2 h-9 px-3 text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  + Thêm vào đơn
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.products === next.products &&
    prev.onAppendProduct === next.onAppendProduct &&
    prev.onUpdatePickedItemQuantity === next.onUpdatePickedItemQuantity &&
    prev.onAddCustomItem === next.onAddCustomItem &&
    areQuoteItemsSelectorEqual(prev.quoteItems, next.quoteItems)
);

import React, { useMemo, useState } from 'react';
import {
  ClipboardList,
  MinusCircle,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { OTHER_MATERIAL_PACK_PREFIX } from '../data/initialData';
import {
  getCleanPackLabel,
  isOtherMaterialItem,
  isTapeMaterialName,
} from '../services/inventoryStorage';
import { InventoryAlert, InventoryItem } from '../types';
import { formatNumberVN } from '../utils/formatters';
import { ReorderProductsTable } from './ReorderProductsTable';

export type InventorySubTab = 'stock' | 'reorder';

interface InventoryViewProps {
  items: InventoryItem[];
  alerts: InventoryAlert[];
  activeSubTab: InventorySubTab;
  onSelectSubTab: (sub: InventorySubTab) => void;
  onFallbackImage: (
    dataUrl: string,
    downloadName: string,
    altText: string
  ) => void;
  onDeductUsage: (itemId: string, usedQty: number) => void;
  onAddStock: (itemId: string, addQty: number) => void;
  onSaveItem: (item: InventoryItem) => void;
  onAddNewItem: (draft: {
    name: string;
    unit: string;
    quantity: number;
    minThreshold: number;
    packSize: number;
    packLabel: string;
  }) => void;
  onDeleteItem: (itemId: string) => void;
  onResetDefaultInventory: () => void;
}

type StockFilter = 'all' | 'low' | 'ok';

interface EditDraft {
  name: string;
  unit: string;
  quantity: string;
  minThreshold: string;
  packSize: string;
  packLabel: string;
  isOtherGroup: boolean;
}

function parseNonNegativeInt(raw: string, fallback = 0): number {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return fallback;
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(1_000_000, parsed);
}

export function InventoryView({
  items,
  alerts,
  activeSubTab,
  onSelectSubTab,
  onFallbackImage,
  onDeductUsage,
  onAddStock,
  onSaveItem,
  onAddNewItem,
  onDeleteItem,
  onResetDefaultInventory,
}: InventoryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [usageInputs, setUsageInputs] = useState<Record<string, string>>({});
  const [quickStockEditId, setQuickStockEditId] = useState<string | null>(null);
  const [quickStockValue, setQuickStockValue] = useState<string>('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('Tờ');
  const [newQuantity, setNewQuantity] = useState('50');
  const [newMinThreshold, setNewMinThreshold] = useState('10');
  const [newPackSize, setNewPackSize] = useState('50');
  const [newPackLabel, setNewPackLabel] = useState('50 tờ cho 1 xấp');
  const [newIsOtherGroup, setNewIsOtherGroup] = useState(false);

  const [feedbackBanner, setFeedbackBanner] = useState<{
    tone: 'success' | 'warning';
    text: string;
  } | null>(null);

  const showFeedback = (tone: 'success' | 'warning', text: string) => {
    setFeedbackBanner({ tone, text });
  };

  const outOfStockCount = useMemo(
    () => items.filter((item) => item.quantity <= 0).length,
    [items]
  );
  const healthyCount = useMemo(
    () => items.filter((item) => item.quantity > item.minThreshold).length,
    [items]
  );

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const isLow = item.quantity <= item.minThreshold;
      if (stockFilter === 'low' && !isLow) return false;
      if (stockFilter === 'ok' && isLow) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.unit.toLowerCase().includes(q) ||
        item.packLabel.toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery, stockFilter]);

  const primaryFilteredItems = useMemo(
    () => filteredItems.filter((item) => !isOtherMaterialItem(item)),
    [filteredItems]
  );

  const otherFilteredItems = useMemo(
    () => filteredItems.filter((item) => isOtherMaterialItem(item)),
    [filteredItems]
  );

  const startEditingItem = (item: InventoryItem) => {
    setEditingItemId(item.id);
    setConfirmDeleteId(null);
    setEditDraft({
      name: item.name,
      unit: item.unit,
      quantity: String(item.quantity),
      minThreshold: String(item.minThreshold),
      packSize: String(item.packSize),
      packLabel: getCleanPackLabel(item.packLabel),
      isOtherGroup: isOtherMaterialItem(item),
    });
  };

  const handleApplyUsage = (item: InventoryItem) => {
    const rawVal = usageInputs[item.id] || '';
    const usedQty = parseNonNegativeInt(rawVal, 0);
    if (usedQty <= 0) {
      showFeedback(
        'warning',
        `Vui lòng nhập số lượng đã sử dụng lớn hơn 0 cho "${item.name}".`
      );
      return;
    }

    const nextQty = Math.max(0, item.quantity - usedQty);
    onDeductUsage(item.id, usedQty);
    setUsageInputs((prev) => ({ ...prev, [item.id]: '' }));

    const safePack = Math.max(1, item.packSize);
    const targetStock =
      item.minThreshold >= safePack
        ? Math.ceil((item.minThreshold + 1) / safePack) * safePack
        : safePack;
    const missingQty = Math.max(1, targetStock - nextQty);
    const orderPacks = Math.max(1, Math.ceil(missingQty / safePack));
    const isTape = isTapeMaterialName(item.name);
    const unitLower = isTape ? 'cây' : item.unit.toLowerCase();
    const orderUnit = isTape ? 'cây' : safePack > 1 ? 'xấp' : unitLower;

    if (nextQty <= 0) {
      showFeedback(
        'warning',
        `Đã trừ ${formatNumberVN(usedQty)} ${unitLower} "${item.name}" · Kho đã hết (thiếu ${formatNumberVN(missingQty)} ${unitLower}) → Đã báo Hộp tin cần đặt ${formatNumberVN(orderPacks)} ${orderUnit}!`
      );
    } else if (nextQty <= item.minThreshold) {
      showFeedback(
        'warning',
        `Đã trừ ${formatNumberVN(usedQty)} ${unitLower} "${item.name}" · Còn ${formatNumberVN(nextQty)} ${unitLower} (thiếu ${formatNumberVN(missingQty)} ${unitLower}) → Đã báo Hộp tin cần đặt ${formatNumberVN(orderPacks)} ${orderUnit}!`
      );
    } else {
      showFeedback(
        'success',
        `Đã trừ ${formatNumberVN(usedQty)} ${unitLower} sử dụng · "${item.name}" còn ${formatNumberVN(nextQty)} ${unitLower} trong kho.`
      );
    }
  };

  const handleQuickRestock = (item: InventoryItem, addQty: number) => {
    if (addQty <= 0) return;
    const nextQty = Math.min(1_000_000, item.quantity + addQty);
    onAddStock(item.id, addQty);
    showFeedback(
      'success',
      `Đã nhập thêm +${formatNumberVN(addQty)} ${item.unit.toLowerCase()} cho "${item.name}" · Tồn kho mới: ${formatNumberVN(nextQty)} ${item.unit.toLowerCase()}.`
    );
  };

  const handleSaveQuickStock = (item: InventoryItem) => {
    const nextQty = parseNonNegativeInt(quickStockValue, item.quantity);
    onSaveItem({
      ...item,
      quantity: nextQty,
      updatedAt: new Date().toISOString(),
    });
    setQuickStockEditId(null);
    if (nextQty <= item.minThreshold) {
      showFeedback(
        'warning',
        `Đã cập nhật tồn kho "${item.name}" = ${formatNumberVN(nextQty)} ${item.unit.toLowerCase()} · Đang ở mức báo Hộp tin (≤ ${formatNumberVN(item.minThreshold)} ${item.unit.toLowerCase()}).`
      );
    } else {
      showFeedback(
        'success',
        `Đã cập nhật số lượng tồn kho "${item.name}" = ${formatNumberVN(nextQty)} ${item.unit.toLowerCase()}.`
      );
    }
  };

  const handleSaveInlineEdit = (item: InventoryItem) => {
    if (!editDraft) return;
    const trimmedName = editDraft.name.trim();
    if (!trimmedName) return;

    const nextQuantity = parseNonNegativeInt(editDraft.quantity, item.quantity);
    const nextThreshold = parseNonNegativeInt(
      editDraft.minThreshold,
      item.minThreshold
    );
    const nextPackSize = Math.max(
      1,
      parseNonNegativeInt(editDraft.packSize, item.packSize)
    );
    const rawUnit = editDraft.unit.trim() || 'Tấm';
    const isTape = isTapeMaterialName(trimmedName);
    const nextUnit = isTape && /^cuộn$/iu.test(rawUnit) ? 'Cây' : rawUnit;
    const cleanPack = getCleanPackLabel(editDraft.packLabel);
    const normalizedPack = isTape
      ? cleanPack.replace(/(^|[\s\d])cuộn(?=$|\s|[.,;)])/giu, '$1cây')
      : cleanPack;
    const finalPackLabel = editDraft.isOtherGroup
      ? `${OTHER_MATERIAL_PACK_PREFIX}${normalizedPack || `1 ${nextUnit.toLowerCase()}`}`
      : normalizedPack;

    const updated: InventoryItem = {
      ...item,
      name: trimmedName,
      unit: nextUnit,
      quantity: nextQuantity,
      minThreshold: nextThreshold,
      packSize: nextPackSize,
      packLabel: finalPackLabel,
      updatedAt: new Date().toISOString(),
    };

    onSaveItem(updated);
    setEditingItemId(null);
    setEditDraft(null);
    showFeedback(
      nextQuantity <= nextThreshold ? 'warning' : 'success',
      `Đã lưu cài đặt "${updated.name}" · Tồn kho: ${formatNumberVN(updated.quantity)} ${updated.unit.toLowerCase()} · Báo Hộp tin khi ≤ ${formatNumberVN(updated.minThreshold)} ${updated.unit.toLowerCase()}.`
    );
  };

  const handleCreateItem = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newName.trim();
    if (!cleanName) return;

    const qty = parseNonNegativeInt(newQuantity, 0);
    const minT = parseNonNegativeInt(newMinThreshold, 5);
    const pSize = Math.max(1, parseNonNegativeInt(newPackSize, 1));
    const cleanUnit = newUnit.trim() || 'Tấm';
    const cleanPack = getCleanPackLabel(newPackLabel);
    const finalPackLabel = newIsOtherGroup
      ? `${OTHER_MATERIAL_PACK_PREFIX}${cleanPack || `1 ${cleanUnit.toLowerCase()}`}`
      : cleanPack;

    onAddNewItem({
      name: cleanName,
      unit: cleanUnit,
      quantity: qty,
      minThreshold: minT,
      packSize: pSize,
      packLabel: finalPackLabel,
    });

    setNewName('');
    setNewUnit('Tờ');
    setNewQuantity('50');
    setNewMinThreshold('10');
    setNewPackSize('50');
    setNewPackLabel('50 tờ cho 1 xấp');
    setNewIsOtherGroup(false);
    setShowAddForm(false);
    showFeedback(
      qty <= minT ? 'warning' : 'success',
      `Đã thêm vật tư "${cleanName}" vào Kho hàng.`
    );
  };

  const renderInventoryRow = (
    item: InventoryItem,
    rowNumber: number,
    isOtherSection: boolean
  ) => {
    const isOutOfStock = item.quantity <= 0;
    const isLowStock = item.quantity <= item.minThreshold;
    const isEditingThis = editingItemId === item.id && editDraft;
    const isQuickEditingStock = quickStockEditId === item.id;
    const cleanPack = getCleanPackLabel(item.packLabel);

    return (
      <React.Fragment key={item.id}>
        <tr
          className={`transition-colors ${
            isOutOfStock
              ? 'bg-rose-50/40 hover:bg-rose-50/70'
              : isLowStock
                ? 'bg-amber-50/35 hover:bg-amber-50/60'
                : 'hover:bg-slate-50/70'
          }`}
        >
          <td className="py-3.5 px-3 text-center font-bold text-slate-500">
            {rowNumber}
          </td>

          <td className="py-3.5 px-4">
            <div className="font-bold text-slate-900 text-sm sm:text-base">
              {isOtherSection ? `+ ${item.name}` : item.name}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5">
              <span>Đơn vị: {item.unit}</span>
              {cleanPack && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{cleanPack}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>
                Báo Hộp tin khi ≤ {formatNumberVN(item.minThreshold)}{' '}
                {item.unit.toLowerCase()}
              </span>
            </div>
          </td>

          <td className="py-3.5 px-4 text-right">
            {isQuickEditingStock ? (
              <div className="inline-flex items-center justify-end gap-1.5">
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={quickStockValue}
                  onChange={(e) => setQuickStockValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveQuickStock(item);
                    } else if (e.key === 'Escape') {
                      setQuickStockEditId(null);
                    }
                  }}
                  aria-label={`Chỉnh tồn kho ${item.name}`}
                  className="w-24 h-8 px-2 text-right text-sm font-bold bg-white border border-[#4887EE] rounded-md focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleSaveQuickStock(item)}
                  className="h-8 px-2.5 text-xs font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-md cursor-pointer whitespace-nowrap shrink-0"
                >
                  Lưu
                </button>
              </div>
            ) : (
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setQuickStockEditId(item.id);
                    setQuickStockValue(String(item.quantity));
                  }}
                  title="Bấm để sửa nhanh số lượng còn trong kho"
                  className="inline-flex items-baseline gap-1.5 cursor-pointer group"
                >
                  <span
                    className={`text-lg sm:text-xl font-extrabold ${
                      isOutOfStock
                        ? 'text-rose-700'
                        : isLowStock
                          ? 'text-amber-700'
                          : 'text-slate-900'
                    } group-hover:underline`}
                  >
                    {formatNumberVN(item.quantity)}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    {item.unit.toLowerCase()}
                  </span>
                </button>
                <div className="text-xs">
                  {isOutOfStock ? (
                    <span className="font-semibold text-rose-700">
                      Hết hàng · Đã báo Hộp tin
                    </span>
                  ) : isLowStock ? (
                    <span className="font-semibold text-amber-700">
                      Cần đặt thêm · Đã báo Hộp tin
                    </span>
                  ) : (
                    <span className="text-emerald-700 font-medium">
                      Đủ hàng (Bấm số để sửa nhanh)
                    </span>
                  )}
                </div>
              </div>
            )}
          </td>

          <td className="py-3.5 px-4">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                value={usageInputs[item.id] || ''}
                onChange={(e) =>
                  setUsageInputs((prev) => ({
                    ...prev,
                    [item.id]: e.target.value,
                  }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleApplyUsage(item);
                  }
                }}
                placeholder={`SL dùng (${item.unit.toLowerCase()})...`}
                aria-label={`Nhập số lượng sử dụng cho ${item.name}`}
                className="w-36 h-9 px-3 text-xs sm:text-sm font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
              />
              <button
                type="button"
                onClick={() => handleApplyUsage(item)}
                className="h-9 inline-flex items-center gap-1 px-3 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <MinusCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Trừ kho</span>
              </button>
            </div>
          </td>

          <td className="py-3.5 px-4 text-right">
            <div className="inline-flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => handleQuickRestock(item, item.packSize)}
                title={`Nhập thêm 1 lần đóng gói (+${item.packSize} ${item.unit.toLowerCase()}) vào kho`}
                className="h-9 inline-flex items-center gap-1 px-2.5 text-xs font-bold text-[#3674DC] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>
                  +{formatNumberVN(item.packSize)} {item.unit.toLowerCase()}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (isEditingThis) {
                    setEditingItemId(null);
                    setEditDraft(null);
                  } else {
                    startEditingItem(item);
                  }
                }}
                className={`h-9 inline-flex items-center gap-1 px-2.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isEditingThis
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Pencil className="w-3.5 h-3.5 shrink-0" />
                <span>Cài đặt</span>
              </button>
            </div>
          </td>
        </tr>

        {/* Inline Settings & Direct Stock Editor Row */}
        {isEditingThis && editDraft && (
          <tr className="bg-slate-50/90">
            <td colSpan={5} className="px-4 py-4">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs sm:text-sm font-bold text-slate-900">
                    Cài đặt tồn kho & mức cảnh báo Hộp tin:{' '}
                    <span className="text-[#3674DC]">{item.name}</span>
                  </div>

                  {confirmDeleteId === item.id ? (
                    <div className="inline-flex items-center gap-2">
                      <span className="text-xs font-semibold text-rose-700">
                        Xác nhận xóa vật tư này?
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onDeleteItem(item.id);
                          setEditingItemId(null);
                          setConfirmDeleteId(null);
                          showFeedback(
                            'success',
                            `Đã xóa "${item.name}" khỏi Kho hàng.`
                          );
                        }}
                        className="px-2.5 py-1 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Xóa ngay
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Hủy
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(item.id)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-800 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Xóa vật tư</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Tên vật tư
                    </label>
                    <input
                      type="text"
                      value={editDraft.name}
                      onChange={(e) =>
                        setEditDraft({
                          ...editDraft,
                          name: e.target.value,
                        })
                      }
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Số lượng còn trong kho
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editDraft.quantity}
                      onChange={(e) =>
                        setEditDraft({
                          ...editDraft,
                          quantity: e.target.value,
                        })
                      }
                      className="w-full h-9 px-3 text-sm font-bold bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Đơn vị
                    </label>
                    <input
                      type="text"
                      value={editDraft.unit}
                      onChange={(e) =>
                        setEditDraft({
                          ...editDraft,
                          unit: e.target.value,
                        })
                      }
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Báo Hộp tin khi còn ≤
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editDraft.minThreshold}
                      onChange={(e) =>
                        setEditDraft({
                          ...editDraft,
                          minThreshold: e.target.value,
                        })
                      }
                      className="w-full h-9 px-3 text-sm font-bold bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      SL 1 xấp / lần đặt
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editDraft.packSize}
                      onChange={(e) =>
                        setEditDraft({
                          ...editDraft,
                          packSize: e.target.value,
                        })
                      }
                      className="w-full h-9 px-3 text-sm font-bold bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                  </div>

                  <div className="sm:col-span-2 lg:col-span-3">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Ghi chú quy cách (VD: 50 tờ cho 1 xấp)
                    </label>
                    <input
                      type="text"
                      value={editDraft.packLabel}
                      onChange={(e) =>
                        setEditDraft({
                          ...editDraft,
                          packLabel: e.target.value,
                        })
                      }
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Nhóm hiển thị
                    </label>
                    <select
                      value={editDraft.isOtherGroup ? 'other' : 'main'}
                      onChange={(e) =>
                        setEditDraft({
                          ...editDraft,
                          isOtherGroup: e.target.value === 'other',
                        })
                      }
                      className="w-full h-9 px-2.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900 cursor-pointer"
                    >
                      <option value="main">Vật tư in ấn chính</option>
                      <option value="other">Vật Liệu Khác</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2 lg:col-span-2 flex items-end justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingItemId(null);
                        setEditDraft(null);
                      }}
                      className="h-9 px-3.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Đóng
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveInlineEdit(item)}
                      className="h-9 px-4 text-xs font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Lưu cài đặt
                    </button>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  return (
    <div className="space-y-5">
      {/* Page Header & Sub-Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            {activeSubTab === 'reorder'
              ? 'Bảng sản phẩm cần đặt'
              : 'Kho hàng vật tư & Bảng sản phẩm cần đặt'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-0.5 leading-relaxed">
            {activeSubTab === 'reorder'
              ? 'Chỉ hiển thị riêng các sản phẩm đang hết hoặc chạm mức báo để gửi đặt hàng nhà cung cấp (kẻ bảng rõ ràng & sao chép ảnh bảng).'
              : 'Quản lý tồn kho vật tư in ấn và Vật Liệu Khác. Khi vật tư chạm mức hết hàng, hệ thống tự lập Bảng sản phẩm cần đặt theo quy cách xấp/cuộn/cây.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {activeSubTab === 'stock' && (
            <>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm((prev) => !prev);
                  setConfirmReset(false);
                }}
                className="h-10 inline-flex items-center gap-1.5 px-4 text-xs sm:text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>Thêm vật tư mới</span>
              </button>

              {confirmReset ? (
                <div className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                  <span className="text-xs font-semibold text-amber-900 whitespace-nowrap">
                    Khôi phục 12 vật tư gốc?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onResetDefaultInventory();
                      setConfirmReset(false);
                      showFeedback(
                        'success',
                        'Đã khôi phục danh sách 12 vật tư mặc định trong kho.'
                      );
                    }}
                    className="px-2.5 py-1 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Đồng ý
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="px-2 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Hủy
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="h-10 inline-flex items-center gap-1.5 px-3.5 text-xs sm:text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-4 h-4 shrink-0" />
                  <span>Khôi phục mặc định</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Sub-Tab Segmented Switch: Quản lý tồn kho vs Bảng sản phẩm cần đặt */}
      <div className="inline-flex items-center gap-1 p-1 bg-slate-200/75 rounded-xl num-clean">
        <button
          type="button"
          onClick={() => onSelectSubTab('stock')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeSubTab === 'stock'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Package className="w-4 h-4 shrink-0 text-[#4887EE]" />
          <span>Quản lý tồn kho ({formatNumberVN(items.length)})</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectSubTab('reorder')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeSubTab === 'reorder'
              ? 'bg-white text-[#3674DC] shadow-xs'
              : alerts.length > 0
                ? 'text-amber-900 hover:text-slate-900'
                : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ClipboardList className="w-4 h-4 shrink-0 text-[#4887EE]" />
          <span>
            Bảng sản phẩm cần đặt ({formatNumberVN(alerts.length)})
          </span>
        </button>
      </div>

      {activeSubTab === 'reorder' ? (
        <>
          {feedbackBanner && (
            <div
              role="status"
              className={`px-4 py-3 rounded-xl border flex items-center justify-between gap-3 text-xs sm:text-sm font-medium num-clean ${
                feedbackBanner.tone === 'warning'
                  ? 'bg-amber-50 border-amber-200 text-amber-950'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-950'
              }`}
            >
              <span>{feedbackBanner.text}</span>
              <button
                type="button"
                onClick={() => setFeedbackBanner(null)}
                aria-label="Đóng thông báo"
                className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Dedicated View: ONLY displays the Products-to-Order Table */}
          <ReorderProductsTable
            alerts={alerts}
            onRestockItem={(itemId, addQty) => {
              const target = items.find((i) => i.id === itemId);
              if (target) {
                handleQuickRestock(target, addQty);
              } else {
                onAddStock(itemId, addQty);
              }
            }}
            onSwitchToStockTab={() => onSelectSubTab('stock')}
            onFallbackImage={onFallbackImage}
          />
        </>
      ) : (
        <>
          {/* 4-Metric Warehouse Overview Bar */}
          <div className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 num-clean">
            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">
                Tổng mặt hàng trong kho
              </div>
              <div className="text-2xl font-extrabold text-slate-900 mt-1">
                {formatNumberVN(items.length)}{' '}
                <span className="text-sm font-semibold text-slate-500">
                  vật tư
                </span>
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">
                Đang đủ tồn kho
              </div>
              <div className="text-2xl font-extrabold text-emerald-700 mt-1">
                {formatNumberVN(healthyCount)}{' '}
                <span className="text-sm font-semibold text-slate-500">
                  vật tư
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onSelectSubTab('reorder')}
              className="p-4 text-left hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <div className="text-xs font-medium text-slate-500">
                Sản phẩm cần đặt (Xem bảng riêng)
              </div>
              <div
                className={`text-2xl font-extrabold mt-1 ${
                  alerts.length > 0 ? 'text-amber-700' : 'text-slate-900'
                }`}
              >
                {formatNumberVN(alerts.length)}{' '}
                <span className="text-sm font-semibold text-slate-500">
                  vật tư
                </span>
              </div>
            </button>

            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">
                Đã hết sạch trong kho
              </div>
              <div
                className={`text-2xl font-extrabold mt-1 ${
                  outOfStockCount > 0 ? 'text-rose-700' : 'text-slate-900'
                }`}
              >
                {formatNumberVN(outOfStockCount)}{' '}
                <span className="text-sm font-semibold text-slate-500">
                  vật tư
                </span>
              </div>
            </div>
          </div>

      {/* Add New Material Form */}
      {showAddForm && (
        <form
          onSubmit={handleCreateItem}
          className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm sm:text-base font-bold text-slate-900">
              Thêm vật tư mới vào Kho hàng
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              aria-label="Đóng biểu mẫu thêm vật tư"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tên vật tư / sản phẩm trong kho
              </label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="VD: Màng BOBB mờ, Giấy in ảnh..."
                className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Đơn vị tính
              </label>
              <input
                type="text"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                placeholder="Tờ / Tấm / Cuộn / Cây"
                className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tồn kho hiện tại
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                className="w-full h-10 px-3 text-sm font-bold num-clean border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Báo Hộp tin khi ≤
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={newMinThreshold}
                onChange={(e) => setNewMinThreshold(e.target.value)}
                className="w-full h-10 px-3 text-sm font-bold num-clean border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                SL 1 xấp / lần đặt
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={newPackSize}
                onChange={(e) => setNewPackSize(e.target.value)}
                className="w-full h-10 px-3 text-sm font-bold num-clean border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Ghi chú quy cách đóng gói
              </label>
              <input
                type="text"
                value={newPackLabel}
                onChange={(e) => setNewPackLabel(e.target.value)}
                placeholder="VD: 50 tờ cho 1 xấp"
                className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nhóm hiển thị
              </label>
              <select
                value={newIsOtherGroup ? 'other' : 'main'}
                onChange={(e) => setNewIsOtherGroup(e.target.value === 'other')}
                className="w-full h-10 px-2.5 text-xs sm:text-sm font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900 cursor-pointer"
              >
                <option value="main">Vật tư in ấn chính</option>
                <option value="other">Vật Liệu Khác</option>
              </select>
            </div>

            <div className="sm:col-span-2 lg:col-span-2 flex items-end justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="h-10 px-4 text-xs sm:text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="h-10 px-4 text-xs sm:text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg cursor-pointer whitespace-nowrap shrink-0"
              >
                Lưu vật tư vào kho
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Quick Navigation Bar to Dedicated Reorder Table (when alerts > 0) */}
      {alerts.length > 0 && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 num-clean">
          <div className="text-xs sm:text-sm text-slate-800">
            <span className="font-bold text-amber-900">
              Đang có {formatNumberVN(alerts.length)} sản phẩm cần đặt thêm
            </span>{' '}
            <span className="text-slate-600">
              · Đã tổng hợp riêng trong Bảng sản phẩm cần đặt (chỉ hiển thị món cần đặt).
            </span>
          </div>
          <button
            type="button"
            onClick={() => onSelectSubTab('reorder')}
            className="h-9 inline-flex items-center gap-1.5 px-3.5 text-xs sm:text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ClipboardList className="w-4 h-4 shrink-0" />
            <span>Mở Bảng sản phẩm cần đặt ({formatNumberVN(alerts.length)})</span>
          </button>
        </div>
      )}

      {/* Action Feedback Banner */}
      {feedbackBanner && (
        <div
          role="status"
          className={`px-4 py-3 rounded-xl border flex items-center justify-between gap-3 text-xs sm:text-sm font-medium num-clean ${
            feedbackBanner.tone === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-950'
              : 'bg-emerald-50 border-emerald-200 text-emerald-950'
          }`}
        >
          <span>{feedbackBanner.text}</span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            aria-label="Đóng thông báo"
            className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm vật tư: Màng BOBB, giấy in ảnh, plastic 80Mic, decal 135g, formex, băng keo, chống sốc..."
            className="w-full h-10 pl-9 pr-8 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-slate-900"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Xóa tìm kiếm"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start sm:self-auto num-clean">
          <button
            type="button"
            onClick={() => setStockFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              stockFilter === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tất cả ({items.length})
          </button>
          <button
            type="button"
            onClick={() => setStockFilter('low')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              stockFilter === 'low'
                ? 'bg-white text-amber-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Cần đặt thêm ({alerts.length})
          </button>
          <button
            type="button"
            onClick={() => setStockFilter('ok')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              stockFilter === 'ok'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Đủ hàng ({healthyCount})
          </button>
        </div>
      </div>

      {/* Main Warehouse Inventory Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredItems.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <Package className="w-8 h-8 text-slate-300 mx-auto" />
            <div className="text-sm font-bold text-slate-800">
              Không tìm thấy vật tư phù hợp
            </div>
            <p className="text-xs text-slate-500">
              Thử đổi bộ lọc hoặc bấm &ldquo;Thêm vật tư mới&rdquo; để bổ sung vào kho.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[880px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
                  <th className="py-3 px-3 text-center w-12">STT</th>
                  <th className="py-3 px-4">VẬT TƯ TRONG KHO & QUY CÁCH</th>
                  <th className="py-3 px-4 text-right w-52">
                    SỐ LƯỢNG CÒN TRONG KHO
                  </th>
                  <th className="py-3 px-4 w-72">
                    NHẬP SL SỬ DỤNG (TRỪ LẠI TRONG KHO)
                  </th>
                  <th className="py-3 px-4 text-right w-56">
                    NHẬP THÊM / CÀI ĐẶT
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm num-clean">
                {primaryFilteredItems.map((item, idx) =>
                  renderInventoryRow(item, idx + 1, false)
                )}

                {otherFilteredItems.length > 0 && (
                  <>
                    <tr className="bg-slate-100/80 border-y border-slate-200">
                      <td
                        colSpan={5}
                        className="py-2.5 px-4 text-xs sm:text-sm font-extrabold text-slate-800 tracking-tight"
                      >
                        Vật Liệu Khác ({otherFilteredItems.length} mặt hàng)
                      </td>
                    </tr>
                    {otherFilteredItems.map((item, idx) =>
                      renderInventoryRow(
                        item,
                        primaryFilteredItems.length + idx + 1,
                        true
                      )
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

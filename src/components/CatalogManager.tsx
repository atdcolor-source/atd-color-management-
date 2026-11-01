import React, { useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  CAT_DESIGN_SURCHARGE,
  CAT_FORMEX,
  CAT_MENU_DESIGN,
  CAT_OTHER_PRODUCTS,
  CAT_PLASTIC,
  LEGACY_CAT_MENU_DESIGN,
} from '../data/initialData';
import { Product } from '../types';
import { MoneyInput } from './MoneyInput';

interface CatalogManagerProps {
  products: Product[];
  onAddProductToCatalog: (product: Omit<Product, 'id'>) => void;
  onUpdateCatalogProduct: (id: string, patch: Partial<Product>) => void;
  onDeleteCatalogProduct: (id: string) => void;
  onResetCatalog: () => void;
}

const CATEGORY_OPTIONS = [
  CAT_PLASTIC,
  CAT_FORMEX,
  CAT_MENU_DESIGN,
  CAT_OTHER_PRODUCTS,
];

export function CatalogManager({
  products,
  onAddProductToCatalog,
  onUpdateCatalogProduct,
  onDeleteCatalogProduct,
  onResetCatalog,
}: CatalogManagerProps) {
  const [category, setCategory] = useState(CAT_PLASTIC);
  const [sides, setSides] = useState('1 MẶT');
  const [size, setSize] = useState('');
  const [unit, setUnit] = useState('Tờ');
  const [price, setPrice] = useState<number>(0);
  const [confirmReset, setConfirmReset] = useState(false);

  const handleCategoryChange = (nextCat: string) => {
    setCategory(nextCat);
    if (nextCat === CAT_PLASTIC) {
      setSides('1 MẶT');
      setUnit('Tờ');
    } else if (nextCat === CAT_FORMEX) {
      setSides('1 MẶT');
      setUnit('Bảng');
    } else if (
      nextCat === CAT_MENU_DESIGN ||
      nextCat === LEGACY_CAT_MENU_DESIGN
    ) {
      setSides('THEO KÍCH THƯỚC');
      setUnit('Mẫu');
    } else if (
      nextCat === CAT_OTHER_PRODUCTS ||
      nextCat === CAT_DESIGN_SURCHARGE
    ) {
      setSides('');
      setUnit('Mục');
    } else {
      setSides('');
      setUnit('Cái');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!size.trim()) return;

    let fullName = size.trim();
    if (category === CAT_PLASTIC) {
      fullName = `Ép Nhựa - Plastic (${size.trim()} - ${sides === '2 MẶT' ? '2 Mặt' : '1 Mặt'})`;
    } else if (category === CAT_FORMEX) {
      fullName = `In Decal + Formex 5mm (${size.trim()} - ${sides === '2 MẶT' ? '2 Mặt' : '1 Mặt'})`;
    } else if (
      category === CAT_MENU_DESIGN ||
      category === LEGACY_CAT_MENU_DESIGN
    ) {
      fullName = `Thiết kế (${size.trim()})`;
    } else if (category === CAT_DESIGN_SURCHARGE) {
      fullName = size.trim().toLowerCase().startsWith('phụ phí')
        ? size.trim()
        : `Phụ phí thiết kế (${size.trim()})`;
    }

    onAddProductToCatalog({
      code: `SP-${Date.now().toString().slice(-4)}`,
      name: fullName,
      category,
      sides: sides || undefined,
      size: size.trim(),
      unit: unit.trim() || 'Cái',
      price: Math.max(0, price),
    });

    setSize('');
    setPrice(0);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Bảng giá sản phẩm in ấn
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Chỉnh sửa trực tiếp đơn giá hoặc thêm quy cách mới
          </p>
        </div>

        {!confirmReset ? (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-4 h-4 shrink-0" />
            <span>Khôi phục giá gốc</span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onResetCatalog();
                setConfirmReset(false);
              }}
              className="px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              Xác nhận khôi phục
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              Hủy
            </button>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3"
      >
        <div className="text-sm font-bold text-slate-900">
          Thêm kích thước / sản phẩm mới vào bảng giá
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-4">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Nhóm sản phẩm
            </label>
            <select
              value={category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {(category === CAT_PLASTIC || category === CAT_FORMEX) && (
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Số mặt
              </label>
              <select
                value={sides}
                onChange={(e) => setSides(e.target.value)}
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
              >
                <option value="1 MẶT">1 MẶT</option>
                <option value="2 MẶT">2 MẶT</option>
              </select>
            </div>
          )}

          <div
            className={
              category === CAT_PLASTIC || category === CAT_FORMEX
                ? 'sm:col-span-2'
                : 'sm:col-span-4'
            }
          >
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Kích thước / Tên
            </label>
            <input
              type="text"
              required
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="VD: A3, 20x30cm..."
              className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Đơn giá (VNĐ)
            </label>
            <MoneyInput
              value={price}
              onChange={setPrice}
              placeholder="VD: 80000"
              align="left"
              textColorClass="text-blue-700"
              className="w-full h-10 text-sm bg-white border border-slate-300 rounded-lg focus-within:border-slate-900"
            />
          </div>

          <div className="sm:col-span-2 flex items-end">
            <button
              type="submit"
              className="w-full h-10 inline-flex items-center justify-center gap-1.5 px-3 text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Thêm</span>
            </button>
          </div>
        </div>
      </form>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#4887EE] text-white text-xs sm:text-sm font-bold">
              <th className="py-3 px-4">TÊN HIỂN THỊ TRÊN HÓA ĐƠN</th>
              <th className="py-3 px-3 w-28">KÍCH THƯỚC</th>
              <th className="py-3 px-3 w-24">ĐƠN VỊ</th>
              <th className="py-3 px-4 text-right w-44">ĐƠN GIÁ (VNĐ)</th>
              <th className="py-3 px-3 w-12" aria-label="Xóa" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-sm">
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50/70">
                <td className="py-2.5 px-4">
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) =>
                      onUpdateCatalogProduct(p.id, { name: e.target.value })
                    }
                    className="w-full font-semibold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-900 focus:outline-none py-0.5"
                  />
                  <div className="text-xs text-slate-400 mt-0.5">
                    {[p.category, p.sides].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className="py-2.5 px-3">
                  <input
                    type="text"
                    value={p.size || ''}
                    onChange={(e) =>
                      onUpdateCatalogProduct(p.id, { size: e.target.value })
                    }
                    className="w-full font-medium text-slate-700 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-900 focus:outline-none py-0.5"
                  />
                </td>
                <td className="py-2.5 px-3">
                  <input
                    type="text"
                    value={p.unit}
                    onChange={(e) =>
                      onUpdateCatalogProduct(p.id, { unit: e.target.value })
                    }
                    className="w-full text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-900 focus:outline-none py-0.5"
                  />
                </td>
                <td className="py-2.5 px-4">
                  <div className="flex justify-end">
                    <MoneyInput
                      value={p.price}
                      onChange={(nextPrice) =>
                        onUpdateCatalogProduct(p.id, { price: nextPrice })
                      }
                      ariaLabel={`Đơn giá ${p.name}`}
                      textColorClass="text-blue-700"
                      className="w-36 h-9 text-sm bg-slate-50 border border-slate-200 rounded-md focus-within:bg-white focus-within:border-slate-900"
                    />
                  </div>
                </td>
                <td className="py-2.5 px-3 text-center">
                  <button
                    type="button"
                    onClick={() => onDeleteCatalogProduct(p.id)}
                    aria-label="Xóa sản phẩm"
                    className="p-1.5 text-slate-400 hover:text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

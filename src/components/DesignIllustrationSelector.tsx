import { useEffect, useRef, useState } from 'react';

export const DESIGN_ILLUSTRATION_PRESETS = [
  'Form ly nhựa',
  'Thủy tinh',
  'Full chữ',
] as const;

export const DEFAULT_DESIGN_ILLUSTRATION = 'Form ly nhựa';

interface DesignIllustrationSelectorProps {
  value: string;
  onChange: (next: string) => void;
  showPrintVersion?: boolean;
}

export function DesignIllustrationSelector({
  value,
  onChange,
  showPrintVersion = false,
}: DesignIllustrationSelectorProps) {
  const isPreset = DESIGN_ILLUSTRATION_PRESETS.includes(
    value as (typeof DESIGN_ILLUSTRATION_PRESETS)[number]
  );
  const isHidden = !value.trim();
  const [customExpanded, setCustomExpanded] = useState(
    () => !isHidden && !isPreset
  );
  const [customDraft, setCustomDraft] = useState<string>(() =>
    !isHidden && !isPreset ? value : ''
  );
  const [isEditingCustom, setIsEditingCustom] = useState(false);
  const customInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isEditingCustom) return;
    if (!isHidden && !isPreset) {
      setCustomExpanded(true);
      setCustomDraft(value === 'Tự chọn' ? '' : value);
    } else if (isPreset || isHidden) {
      setCustomExpanded(false);
    }
  }, [isHidden, isPreset, value, isEditingCustom]);

  const handleSelectCustom = () => {
    setCustomExpanded(true);
    if (isHidden || isPreset) {
      setCustomDraft('');
      onChange('Tự chọn');
    }
    window.setTimeout(() => {
      customInputRef.current?.focus();
    }, 20);
  };

  return (
    <div>
      {showPrintVersion && value.trim() && (
        <div className="hidden print:block text-sm sm:text-base text-slate-900 pb-1">
          <span className="font-bold">
            Mẫu Thiết Kế đã đính kèm, ảnh minh họa:{' '}
          </span>
          <span className="font-semibold text-blue-700">{value.trim()}</span>
        </div>
      )}

      <div className={showPrintVersion ? 'no-print' : ''}>
        {isHidden ? (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_DESIGN_ILLUSTRATION)}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-2 cursor-pointer whitespace-nowrap shrink-0"
          >
            + Hiện dòng: Mẫu Thiết Kế đã đính kèm, ảnh minh họa
          </button>
        ) : (
          <div className="p-2.5 sm:px-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs sm:text-sm font-bold text-slate-800">
                Mẫu Thiết Kế đã đính kèm, ảnh minh họa:{' '}
                <span className="text-blue-700 font-extrabold">{value}</span>
              </span>

              <button
                type="button"
                onClick={() => {
                  setCustomExpanded(false);
                  onChange('');
                }}
                className="text-xs text-slate-400 hover:text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
              >
                Ẩn dòng này
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {DESIGN_ILLUSTRATION_PRESETS.map((preset) => {
                const active = !customExpanded && value === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setCustomExpanded(false);
                      onChange(preset);
                    }}
                    className={`h-7 px-2.5 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-[#4887EE] text-white border-[#4887EE]'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={handleSelectCustom}
                className={`h-7 px-2.5 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  customExpanded
                    ? 'bg-[#4887EE] text-white border-[#4887EE]'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'
                }`}
              >
                Tự chọn
              </button>

              {customExpanded && (
                <input
                  ref={customInputRef}
                  type="text"
                  maxLength={200}
                  value={customDraft}
                  onFocus={() => setIsEditingCustom(true)}
                  onBlur={() => {
                    setIsEditingCustom(false);
                    const trimmed = customDraft.trim();
                    onChange(trimmed || 'Tự chọn');
                  }}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setCustomDraft(nextVal);
                    onChange(nextVal.trim() || 'Tự chọn');
                  }}
                  placeholder="Gõ nội dung tự chọn (hoặc để Tự chọn)..."
                  aria-label="Nhập kiểu ảnh minh họa tự chọn"
                  className="h-7 px-2.5 min-w-[190px] flex-1 text-xs sm:text-sm font-semibold text-blue-700 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#4887EE] placeholder:font-normal placeholder:text-slate-400"
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

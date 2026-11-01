import React, { memo, useEffect, useRef, useState } from 'react';
import { formatNumberVN } from '../utils/formatters';

interface MoneyInputProps {
  id?: string;
  value: number;
  onChange: (nextValue: number) => void;
  placeholder?: string;
  ariaLabel?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  className?: string;
  textColorClass?: string;
  align?: 'left' | 'right';
}

export const MoneyInput = memo(function MoneyInput({
  id,
  value,
  onChange,
  placeholder = '0',
  ariaLabel,
  inputRef,
  className = '',
  textColorClass = 'text-slate-900',
  align = 'right',
}: MoneyInputProps) {
  const internalRef = useRef<HTMLInputElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState<string>(() =>
    value > 0 ? String(Math.round(value)) : ''
  );

  useEffect(() => {
    if (!isFocused) {
      setDraft(value > 0 ? String(Math.round(value)) : '');
    }
  }, [value, isFocused]);

  const setRefs = (el: HTMLInputElement | null) => {
    internalRef.current = el;
    if (inputRef && 'current' in inputRef) {
      inputRef.current = el;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;

    if (/^\d+[kK]$/.test(raw.trim())) {
      const base = parseInt(raw.trim().slice(0, -1), 10) || 0;
      if (base > 0 && base < 100000000) {
        const multiplied = base * 1000;
        setDraft(String(multiplied));
        onChange(multiplied);
        return;
      }
    }

    const digitsOnly = raw.replace(/[^\d]/g, '');
    if (digitsOnly === '') {
      setDraft('');
      onChange(0);
      return;
    }

    const cleaned = digitsOnly.replace(/^0+(?=\d)/, '');
    setDraft(cleaned);
    const numeric = parseInt(cleaned, 10);
    onChange(Number.isNaN(numeric) ? 0 : numeric);
  };

  const displayValue = isFocused
    ? draft
    : value > 0
      ? formatNumberVN(value)
      : '';

  const alignClass = align === 'right' ? 'text-right' : 'text-left';

  return (
    <div className={`relative flex items-center ${className}`}>
      <input
        ref={setRefs}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={displayValue}
        onFocus={(e) => {
          const initialDraft = value > 0 ? String(Math.round(value)) : '';
          setIsFocused(true);
          setDraft(initialDraft);
          const target = e.currentTarget;
          window.requestAnimationFrame(() => {
            try {
              target.select();
            } catch {
              // Ignore
            }
          });
        }}
        onBlur={() => {
          setIsFocused(false);
          setDraft(value > 0 ? String(Math.round(value)) : '');
        }}
        onChange={handleChange}
        className={`w-full h-full pl-2.5 pr-6 font-bold num-clean bg-transparent focus:outline-none ${alignClass} ${textColorClass}`}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
        đ
      </span>
    </div>
  );
});

interface QuantityInputProps {
  value: number;
  onChange: (nextQuantity: number) => void;
  min?: number;
  ariaLabel?: string;
  className?: string;
}

export const QuantityInput = memo(function QuantityInput({
  value,
  onChange,
  min = 1,
  ariaLabel,
  className = '',
}: QuantityInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState<string>(() => String(value));

  useEffect(() => {
    if (!isFocused) {
      setDraft(String(value));
    }
  }, [value, isFocused]);

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      aria-label={ariaLabel}
      value={isFocused ? draft : String(value)}
      onFocus={(e) => {
        setIsFocused(true);
        setDraft(String(value));
        const target = e.currentTarget;
        window.requestAnimationFrame(() => {
          try {
            target.select();
          } catch {
            // Ignore
          }
        });
      }}
      onBlur={() => {
        setIsFocused(false);
        const parsed = parseInt(draft, 10);
        if (Number.isNaN(parsed) || parsed < min) {
          setDraft(String(min));
          onChange(min);
        } else {
          setDraft(String(parsed));
          onChange(parsed);
        }
      }}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^\d]/g, '');
        setDraft(digits);
        if (digits !== '') {
          const parsed = parseInt(digits, 10);
          if (!Number.isNaN(parsed) && parsed >= min) {
            onChange(parsed);
          }
        }
      }}
      className={`text-center font-bold text-slate-900 num-clean focus:outline-none ${className}`}
    />
  );
});

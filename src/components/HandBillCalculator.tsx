import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calculator,
  Check,
  Copy,
  Delete,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import { formatNumberVN, formatVND } from '../utils/formatters';

interface TapeEntry {
  id: string;
  expressionDisplay: string;
  result: number;
}

interface HandBillCalculatorProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onInsertToQuote?: (name: string, amount: number) => void;
}

type EvalOutcome =
  | { ok: true; value: number }
  | { ok: false; error: string | null };

const OPERATORS = new Set(['+', '-', '*', '/']);
const MAX_CALC_ABS = 1_000_000_000_000_000; // 10^15 safe non-scientific bound

function formatSafePlainNumber(val: number): string {
  if (!Number.isFinite(val) || Math.abs(val) < 1e-7) return '0';
  const nearestInt = Math.round(val);
  if (Math.abs(val - nearestInt) < 1e-4) return String(Math.trunc(nearestInt));
  return val.toFixed(9).replace(/\.?0+$/, '');
}

function formatNumericTokenVN(token: string): string {
  if (!token) return '';
  const hasDot = token.includes('.');
  const [intPartRaw, decPart] = token.split('.');
  const cleanInt = intPartRaw.replace(/^0+(?=\d)/, '');
  const numericInt = cleanInt ? Number(cleanInt) : 0;
  const formattedInt = Number.isFinite(numericInt)
    ? numericInt.toLocaleString('vi-VN')
    : intPartRaw;

  if (!hasDot) return formattedInt;
  return `${formattedInt},${decPart ?? ''}`;
}

function formatExpressionDisplay(expr: string): string {
  if (!expr) return '';
  let out = '';
  let numBuf = '';

  const flushNum = () => {
    if (numBuf) {
      out += formatNumericTokenVN(numBuf);
      numBuf = '';
    }
  };

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      numBuf += ch;
    } else {
      flushNum();
      if (ch === '+') out += ' + ';
      else if (ch === '-') out += i === 0 ? '-' : ' − ';
      else if (ch === '*') out += ' × ';
      else if (ch === '/') out += ' ÷ ';
      else if (ch === '%') out += '%';
      else out += ch;
    }
  }
  flushNum();
  return out.trim();
}

function evaluateBillExpression(rawExpr: string): EvalOutcome {
  let expr = rawExpr.trim();
  while (
    expr.length > 0 &&
    (OPERATORS.has(expr[expr.length - 1]) || expr[expr.length - 1] === '.')
  ) {
    expr = expr.slice(0, -1);
  }

  if (!expr || expr === '-') {
    return { ok: true, value: 0 };
  }

  type NumToken = { type: 'num'; value: number; isPercent: boolean };
  type OpToken = { type: 'op'; op: '+' | '-' | '*' | '/' };
  const tokens: Array<NumToken | OpToken> = [];

  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    const isLeadingNegative =
      ch === '-' &&
      (tokens.length === 0 || tokens[tokens.length - 1].type === 'op');

    if ((ch >= '0' && ch <= '9') || ch === '.' || isLeadingNegative) {
      let numStr = '';
      if (isLeadingNegative) {
        numStr += '-';
        i++;
      }
      let dotCount = 0;
      while (i < expr.length) {
        const c = expr[i];
        if (c >= '0' && c <= '9') {
          numStr += c;
          i++;
        } else if (c === '.') {
          dotCount++;
          if (dotCount > 1) return { ok: false, error: 'Biểu thức không hợp lệ' };
          numStr += c;
          i++;
        } else {
          break;
        }
      }

      if (numStr === '' || numStr === '-' || numStr === '.') {
        return { ok: false, error: null };
      }

      const parsed = Number(numStr);
      if (!Number.isFinite(parsed)) {
        return { ok: false, error: 'Số quá lớn' };
      }

      let isPercent = false;
      while (i < expr.length && expr[i] === '%') {
        isPercent = true;
        i++;
      }

      tokens.push({ type: 'num', value: parsed, isPercent });
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', op: ch });
      i++;
      continue;
    }

    return { ok: false, error: 'Biểu thức không hợp lệ' };
  }

  if (tokens.length === 0 || tokens[0].type !== 'num') {
    return { ok: true, value: 0 };
  }

  // Pass 1: Multiplication & Division (*, /)
  const pass1: Array<NumToken | OpToken> = [tokens[0]];
  for (let idx = 1; idx < tokens.length; idx += 2) {
    const opTok = tokens[idx];
    const nextTok = tokens[idx + 1];
    if (!opTok || opTok.type !== 'op' || !nextTok || nextTok.type !== 'num') {
      break;
    }

    if (opTok.op === '*' || opTok.op === '/') {
      const prev = pass1[pass1.length - 1] as NumToken;
      const leftVal = prev.isPercent ? prev.value / 100 : prev.value;
      const rightVal = nextTok.isPercent ? nextTok.value / 100 : nextTok.value;

      if (opTok.op === '/' && rightVal === 0) {
        return { ok: false, error: 'Không thể chia cho 0' };
      }

      const combined = opTok.op === '*' ? leftVal * rightVal : leftVal / rightVal;
      if (!Number.isFinite(combined) || Math.abs(combined) > MAX_CALC_ABS) {
        return { ok: false, error: 'Giá trị vượt giới hạn' };
      }
      pass1[pass1.length - 1] = {
        type: 'num',
        value: combined,
        isPercent: false,
      };
    } else {
      pass1.push(opTok, nextTok);
    }
  }

  // Pass 2: Addition & Subtraction (+, -), supporting Casio-style +/- X%
  const first = pass1[0] as NumToken;
  let acc = first.isPercent ? first.value / 100 : first.value;

  for (let idx = 1; idx < pass1.length; idx += 2) {
    const opTok = pass1[idx] as OpToken;
    const right = pass1[idx + 1] as NumToken;
    if (!opTok || !right) break;

    const delta = right.isPercent
      ? acc * (right.value / 100)
      : right.value;

    acc = opTok.op === '+' ? acc + delta : acc - delta;
    if (!Number.isFinite(acc) || Math.abs(acc) > MAX_CALC_ABS) {
      return { ok: false, error: 'Giá trị vượt giới hạn' };
    }
  }

  // Snap IEEE-754 floating-point noise (e.g. 149999.999999 -> 150000, 0.1 + 0.2 -> 0.3)
  const nearestInt = Math.round(acc);
  const cleaned =
    Math.abs(acc) < 1e-7
      ? 0
      : Math.abs(acc - nearestInt) < 1e-4
        ? nearestInt + 0
        : Math.round(acc * 1e9) / 1e9;
  return { ok: true, value: cleaned };
}

function getLastNumberSegment(expr: string): string {
  let i = expr.length - 1;
  while (i >= 0) {
    const ch = expr[i];
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      i--;
    } else {
      break;
    }
  }
  return expr.slice(i + 1);
}

export const HandBillCalculator = memo(function HandBillCalculator({
  isOpen,
  onToggle,
  onClose,
  onInsertToQuote,
}: HandBillCalculatorProps) {
  const [expr, setExpr] = useState<string>('');
  const [justEvaluated, setJustEvaluated] = useState<boolean>(false);
  const [tape, setTape] = useState<TapeEntry[]>([]);
  const [copiedResult, setCopiedResult] = useState<boolean>(false);
  const [addedToQuote, setAddedToQuote] = useState<boolean>(false);
  const copyTimerRef = useRef<number | null>(null);
  const addTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      if (addTimerRef.current !== null) window.clearTimeout(addTimerRef.current);
    };
  }, []);

  const outcome = useMemo(() => evaluateBillExpression(expr), [expr]);
  const currentValue = outcome.ok ? outcome.value : 0;

  const appendDigit = useCallback(
    (digits: string) => {
      setExpr((prev) => {
        const base = justEvaluated ? '' : prev;
        if (base.endsWith('%')) {
          return `${base}*${digits === '000' ? '0' : digits}`;
        }
        const seg = getLastNumberSegment(base);
        if (digits === '000') {
          if (!seg || seg === '0') {
            return seg === '0' ? base : `${base}0`;
          }
          if (seg.replace('.', '').length > 12) return base;
          return `${base}000`;
        }
        if (seg === '0' && digits !== '.') {
          return `${base.slice(0, -1)}${digits}`;
        }
        if (seg.replace('.', '').length >= 15) return base;
        return `${base}${digits}`;
      });
      setJustEvaluated(false);
    },
    [justEvaluated]
  );

  const appendDecimal = useCallback(() => {
    setExpr((prev) => {
      const base = justEvaluated ? '' : prev;
      if (base.endsWith('%')) {
        return `${base}*0.`;
      }
      const seg = getLastNumberSegment(base);
      if (seg.includes('.')) return base;
      if (!seg) return `${base}0.`;
      return `${base}.`;
    });
    setJustEvaluated(false);
  }, [justEvaluated]);

  const appendOperator = useCallback(
    (op: '+' | '-' | '*' | '/') => {
      setExpr((prev) => {
        if (!prev) {
          return op === '-' ? '-' : '0' + op;
        }
        if (prev === '-') {
          return op === '-' ? '-' : '';
        }
        const last = prev[prev.length - 1];
        if (OPERATORS.has(last)) {
          return `${prev.slice(0, -1)}${op}`;
        }
        if (last === '.') {
          return `${prev.slice(0, -1)}${op}`;
        }
        return `${prev}${op}`;
      });
      setJustEvaluated(false);
    },
    []
  );

  const appendPercent = useCallback(() => {
    setExpr((prev) => {
      if (!prev) return '';
      const last = prev[prev.length - 1];
      if ((last >= '0' && last <= '9') || last === '.') {
        const trimmed = last === '.' ? prev.slice(0, -1) : prev;
        return trimmed ? `${trimmed}%` : '';
      }
      return prev;
    });
    setJustEvaluated(false);
  }, []);

  const handleBackspace = useCallback(() => {
    setExpr((prev) => {
      if (justEvaluated) return '';
      return prev.slice(0, -1);
    });
    setJustEvaluated(false);
  }, [justEvaluated]);

  const handleClear = useCallback(() => {
    setExpr('');
    setJustEvaluated(false);
  }, []);

  const handleEvaluate = useCallback(() => {
    if (!expr.trim()) return;
    const evalRes = evaluateBillExpression(expr);
    if (!evalRes.ok) return;

    const cleanDisplay = formatExpressionDisplay(
      expr.replace(/[+\-*/.]+$/, '')
    );
    const hasOperatorOrPercent =
      /[+*/%]/.test(expr) || (expr.indexOf('-', 1) !== -1);

    if (cleanDisplay && (hasOperatorOrPercent || !justEvaluated)) {
      setTape((prev) => [
        {
          id: `tape-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          expressionDisplay: cleanDisplay,
          result: evalRes.value,
        },
        ...prev.slice(0, 11),
      ]);
    }

    setExpr(formatSafePlainNumber(evalRes.value));
    setJustEvaluated(true);
  }, [expr, justEvaluated]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        appendDigit(e.key);
        return;
      }
      if (e.key === '.' || e.key === ',') {
        e.preventDefault();
        appendDecimal();
        return;
      }
      if (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/') {
        e.preventDefault();
        appendOperator(e.key);
        return;
      }
      if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        appendOperator('*');
        return;
      }
      if (e.key === '%') {
        e.preventDefault();
        appendPercent();
        return;
      }
      if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        handleEvaluate();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
        return;
      }
      if (e.key === 'Delete' || e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        handleClear();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isOpen,
    onClose,
    appendDigit,
    appendDecimal,
    appendOperator,
    appendPercent,
    handleEvaluate,
    handleBackspace,
    handleClear,
  ]);

  const handleCopyResult = async () => {
    const rounded = Math.round(currentValue);
    const text = formatNumberVN(rounded);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedResult(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedResult(false);
      copyTimerRef.current = null;
    }, 1800);
  };

  const handleInsertCurrentToQuote = () => {
    if (!onInsertToQuote) return;
    const rounded = Math.round(currentValue);
    if (rounded <= 0) return;
    onInsertToQuote('Sản phẩm tính tay', rounded);
    setAddedToQuote(true);
    if (addTimerRef.current !== null) {
      window.clearTimeout(addTimerRef.current);
    }
    addTimerRef.current = window.setTimeout(() => {
      setAddedToQuote(false);
      addTimerRef.current = null;
    }, 1800);
  };

  const handleUseTapeValue = (val: number, mode: 'replace' | 'add') => {
    const cleanVal = formatSafePlainNumber(val);
    if (mode === 'replace' || !expr) {
      setExpr(cleanVal);
      setJustEvaluated(true);
      return;
    }
    setExpr((prev) => {
      const last = prev[prev.length - 1];
      if (OPERATORS.has(last)) {
        return `${prev}${cleanVal}`;
      }
      return `${prev}+${cleanVal}`;
    });
    setJustEvaluated(false);
  };

  const formattedResultText = useMemo(() => {
    if (!outcome.ok) {
      return outcome.error || '0đ';
    }
    const val = outcome.value;
    if (Number.isInteger(val) || Math.abs(val) >= 100) {
      return formatVND(Math.round(val));
    }
    return `${val.toLocaleString('vi-VN', {
      maximumFractionDigits: 4,
    })}đ`;
  }, [outcome]);

  const formattedExpr = useMemo(() => formatExpressionDisplay(expr), [expr]);

  return (
    <>
      {/* Bottom Floating Calculator Button */}
      <div className="no-print fixed bottom-4 right-4 sm:bottom-5 sm:right-6 z-40">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className={`h-11 inline-flex items-center gap-2 px-4 rounded-xl text-sm font-bold shadow-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            isOpen
              ? 'bg-[#3674DC] hover:bg-[#2A62C4] text-white border-[#2A62C4]'
              : 'bg-[#4887EE] hover:bg-[#3674DC] text-white border-[#3674DC]'
          }`}
        >
          <Calculator className="w-4 h-4 shrink-0" />
          <span>Máy tính</span>
        </button>
      </div>

      {/* Handheld Manual Bill Calculator Panel */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Máy tính tính bill tay"
          className="no-print modal-panel-enter fixed bottom-18 right-3 left-3 sm:left-auto sm:right-6 z-50 sm:w-[360px] max-h-[calc(100vh-5.5rem)] flex flex-col bg-white border border-slate-300 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 py-2.5 bg-[#4887EE] text-white flex items-center justify-between gap-2 border-b border-[#3674DC] shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Calculator className="w-4 h-4 text-white shrink-0" />
              <span className="text-sm font-bold truncate">
                Máy tính tính bill tay
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng máy tính"
              className="p-1 text-white/80 hover:text-white rounded-md transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 space-y-2.5 overflow-y-auto">
            {/* Digital Display */}
            <div className="bg-blue-50/70 text-slate-900 rounded-xl px-3.5 py-3 border border-blue-200">
              <div className="min-h-[20px] text-right text-xs sm:text-sm text-slate-500 num-clean break-all leading-snug">
                {formattedExpr || '0'}
              </div>
              <div
                className={`mt-1 text-right font-extrabold num-clean tracking-tight break-all ${
                  !outcome.ok
                    ? 'text-base text-rose-600'
                    : formattedResultText.length > 14
                    ? 'text-xl text-[#3674DC]'
                    : 'text-2xl sm:text-[26px] text-[#3674DC]'
                }`}
              >
                {formattedResultText}
              </div>
            </div>

            {/* Quick Result Actions */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!outcome.ok || currentValue === 0}
                onClick={() => void handleCopyResult()}
                className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 px-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {copiedResult ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="text-emerald-700">Đã chép số tiền</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 shrink-0" />
                    <span>Chép kết quả</span>
                  </>
                )}
              </button>

              {onInsertToQuote && (
                <button
                  type="button"
                  disabled={!outcome.ok || Math.round(currentValue) <= 0}
                  onClick={handleInsertCurrentToQuote}
                  className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 px-2.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {addedToQuote ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span className="text-emerald-700">Đã đưa vào đơn!</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5 shrink-0" />
                      <span>Đưa vào đơn</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Recent Bill Tape */}
            {tape.length > 0 && (
              <div className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                <div className="px-2.5 py-1.5 border-b border-slate-200 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                  <span>Lịch sử tính vừa bấm ({tape.length})</span>
                  <button
                    type="button"
                    onClick={() => setTape([])}
                    className="inline-flex items-center gap-1 text-slate-500 hover:text-rose-600 cursor-pointer whitespace-nowrap"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Xóa</span>
                  </button>
                </div>
                <div className="max-h-24 overflow-y-auto divide-y divide-slate-200/70">
                  {tape.map((item) => (
                    <div
                      key={item.id}
                      className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs hover:bg-white transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => handleUseTapeValue(item.result, 'replace')}
                        title="Bấm để lấy lại kết quả này"
                        className="text-left text-slate-600 truncate flex-1 cursor-pointer num-clean"
                      >
                        {item.expressionDisplay} ={' '}
                        <strong className="text-slate-900">
                          {formatVND(item.result)}
                        </strong>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUseTapeValue(item.result, 'add')}
                        title="Cộng dồn số này vào phép tính đang mở"
                        className="px-1.5 py-0.5 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer whitespace-nowrap shrink-0 num-clean"
                      >
                        + Cộng
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Calculator Keypad */}
            <div
              onMouseDown={(e) => e.preventDefault()}
              className="grid grid-cols-4 gap-1.5 select-none"
            >
              <button
                type="button"
                onClick={handleClear}
                className="h-11 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-sm border border-rose-200 transition-colors cursor-pointer"
              >
                C
              </button>
              <button
                type="button"
                onClick={handleBackspace}
                aria-label="Xóa 1 ký tự"
                className="h-11 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm border border-slate-200 inline-flex items-center justify-center transition-colors cursor-pointer"
              >
                <Delete className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={appendPercent}
                className="h-11 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm border border-slate-200 transition-colors cursor-pointer num-clean"
              >
                %
              </button>
              <button
                type="button"
                onClick={() => appendOperator('/')}
                className="h-11 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-extrabold text-base border border-blue-200 transition-colors cursor-pointer"
              >
                ÷
              </button>

              {['7', '8', '9'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => appendDigit(d)}
                  className="h-11 rounded-lg bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-900 font-bold text-base border border-slate-200 transition-colors cursor-pointer num-clean"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => appendOperator('*')}
                className="h-11 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-extrabold text-base border border-blue-200 transition-colors cursor-pointer"
              >
                ×
              </button>

              {['4', '5', '6'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => appendDigit(d)}
                  className="h-11 rounded-lg bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-900 font-bold text-base border border-slate-200 transition-colors cursor-pointer num-clean"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => appendOperator('-')}
                className="h-11 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-extrabold text-base border border-blue-200 transition-colors cursor-pointer"
              >
                −
              </button>

              {['1', '2', '3'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => appendDigit(d)}
                  className="h-11 rounded-lg bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-900 font-bold text-base border border-slate-200 transition-colors cursor-pointer num-clean"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => appendOperator('+')}
                className="h-11 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-extrabold text-base border border-blue-200 transition-colors cursor-pointer"
              >
                +
              </button>

              <button
                type="button"
                onClick={() => appendDigit('0')}
                className="h-11 rounded-lg bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-900 font-bold text-base border border-slate-200 transition-colors cursor-pointer num-clean"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => appendDigit('000')}
                className="h-11 rounded-lg bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-900 font-extrabold text-xs sm:text-sm border border-slate-200 transition-colors cursor-pointer num-clean"
              >
                000
              </button>
              <button
                type="button"
                onClick={appendDecimal}
                className="h-11 rounded-lg bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-900 font-bold text-base border border-slate-200 transition-colors cursor-pointer"
              >
                ,
              </button>
              <button
                type="button"
                onClick={handleEvaluate}
                className="h-11 rounded-lg bg-[#4887EE] hover:bg-[#3674DC] text-white font-extrabold text-base transition-colors cursor-pointer"
              >
                =
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

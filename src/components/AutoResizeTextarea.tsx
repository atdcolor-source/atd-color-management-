import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

interface AutoResizeTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  minHeightPx?: number;
}

const resizeCallbacksByTarget = new WeakMap<Element, Set<() => void>>();
let sharedResizeObserver: ResizeObserver | null = null;

function subscribeElementResize(target: Element, cb: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', cb, { passive: true });
    return () => window.removeEventListener('resize', cb);
  }

  if (!sharedResizeObserver) {
    sharedResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const listeners = resizeCallbacksByTarget.get(entry.target);
        if (listeners) {
          listeners.forEach((fn) => fn());
        }
      }
    });
  }

  let listeners = resizeCallbacksByTarget.get(target);
  if (!listeners) {
    listeners = new Set();
    resizeCallbacksByTarget.set(target, listeners);
    sharedResizeObserver.observe(target);
  }
  listeners.add(cb);

  return () => {
    const current = resizeCallbacksByTarget.get(target);
    if (!current) return;
    current.delete(cb);
    if (current.size === 0) {
      resizeCallbacksByTarget.delete(target);
      sharedResizeObserver?.unobserve(target);
    }
  };
}

export const AutoResizeTextarea = memo(function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = '',
  minHeightPx = 28,
}: AutoResizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastParentWidthRef = useRef<number>(-1);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.max(minHeightPx, el.scrollHeight);
    el.style.height = `${nextHeight}px`;
  }, [minHeightPx]);

  useLayoutEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  useEffect(() => {
    const el = textareaRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    lastParentWidthRef.current = parent.clientWidth;
    return subscribeElementResize(parent, () => {
      const nextWidth = parent.clientWidth;
      if (nextWidth !== lastParentWidthRef.current) {
        lastParentWidthRef.current = nextWidth;
        adjustHeight();
      }
    });
  }, [adjustHeight]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={`block w-full resize-none overflow-hidden bg-transparent whitespace-pre-wrap break-words leading-snug focus:outline-none ${className}`}
    />
  );
});

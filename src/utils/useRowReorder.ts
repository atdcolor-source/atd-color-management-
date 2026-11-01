import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export function useRowReorder(
  itemCount: number,
  onMoveItem: (fromIndex: number, toIndex: number) => void
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const onMoveItemRef = useRef(onMoveItem);

  useEffect(() => {
    onMoveItemRef.current = onMoveItem;
  }, [onMoveItem]);

  useEffect(() => {
    if (!draggingId) return;

    let rafId: number | null = null;
    let latestClientY = 0;

    const flushReorder = () => {
      rafId = null;
      const tbody = tbodyRef.current;
      if (!tbody) return;

      const rows = Array.from(
        tbody.querySelectorAll<HTMLTableRowElement>('tr[data-item-id]')
      );
      if (rows.length < 2) return;

      const fromIdx = rows.findIndex(
        (row) => row.dataset.itemId === draggingId
      );
      if (fromIdx === -1) return;

      const clientY = latestClientY;
      let targetIdx = fromIdx;

      for (let i = 0; i < rows.length; i++) {
        if (i === fromIdx) continue;
        const rect = rows[i].getBoundingClientRect();
        const midY = rect.top + rect.height / 2;

        if (i < fromIdx && clientY < midY) {
          targetIdx = i;
          break;
        }
        if (i > fromIdx && clientY > midY) {
          targetIdx = i;
        }
      }

      if (targetIdx !== fromIdx) {
        onMoveItemRef.current(fromIdx, targetIdx);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      latestClientY = e.clientY;
      if (rafId === null) {
        rafId = window.requestAnimationFrame(flushReorder);
      }
    };

    const stopDragging = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      setDraggingId(null);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
    window.addEventListener('blur', stopDragging);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
      window.removeEventListener('blur', stopDragging);
    };
  }, [draggingId]);

  const startRowDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, itemId: string) => {
      if (itemCount < 2) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      setDraggingId(itemId);
    },
    [itemCount]
  );

  return {
    tbodyRef,
    draggingId,
    startRowDrag,
  };
}

"use client";

import { useCallback, useEffect, useRef, type PointerEvent } from "react";

/** Pointer capture keeps header drags working outside the dialog and on touch. */
export function useDialogDrag() {
  const ref = useRef<HTMLDivElement>(null);
  const offset = useRef({ x: 0, y: 0 });
  const drag = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number } | null>(null);

  const move = useCallback((x: number, y: number) => {
    const surface = ref.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const left = rect.left - offset.current.x;
    const top = rect.top - offset.current.y;
    const margin = 8;
    // Oversized content still leaves the top-left/header accessible.
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    offset.current = {
      x: Math.min(maxLeft, Math.max(margin, left + x)) - left,
      y: Math.min(maxTop, Math.max(margin, top + y)) - top,
    };
    surface.style.translate = `${offset.current.x}px ${offset.current.y}px`;
  }, []);

  const stop = useCallback(() => {
    const pointerId = drag.current?.pointerId;
    drag.current = null;
    const surface = ref.current;
    if (pointerId !== undefined && surface?.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
    surface?.removeAttribute("data-dragging");
  }, []);

  // Keep a moved dialog reachable after viewport or content size changes.
  useEffect(() => {
    const reposition = () => { stop(); move(offset.current.x, offset.current.y); };
    const observer = new ResizeObserver(reposition);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", reposition);
    window.addEventListener("blur", stop);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("blur", stop);
      stop();
    };
  }, [move, stop]);

  return { ref,
    onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
      if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
      const handle = event.target.closest("[data-dialog-drag-handle]");
      if (!handle || !event.currentTarget.contains(handle)) return;
      if (event.target.closest("button, a, input, textarea, select, [role='button'], [contenteditable='true'], [data-no-drag]")) return;
      event.preventDefault();
      if (event.currentTarget.tabIndex >= 0) event.currentTarget.focus({ preventScroll: true });
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        startX: offset.current.x, startY: offset.current.y };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.setAttribute("data-dragging", "true");
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      move(current.startX + event.clientX - current.x, current.startY + event.clientY - current.y);
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      if (drag.current?.pointerId === event.pointerId) stop();
    },
    onPointerCancel: stop,
    onLostPointerCapture: stop,
  };
}

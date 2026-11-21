"use client";

import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { useI18n } from "@/lib/i18n";

interface Props {
  requestId: string;
  title: string;
  pending: number;
  running: boolean;
  compacting: boolean;
  onStop: () => void;
  error?: string;
  onDismissError: () => void;
  retry?: string;
  queued: number;
  children: ReactNode;
}

/** Layout only: LiveSession remains the owner of requests, drafts and responses. */
export function SessionInteractionDock({ requestId, title, pending, running, compacting,
  onStop, error, onDismissError, retry, queued, children }: Props) {
  const { t } = useI18n();
  const root = useRef<HTMLElement>(null);
  const [slotHeight, setSlotHeight] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const touchY = useRef<number | null>(null);
  const touchAtTop = useRef(false);
  const touchHandled = useRef(false);
  const wheelGesture = useRef({ time: 0, direction: 0, atTop: false, handled: false });
  const carets = useRef(new Map<string, { start: number; end: number }>());
  const rememberCaret = (event: SyntheticEvent) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      carets.current.set(requestId, { start: target.selectionStart ?? 0, end: target.selectionEnd ?? 0 });
    }
  };
  useEffect(() => {
    const panel = root.current;
    if (!panel || window.getSelection()?.toString()) return;
    const active = document.activeElement;
    if (active && active !== document.body && !panel.contains(active)) return;
    const field = panel.querySelector<HTMLElement>("[data-interaction-focus]") ?? panel;
    field.focus({ preventScroll: true });
    const caret = carets.current.get(requestId);
    if (caret && (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
      field.setSelectionRange(caret.start, caret.end);
    }
  }, [requestId]);

  useEffect(() => { setExpanded(false); setSlotHeight(null); }, [requestId]);
  useEffect(() => {
    if (slotHeight === null || expanded) return;
    const timer = window.setTimeout(() => setSlotHeight(null), 300);
    return () => window.clearTimeout(timer);
  }, [slotHeight, expanded]);

  useEffect(() => {
    const panel = root.current;
    if (!panel) return;
  const scrollBody = (target: EventTarget | null) => {
    const body = target instanceof Element ? target.closest<HTMLElement>("[data-interaction-scroll]") : null;
    return body && root.current?.contains(body) ? body : null;
  };
  const handleScrollIntent = (body: HTMLElement, direction: number, startedAtTop: boolean) => {
    if (slotHeight === null && direction > 0 && body.scrollHeight > body.clientHeight + 1 && root.current) {
      setSlotHeight(root.current.getBoundingClientRect().height);
      requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
      return true;
    }
    if (slotHeight !== null && expanded && direction < 0 && startedAtTop) {
      setExpanded(false);
      return true;
    }
    return false;
  };

  // React's delegated wheel/touch listeners are passive; use cancellable listeners
  // so the gesture that changes panel size cannot also scroll its contents.
  const onWheel = (event: WheelEvent) => {
      const body = scrollBody(event.target);
      if (!body || !event.deltaY) return;
      const now = Date.now();
      const direction = Math.sign(event.deltaY);
      const gesture = wheelGesture.current;
      if (now - gesture.time > 200 || gesture.direction !== direction) {
        gesture.atTop = body.scrollTop <= 0;
        gesture.handled = false;
      }
      gesture.time = now;
      gesture.direction = direction;
      if (!gesture.handled) gesture.handled = handleScrollIntent(body, direction, gesture.atTop);
      if (gesture.handled) event.preventDefault();
    };
  const onTouchStart = (event: TouchEvent) => {
      touchY.current = event.touches[0]?.clientY ?? null;
      touchAtTop.current = (scrollBody(event.target)?.scrollTop ?? 1) <= 0;
      touchHandled.current = false;
    };
  const onTouchMove = (event: TouchEvent) => {
      if (touchHandled.current) {
        event.preventDefault();
        return;
      }
      if (touchY.current === null || !event.touches[0]) return;
      const body = scrollBody(event.target);
      const delta = touchY.current - event.touches[0].clientY;
      if (!body) return;
      const expanding = slotHeight === null && delta > 0 && body.scrollHeight > body.clientHeight + 1;
      if (expanding) event.preventDefault();
      if (Math.abs(delta) < 12) return;
      touchHandled.current = handleScrollIntent(body, delta, touchAtTop.current);
      if (touchHandled.current) event.preventDefault();
    };
    panel.addEventListener("wheel", onWheel, { passive: false });
    panel.addEventListener("touchstart", onTouchStart, { passive: true });
    panel.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      panel.removeEventListener("wheel", onWheel);
      panel.removeEventListener("touchstart", onTouchStart);
      panel.removeEventListener("touchmove", onTouchMove);
    };
  }, [slotHeight, expanded]);

  return <div className="session-interaction-slot" style={slotHeight === null ? undefined : { height: slotHeight, flex: "none" }}>
  <section ref={root} data-session-interaction className={`session-interaction-dock${slotHeight !== null ? " is-overlay" : ""}${expanded ? " is-expanded" : ""}`}
    style={slotHeight !== null && !expanded ? { maxHeight: slotHeight } : undefined}
    aria-label={title} tabIndex={-1} onSelectCapture={rememberCaret} onBlurCapture={rememberCaret}
    onTransitionEnd={(event) => {
      if (event.target === event.currentTarget && event.propertyName === "max-height" && !expanded) setSlotHeight(null);
    }}>
    <div className="session-interaction-toolbar">
      <span aria-live="polite">{t("interaction.pending", { count: pending })}</span>
      {queued > 0 && <span>{t("interaction.queued", { count: queued })}</span>}
      {(running || compacting) && <button type="button" onClick={onStop}>
        {t(compacting ? "interaction.stopCompaction" : "interaction.stop")}
      </button>}
    </div>
    {error && <div className="session-interaction-status" role="alert">
      <span>{error}</span><button type="button" onClick={onDismissError}>{t("general.close")}</button>
    </div>}
    {retry && <div className="session-interaction-status" role="status">{retry}</div>}
    {children}
  </section>
  </div>;
}

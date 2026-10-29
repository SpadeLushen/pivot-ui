"use client";

import { useEffect, useRef, type ReactNode, type SyntheticEvent } from "react";
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

  return <section ref={root} data-session-interaction className="session-interaction-dock"
    aria-label={title} tabIndex={-1} onSelectCapture={rememberCaret} onBlurCapture={rememberCaret}>
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
  </section>;
}

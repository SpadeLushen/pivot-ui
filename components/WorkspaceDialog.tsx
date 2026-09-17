"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useBackdropDismiss } from "@/hooks/useBackdropDismiss";
import "./workspaces.css";

/** Native modal supplies focus trapping, focus restoration and stacked Escape. */
export function WorkspaceDialog({ title, onClose, children, compact = false, initialFocusRef }: {
  title: string; onClose: () => void; children: ReactNode; compact?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const backdrop = useBackdropDismiss(onClose);
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    // React autoFocus runs while a newly mounted native dialog is still closed.
    // Apply the requested initial focus only after showModal makes it visible.
    initialFocusRef?.current?.focus({ preventScroll: true });
    return () => dialog?.close();
  }, [initialFocusRef]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog ref={ref} className={`workspace-dialog modal-surface${compact ? " is-compact" : ""}`}
      aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}
      {...backdrop}>
      <div className="workspace-dialog-body">
        <header className="workspace-dialog-header">
          <h2>{title}</h2>
          <button type="button" className="workspace-icon-button" onClick={onClose} aria-label={t("general.close")}><X size={18} /></button>
        </header>
        {children}
      </div>
    </dialog>, document.body,
  );
}

export function WorkspaceTag({ tag }: { tag?: string }) {
  return tag ? <span className="workspace-tag" title={tag}>{tag}</span> : null;
}

"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useBackdropDismiss } from "@/hooks/useBackdropDismiss";
import { useI18n } from "@/lib/i18n";
import styles from "./ToolsConfig.module.css";

export function ToolsModal({ title, subtitle, onClose, children, editor = false }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; editor?: boolean;
}) {
  const backdrop = useBackdropDismiss(onClose), { t } = useI18n();
  const surface = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    surface.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <div className={styles.backdrop} style={{ zIndex: editor ? 1010 : 1000 }} {...backdrop}>
    <section className={`modal-surface ${styles.modal}${editor ? ` ${styles.editorModal}` : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={surface} tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
          event.stopPropagation();
          const focusable = Array.from(surface.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex=\"0\"]") ?? []);
          const first = focusable[0], last = focusable.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header className="tools-header"><strong>{title}</strong>{subtitle && <code title={subtitle}>{subtitle}</code>}
        <button type="button" onClick={onClose} aria-label={t("general.close")}><X size={18} /></button></header>
      {children}
    </section>
  </div>;
}
export function ToolSwitch({ checked, disabled, label, onChange, variant, title }: {
  checked: boolean; disabled?: boolean; label: string; onChange: (enabled: boolean) => void;
  variant?: "inline" | "compact"; title?: string;
}) {
  const input = <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />;
  return <label className={`tools-switch${variant ? ` tools-switch-slider tools-switch-${variant}` : ""}`} title={title ?? (variant === "compact" ? label : undefined)}>
    {variant ? <>{input}{variant === "inline" && <span>{label}</span>}</> : <><span>{label}</span>{input}</>}
  </label>;
}
export function ToolError({ error }: { error: string | null }) {
  const { t } = useI18n();
  return error ? <div className="tools-error" role="alert">{t(error)}</div> : null;
}

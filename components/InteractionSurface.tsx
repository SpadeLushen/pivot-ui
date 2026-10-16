"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";

/** Shared shell for session questions, custom interaction panels and app decisions. */
export function InteractionSurface({ style, ...props }: ComponentPropsWithRef<"div">) {
  return <div role="dialog" aria-modal="true" {...props} className={`modal-surface ${props.className ?? ""}`} style={{
    width: "min(560px, 100%)", maxHeight: "calc(100dvh - 40px)",
    display: "flex", flexDirection: "column", border: "1px solid var(--border)",
    borderRadius: 8, background: "var(--bg)", boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
    overflow: "hidden", ...style,
  }} />;
}
export function InteractionHeader({ title, subtitle, id }: { title: ReactNode; subtitle?: ReactNode; id?: string }) {
  return <div data-dialog-drag-handle style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
    <div id={id} style={{ color: "var(--text)", fontSize: 14, fontWeight: 650, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{title}</div>
    {subtitle && <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>{subtitle}</div>}
  </div>;
}
export function InteractionChoice({ style, ...props }: ComponentPropsWithRef<"button">) {
  return <button type="button" {...props} style={{ width: "100%", padding: "9px 10px", borderRadius: 7,
    border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text)",
    cursor: props.disabled ? "wait" : "pointer", textAlign: "left", fontSize: 13, ...style }} />;
}

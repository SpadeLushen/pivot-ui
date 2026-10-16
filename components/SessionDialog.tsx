"use client";

import { createContext, useContext, useImperativeHandle, type ComponentPropsWithRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useDialogDrag } from "@/hooks/useDialogDrag";
import { useDialogMessageBounds } from "@/hooks/useDialogMessageBounds";
import { InteractionSurface } from "./InteractionSurface";

const MessageListContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function SessionDialogScope({ messageListRef, children }: {
  messageListRef: RefObject<HTMLElement | null>; children: ReactNode;
}) {
  return <MessageListContext.Provider value={messageListRef}>{children}</MessageListContext.Provider>;
}

/** Only the dialog and the message viewport (list + minimap) receive pointer events. */
export function SessionDialog({ ref, style, className, ...props }: ComponentPropsWithRef<"div">) {
  const drag = useDialogDrag();
  const bounds = useDialogMessageBounds(useContext(MessageListContext));
  useImperativeHandle(ref, () => drag.ref.current!, []);
  const blockers: CSSProperties[] = bounds ? [
    { top: 0, left: 0, right: 0, height: bounds.top },
    { top: bounds.bottom, left: 0, right: 0, bottom: 0 },
    { top: bounds.top, left: 0, width: bounds.left, height: bounds.bottom - bounds.top },
    { top: bounds.top, left: bounds.right, right: 0, height: bounds.bottom - bounds.top },
  ] : [{ inset: 0 }];

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="session-dialog-layer">
      {blockers.map((blocker, index) => (
        <div key={index} aria-hidden="true" className="session-dialog-blocker" style={blocker} />
      ))}
      <InteractionSurface
        {...props}
        {...drag}
        aria-modal={false}
        className={`session-dialog ${className ?? ""}`}
        style={{ pointerEvents: "auto", ...style }}
      />
    </div>,
    document.body,
  );
}

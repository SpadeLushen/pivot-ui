"use client";

import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";
import { BackdropDismissGesture, isBackdropPoint } from "@/lib/backdrop-dismiss";

/** Spread on the backdrop (or native dialog), not on its content panel. */
export function useBackdropDismiss(onClose: () => void) {
  const gesture = useRef(new BackdropDismissGesture());

  useEffect(() => {
    const current = gesture.current;
    const reset = () => current.cancel();
    window.addEventListener("blur", reset);
    return () => { window.removeEventListener("blur", reset); reset(); };
  }, []);

  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      gesture.current.press(event, isBackdropPoint(event.currentTarget, event.clientX, event.clientY));
    },
    onPointerUpCapture(event: PointerEvent<HTMLElement>) {
      gesture.current.release(event.pointerId, isBackdropPoint(event.currentTarget, event.clientX, event.clientY));
    },
    onPointerCancelCapture() { gesture.current.cancel(); },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      // Consume the complete gesture at click time, rather than unmounting
      // during pointerup and letting its click fall through to the page.
      if (gesture.current.consumeClick() && event.button === 0 && event.detail > 0) onClose();
    },
  };
}

"use client";

import { useEffect, useState, type RefObject } from "react";

type Bounds = { top: number; right: number; bottom: number; left: number };

/** A missing/hidden message list never opens background interaction. */
export function useDialogMessageBounds(messageListRef: RefObject<HTMLElement | null> | null) {
  const [bounds, setBounds] = useState<Bounds | null>(null);

  // Run after all sibling refs attach. The welcome layout can mount/unmount
  // the list without changing the ref object, so rebind on commits too.
  useEffect(() => {
    const element = messageListRef?.current;
    const update = () => {
      const rect = element?.getBoundingClientRect();
      const next = rect && rect.width > 0 && rect.height > 0 ? {
        top: Math.max(0, Math.min(window.innerHeight, rect.top)),
        right: Math.max(0, Math.min(window.innerWidth, rect.right)),
        bottom: Math.max(0, Math.min(window.innerHeight, rect.bottom)),
        left: Math.max(0, Math.min(window.innerWidth, rect.left)),
      } : null;
      setBounds((previous) => previous?.top === next?.top && previous?.right === next?.right
        && previous?.bottom === next?.bottom && previous?.left === next?.left ? previous : next);
    };
    update();
    const observer = new ResizeObserver(update);
    if (element) observer.observe(element);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  });

  return bounds;
}

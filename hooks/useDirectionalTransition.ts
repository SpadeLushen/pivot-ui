"use client";

import { useLayoutEffect, useRef } from "react";

/** Animate navigation changes, never initial mounts or parent visibility changes. */
export function useDirectionalTransition(
  value: string | boolean,
  direction: "forward" | "backward",
  enabled = true,
) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(value);

  useLayoutEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    const element = ref.current;
    if (!enabled || !element?.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const offset = direction === "forward" ? 24 : -24;
    const animation = element.animate([
      { opacity: 0, transform: `translateX(${offset}px)` },
      { opacity: 1, transform: "none" },
    ], {
      duration: 220,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    });
    return () => animation.cancel();
  }, [value, direction, enabled]);

  return ref;
}

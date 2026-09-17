"use client";

import { useCallback } from "react";
import { usePreferences } from "@/lib/preferences-context";
import type { Theme } from "@/lib/preferences-types";

export type { Theme } from "@/lib/preferences-types";

type ToggleOrigin = { x: number; y: number };

export function useTheme() {
  const { preferences, updatePreferences } = usePreferences();
  const theme = preferences.theme;

  const setTheme = useCallback((next: Theme, origin?: ToggleOrigin) => {
    const apply = () => {
      document.documentElement.classList.remove("dark", "eye");
      if (next !== "light") document.documentElement.classList.add(next);
      void updatePreferences({ theme: next }).catch(() => undefined);
    };

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";

    if (!supportsVT || reduceMotion) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 450,
            easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        // transition cancelled — ignore
      });
  }, [updatePreferences]);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "eye" : "light";
    setTheme(next, origin);
  }, [setTheme, theme]);

  return { theme, toggleTheme, setTheme, isDark: theme === "dark" };
}

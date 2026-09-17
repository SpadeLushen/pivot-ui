"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
  type PreferencePatch,
  type UserPreferences,
} from "./preferences-types";

interface PreferencesContextValue {
  preferences: UserPreferences;
  ready: boolean;
  refresh: () => Promise<UserPreferences | null>;
  updatePreferences: (patch: PreferencePatch) => Promise<UserPreferences>;
}

const PreferencesContext = createContext<PreferencesContextValue>({
  preferences: DEFAULT_PREFERENCES,
  ready: false,
  refresh: async () => null,
  updatePreferences: async () => DEFAULT_PREFERENCES,
});

interface PreferencesProviderProps {
  children: React.ReactNode;
  initialPreferences?: UserPreferences;
}

export function PreferencesProvider({ children, initialPreferences }: PreferencesProviderProps) {
  const [preferences, setPreferences] = useState<UserPreferences>(() =>
    initialPreferences ? normalizePreferences(initialPreferences) : { ...DEFAULT_PREFERENCES },
  );
  const [ready, setReady] = useState(Boolean(initialPreferences));
  const preferencesRef = useRef(preferences);
  const operationsRef = useRef<Promise<unknown>>(Promise.resolve());

  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const run = operationsRef.current.then(operation);
    operationsRef.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);

  const refresh = useCallback(() => enqueue(async () => {
    try {
      const response = await fetch("/api/preferences", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = normalizePreferences(await response.json());
      preferencesRef.current = next;
      setPreferences(next);
      setReady(true);
      return next;
    } catch {
      setReady(true);
      return null;
    }
  }), [enqueue]);

  const updatePreferences = useCallback((patch: PreferencePatch) => enqueue(async () => {
    const previous = preferencesRef.current;
    const optimistic = normalizePreferences({ ...previous, ...patch });
    preferencesRef.current = optimistic;
    setPreferences(optimistic);
    setReady(true);
    try {
      const response = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = normalizePreferences(await response.json());
      preferencesRef.current = next;
      setPreferences(next);
      return next;
    } catch (error) {
      preferencesRef.current = previous;
      setPreferences(previous);
      throw error;
    }
  }), [enqueue]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A focused window should immediately observe a change made from another
  // device. Polling covers devices that remain open without being refocused.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    const interval = window.setInterval(refreshIfVisible, 30_000);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "eye");
    if (preferences.theme !== "light") root.classList.add(preferences.theme);
  }, [preferences.theme]);

  const value = useMemo(() => ({ preferences, ready, refresh, updatePreferences }), [preferences, ready, refresh, updatePreferences]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  return useContext(PreferencesContext);
}

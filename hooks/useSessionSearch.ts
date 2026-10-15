"use client";

import { useEffect, useMemo, useState } from "react";
import { usePreferences } from "@/lib/preferences-context";
import { sessionTitle } from "@/lib/session-display";
import type { SessionInfo } from "@/lib/types";
import type { SessionSearchStatus } from "@/lib/session-search-types";

export function useSessionSearch(sessions: SessionInfo[], query: string) {
  const { preferences } = usePreferences();
  const enabled = preferences["session-search-enabled"];
  const [phrase, setPhrase] = useState("");
  const [result, setResult] = useState<{ query: string; path: string; ids: string[]; indexing: boolean; error: string }>({
    query: "", path: "", ids: [], indexing: false, error: "",
  });
  useEffect(() => {
    const timer = setTimeout(() => setPhrase(query.trim()), 500);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!enabled || !phrase) {
      setResult({ query: "", path: "", ids: [], indexing: false, error: "" });
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch("/api/session-search?q=" + encodeURIComponent(phrase), {
          signal: controller.signal, cache: "no-store",
        });
        const data = await response.json() as { ids?: string[]; status?: SessionSearchStatus; error?: string };
        if (!response.ok) throw new Error(data.error ?? String(response.status));
        if (controller.signal.aborted) return;
        setResult({ query: phrase, path: preferences["session-search-path"], ids: data.ids ?? [], indexing: data.status?.indexing ?? false, error: data.status?.error ?? "" });
        timer = setTimeout(() => void load(), data.status?.indexing ? 2000 : 15_000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setResult({ query: phrase, path: preferences["session-search-path"], ids: [], indexing: false, error: String(error) });
        timer = setTimeout(() => void load(), 15_000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [phrase, enabled, preferences["session-search-path"]]);
  const current = enabled && result.query === phrase && result.path === preferences["session-search-path"] ? result : null;
  const matches = useMemo(() => {
    if (!phrase) return sessions;
    const ids = new Set(current?.ids ?? []);
    const needle = phrase.toLowerCase();
    return sessions.filter((session) => ids.has(session.id) || sessionTitle(session).toLowerCase().includes(needle));
  }, [sessions, phrase, current]);
  return {
    phrase, matches, enabled,
    indexing: current?.indexing ?? false,
    error: current?.error ?? "",
    pending: query.trim() !== phrase || Boolean(enabled && phrase && !current),
  };
}

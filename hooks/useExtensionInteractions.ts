"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ExtensionUiInteraction, ExtensionUiResponse, ExtensionUiSnapshot } from "@/lib/types";

export interface ExtensionInteractionItem {
  request: ExtensionUiInteraction;
  value: string;
  submitting: boolean;
  failed: boolean;
}
type Reply = Omit<Extract<ExtensionUiResponse, { value: string }>, "type" | "id">
  | { confirmed: boolean } | { cancelled: true };

// Tab-memory only: returning to a session can restore unanswered input, never stale requests.
const interactionDrafts = new Map<string, { runtimeId: string; values: Map<string, string> }>();

/** LiveSession-owned interaction state. No DOM or independent event transport. */
export function useExtensionInteractions(sessionId: RefObject<string | null>) {
  const [items, setItems] = useState<ExtensionInteractionItem[]>([]);
  const current = useRef(items);
  const version = useRef({ runtimeId: "", revision: -1 });
  const retiredRuntimes = useRef(new Set<string>());
  const alive = useRef(true);
  const customQueue = useRef(Promise.resolve());
  const publish = useCallback((next: ExtensionInteractionItem[]) => {
    if (!alive.current) return;
    current.current = next;
    const sid = sessionId.current;
    if (sid && version.current.runtimeId) {
      if (next.length) interactionDrafts.set(sid, { runtimeId: version.current.runtimeId,
        values: new Map(next.map(item => [item.request.id, item.value])) });
      else interactionDrafts.delete(sid);
    }
    setItems(next);
  }, [sessionId]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const applySnapshot = useCallback((snapshot: ExtensionUiSnapshot, expectedRuntime?: string) => {
    if (!alive.current || snapshot.sessionId !== sessionId.current) return;
    if (expectedRuntime !== undefined && version.current.runtimeId !== expectedRuntime) return;
    if (retiredRuntimes.current.has(snapshot.runtimeId)) return;
    if (snapshot.runtimeId === version.current.runtimeId && snapshot.revision <= version.current.revision) return;
    const previous = snapshot.runtimeId === version.current.runtimeId ? current.current : [];
    const cached = interactionDrafts.get(snapshot.sessionId);
    const values = cached?.runtimeId === snapshot.runtimeId ? cached.values : undefined;
    if (version.current.runtimeId && version.current.runtimeId !== snapshot.runtimeId) retiredRuntimes.current.add(version.current.runtimeId);
    version.current = { runtimeId: snapshot.runtimeId, revision: snapshot.revision };
    publish(snapshot.requests.map(request => {
      const old = previous.find(item => item.request.id === request.id);
      return old ? { ...old, request } : { request,
        value: values?.get(request.id) ?? (request.method === "editor" ? request.prefill ?? "" : ""), submitting: false, failed: false };
    }));
  }, [publish, sessionId]);

  const change = useCallback((id: string, patch: Partial<ExtensionInteractionItem>) => {
    publish(current.current.map(item => item.request.id === id ? { ...item, ...patch } : item));
  }, [publish]);
  const setValue = useCallback((id: string, value: string) => change(id, { value }), [change]);

  const respond = useCallback(async (request: ExtensionUiInteraction, response: Reply) => {
    const sid = sessionId.current;
    const runtimeId = version.current.runtimeId;
    const active = current.current.at(-1);
    if (!sid || active?.request.id !== request.id || active.submitting) return;
    change(request.id, { submitting: true, failed: false });
    try {
      const snapshot = await sendAgentCommand<ExtensionUiSnapshot>(sid, {
        type: "extension_ui_response", id: request.id, ...response,
      });
      applySnapshot(snapshot, runtimeId);
    } catch {
      if (alive.current && sessionId.current === sid && version.current.runtimeId === runtimeId) {
        change(request.id, { failed: true });
      }
    } finally {
      if (alive.current && sessionId.current === sid && version.current.runtimeId === runtimeId) {
        change(request.id, { submitting: false });
      }
    }
  }, [applySnapshot, change, sessionId]);

  const sendCustomInput = useCallback((request: ExtensionUiInteraction, data: string) => {
    const sid = sessionId.current;
    const runtimeId = version.current.runtimeId;
    const send = async () => {
      if (!alive.current || sessionId.current !== sid || version.current.runtimeId !== runtimeId ||
          current.current.at(-1)?.request.id !== request.id || !sid) return;
      try {
        const snapshot = await sendAgentCommand<ExtensionUiSnapshot>(sid, {
          type: "extension_ui_input", id: request.id, data,
        });
        applySnapshot(snapshot, runtimeId);
        if (version.current.runtimeId === runtimeId) change(request.id, { failed: false });
      } catch {
        if (alive.current && sessionId.current === sid && version.current.runtimeId === runtimeId) change(request.id, { failed: true });
      }
    };
    customQueue.current = customQueue.current.then(send, send);
    return customQueue.current;
  }, [applySnapshot, change, sessionId]);

  const refresh = useCallback(async () => {
    const sid = sessionId.current;
    const runtimeId = version.current.runtimeId;
    if (!sid) return;
    try {
      const response = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
      if (!response.ok) return;
      const result = await response.json() as { running?: boolean; state?: { extensionUi?: ExtensionUiSnapshot } };
      if (!alive.current || sessionId.current !== sid || version.current.runtimeId !== runtimeId) return;
      if (result.state?.extensionUi) applySnapshot(result.state.extensionUi, runtimeId);
      else if (result.running === false) publish([]);
    } catch { /* SSE reconnect/focus will retry; retain unanswered questions. */ }
  }, [applySnapshot, publish, sessionId]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { items, active: items.at(-1) ?? null, applySnapshot, setValue, respond, sendCustomInput };
}

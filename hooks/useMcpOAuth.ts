"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeMcpAuthEvent } from "@/lib/native-mcp-management-types";

interface AuthState { running: boolean; manual: boolean; url?: string; ready?: boolean; error?: string }
interface AuthRun { controller: AbortController; cwd: string; serverKey: string; token?: string; popup: Window | null; opened: boolean }
const INITIAL: AuthState = { running: false, manual: false };
export function useMcpOAuth(cwd: string, serverKey: string, onSuccess: () => void) {
  const [auth, setAuth] = useState<AuthState>(INITIAL);
  const runRef = useRef<AuthRun | null>(null), onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const cancel = useCallback((update = true) => {
    const run = runRef.current; runRef.current = null;
    if (run) {
      if (run.token) void fetch("/api/mcp/auth", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: run.cwd, serverKey: run.serverKey, action: "cancel", token: run.token }), keepalive: true }).catch(() => undefined);
      run.controller.abort();
      if (!run.opened) run.popup?.close();
    }
    if (update) setAuth(INITIAL);
  }, []);
  useEffect(() => () => cancel(false), [cancel]);
  const start = useCallback(async () => {
    if (runRef.current) return;
    const hostname = window.location.hostname.toLowerCase();
    const manual = !["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
    // Open synchronously under the click gesture; delayed window.open would be popup-blocked.
    let popup: Window | null = null;
    try { popup = window.open("about:blank", "_blank"); if (popup) popup.opener = null; }
    catch { /* The authorization link remains available if a browser blocks the popup. */ }
    const run: AuthRun = { controller: new AbortController(), cwd, serverKey, popup, opened: false };
    runRef.current = run; setAuth({ running: true, manual });
    let terminal = false;
    const event = (data: NativeMcpAuthEvent) => {
      if (runRef.current !== run) return;
      if (data.type === "started") run.token = data.token;
      else if (data.type === "auth") {
        const url = new URL(data.url);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("mcp.oauthFailed");
        try { if (popup && !popup.closed) { popup.location.replace(url.href); run.opened = true; } }
        catch { /* Let the user open the displayed authorization link instead. */ }
        setAuth((value) => ({ ...value, url: url.href }));
      } else if (data.type === "prompt") setAuth((value) => ({ ...value, ready: true }));
      else if (data.type === "success") {
        terminal = true; runRef.current = null; setAuth(INITIAL);
        if (!run.opened) popup?.close();
        onSuccessRef.current();
      } else if (data.type === "cancelled" || data.type === "error") {
        terminal = true; runRef.current = null;
        setAuth({ running: false, manual, ...(data.type === "error" ? { error: data.message } : {}) });
        if (!run.opened) popup?.close();
      }
    };
    try {
      const response = await fetch("/api/mcp/auth", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, serverKey, action: "start" }), signal: run.controller.signal });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error ?? "mcp.oauthFailed"); }
      if (!response.body) throw new Error("mcp.oauthDisconnected");
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "";
      while (!terminal) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 65536) throw new Error("mcp.oauthFailed");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const payload = frame.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
          if (payload) event(JSON.parse(payload) as NativeMcpAuthEvent);
        }
      }
      await reader.cancel().catch(() => undefined);
      if (!terminal && !run.controller.signal.aborted) throw new Error("mcp.oauthDisconnected");
    } catch (error) {
      if (runRef.current !== run) return;
      cancel(false);
      setAuth({ running: false, manual, error: error instanceof Error ? error.message : "mcp.oauthFailed" });
    }
  }, [cwd, serverKey]);

  const submit = useCallback(async (url: string) => {
    const run = runRef.current;
    if (!run?.token) throw new Error("mcp.oauthNotReady");
    const response = await fetch("/api/mcp/auth", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: run.cwd, serverKey: run.serverKey, action: "callback", token: run.token, url }), signal: run.controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "mcp.oauthFailed");
    if (runRef.current === run) setAuth((value) => ({ ...value, ready: false }));
  }, []);
  return { auth, start, cancel, submit };
}

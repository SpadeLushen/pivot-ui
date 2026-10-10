import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { useAgentSession } from "../../hooks/useAgentSession";
window.pending = []; window.ends = 0; window.busy = false;
window.EventSource = class {
  static OPEN = 1; static CLOSED = 2;
  readyState = 1;
  constructor(url) { this.url = url; setTimeout(() => this.emit({ type: "connected" }), 0); }
  emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  close() { this.readyState = 2; }
};
const context = () => ({ messages: [], entryIds: [], model: { provider: "router", modelId: "auto" },
  selectedModel: { provider: "router", modelId: "auto", virtual: true }, routedModel: null });
window.fetch = async (input, init = {}) => {
  const url = new URL(input, location.href), body = init.body && JSON.parse(init.body);
  if (body?.type === "prompt") return new Promise(resolve => window.pending.push(data => resolve(Response.json(data,
    { status: data.error ? 500 : 200 }))));
  if (init.method === "POST") return Response.json({ success: true, data: [] });
  if (url.pathname === "/api/models") return Response.json({ models: {}, modelList: [], typedCatalog: [
    { type: "chat", provider: "router", id: "auto", virtual: true } ] });
  if (url.pathname.endsWith("/stats")) return Response.json({ sessionId: "a", cost: 0 });
  if (url.pathname.startsWith("/api/sessions/")) return Response.json({ sessionId: "a", tree: [], leafId: null, context: context() });
  if (url.pathname.startsWith("/api/agent/")) return Response.json({ running: true, state: {
    isStreaming: window.busy, isPromptRunning: window.busy, queuedMessages: { steering: [], followUp: [] } } });
  return Response.json({ revision: 0 });
};
function ChatHarness({ sid }) {
  const hook = useAgentSession({ session: { id: sid, cwd: "/fixture", name: sid },
    newSessionCwd: null, onAgentEnd: () => window.ends++ });
  window.chat = hook;
  window.send = () => { window.sendResult = null; hook.handleSend("input").then(r => { window.sendResult = r; }); };
  window.emit = event => hook.eventSourceRef.current.emit(event);
  return <div>{JSON.stringify({ sending: hook.inputSending, running: hook.agentRunning,
    messages: hook.messages.length, notices: hook.notices.length })}</div>;
}
function Harness() {
  const [sid, setSid] = useState("a"); window.setSid = setSid;
  return <ChatHarness key={sid} sid={sid} />;
}
createRoot(document.getElementById("app")).render(<Harness />);

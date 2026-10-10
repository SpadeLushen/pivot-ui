import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { useSessionStatistics } from "../../hooks/useSessionStatistics";
import { useWorkspaceTrust } from "../../hooks/useWorkspaceTrust";
import { useToolSettingsEditor } from "../../hooks/useToolSettingsEditor";
import { CodemodeSettings } from "../../components/tools/CodemodeSettings";
import { ToolResultContent } from "../../components/ToolResultContent";
window.requests = []; window.pendingStats = []; window.pendingTrust = [];
const snapshot = () => ({ revision: "w1", globalRevision: "g1", tools: [],
  orchestration: { revision: "ow1", globalRevision: "og1", mode: "only", inlineBudget: 0,
    inherited: { mode: "on", inlineBudget: 3000 }, trusted: true, nativeState: "available" } });
window.fetch = (input, init = {}) => {
  const url = new URL(input, location.href), method = init.method ?? "GET";
  window.requests.push({ path: url.pathname, query: url.search, method, body: init.body && JSON.parse(init.body) });
  if (url.pathname.endsWith("/stats")) {
    if (window.deferStats) return new Promise(resolve => window.pendingStats.push(data => resolve(Response.json(data))));
    return Promise.resolve(Response.json(window.statsData ?? { sessionId: url.pathname.split("/")[3], cost: 1, tokens: { total: 18 } },
      { status: window.failStats ? 503 : 200 }));
  }
  if (url.pathname === "/api/workspace-trust") {
    if (method === "POST") { window.trusted = true; return Promise.resolve(Response.json({ trusted: true })); }
    if (window.deferTrust) return new Promise(resolve => window.pendingTrust.push(trusted => resolve(Response.json({ trusted }))));
    return Promise.resolve(Response.json({ trusted: !!window.trusted }));
  }
  return Promise.resolve(Response.json(window.failSave ? { error: "conflict" } : snapshot(), { status: window.failSave ? 409 : 200 }));
};

const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const result = { toolCallId: "parent", content: [
  { type: "text", text: "Script completed\nWall time 0 seconds\nOutput:\nfirst" },
  { type: "image", mimeType: "image/png", data: pixel }, { type: "text", text: "last" }],
  details: { structuredContent: { bounded: true } } };
function Harness() {
  const [sid, setSid] = useState("a"), [leaf, setLeaf] = useState(null), [live, setLive] = useState(false);
  const [run, setRun] = useState(1), [revision, setRevision] = useState(0);
  const [cwd, setCwd] = useState("/fixture/a"), [open, setOpen] = useState(true), [config, setConfig] = useState(snapshot);
  const stats = useSessionStatistics(sid, leaf, live, revision, run);
  const trust = useWorkspaceTrust(cwd, open);
  const editor = useToolSettingsEditor({ cwd, scope: cwd, snapshot: config,
    onUpdated: setConfig, onClose: () => setOpen(false), onRefresh: () => {} });
  window.controls = { setSid, setLeaf, setLive, setRun, setRevision, setCwd, setOpen, setConfig };
  window.statistics = stats.stats; window.refreshStats = stats.refresh;
  window.trust = trust; window.editor = editor; window.config = config;
  return <div id="stage-c">
    <CodemodeSettings settings={editor.viewSnapshot.orchestration} draft={editor.draft?.codemode}
      withWorkspaceOverrides={editor.target === "workspace"} disabled={!!editor.saving} onChange={editor.editCodemode} />
    <div id="output"><ToolResultContent result={result} outputLayouts /></div>
  </div>;
}
createRoot(document.getElementById("app")).render(<Harness />);


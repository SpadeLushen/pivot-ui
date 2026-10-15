import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useModelCatalogRefresh } from "../../hooks/useModelCatalogRefresh";
import { ModelCatalogRefreshNotice } from "../../components/ModelCatalogRefreshNotice";
import { normalizeCustomPanelLines, parseAnsiLine } from "../ansi";
window.pendingRefresh = []; window.reloads = 0; window.snapshotFailure = false;
window.catalogValues = { a: "cached-a", b: "cached-b" };
window.fetch = (input, init = {}) => {
  const url = new URL(input, location.href);
  if (url.pathname !== "/api/models/refresh") throw Error("Unexpected fixture request");
  return new Promise(resolve => window.pendingRefresh.push({ body: JSON.parse(init.body), signal: init.signal,
    finish: data => resolve(Response.json(data, { status: data.status ?? 200 })) }));
};
function RefreshHarness({ provider }) {
  const [catalog, setCatalog] = useState(window.catalogValues[provider]);
  const [status, setStatus] = useState({ state: "cached" });
  useEffect(() => { setCatalog(window.catalogValues[provider]); setStatus({ state: "cached" }); }, [provider]);
  const reload = useCallback(async signal => {
    signal.throwIfAborted(); window.reloads++;
    if (window.snapshotFailure) throw Error("private-snapshot-error");
    setCatalog(window.catalogValues[provider]); setStatus(window.resultStatus ?? { state: "fresh" });
  }, [provider]);
  const hook = useModelCatalogRefresh(provider, "/fixture/" + provider, reload);
  window.refreshApi = { ...hook, provider };
  window.beginRefresh = force => {
    const promise = hook.refresh(force);
    window.refreshResult = null; promise.then(value => { window.refreshResult = value; });
    return promise;
  };
  const raw = ["┌─────┐", "│ 前\x1b_pi:c\x07\x1b_pi:fc\x07🙂\x1b_pi:/fc\x07后 │", "└─────┘"];
  return <div>
    <div id="catalog">{catalog}</div>
    <ModelCatalogRefreshNotice status={status} refreshing={hook.refreshing} error={hook.refreshError}
      onRefresh={() => { void hook.refresh(true); }} />
    <pre id="cursor">{normalizeCustomPanelLines(raw).map((line, index) => <React.Fragment key={index}>
      {parseAnsiLine(line).map((segment, i) => <span key={i} style={segment.style}>{segment.text}</span>)}
    </React.Fragment>)}</pre>
  </div>;
}
function Harness() {
  const [provider, setProvider] = useState("a"), [mounted, setMounted] = useState(true);
  window.setProvider = setProvider; window.unmountRefresh = () => setMounted(false);
  return mounted ? <RefreshHarness provider={provider} /> : <div>unmounted</div>;
}
document.documentElement.style.setProperty("--text", "#ffffff");
document.documentElement.style.setProperty("--bg", "#000000");
createRoot(document.getElementById("app")).render(<Harness />);

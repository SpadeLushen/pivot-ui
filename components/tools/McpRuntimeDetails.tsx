"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeMcpEditorServer } from "@/lib/api-types";
import type { McpResourceSummary, NativeMcpResourcesSnapshot } from "@/lib/native-mcp-management-types";
import { useI18n } from "@/lib/i18n";
import { useMcpOAuth } from "@/hooks/useMcpOAuth";
import { McpOAuthDialog } from "./McpOAuthDialog";
import { ToolError } from "./ToolsControls";

export function McpRuntimeDetails({ cwd, server }: { cwd: string; server: NativeMcpEditorServer }) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<NativeMcpResourcesSnapshot | null>(null);
  const [status, setStatus] = useState<NativeMcpResourcesSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const authenticated = useCallback(() => setRefresh((value) => value + 1), []);
  const { auth, start, cancel, submit } = useMcpOAuth(cwd, server.serverKey, authenticated);
  const eligible = !!cwd && server.enabled && !server.validationError;
  const connection = typeof server.definition.url === "string" ? server.definition.url
    : [server.definition.command, ...Array.isArray(server.definition.args) ? server.definition.args : []].join(" ");
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    setSnapshot(null); setError(null); setLoading(eligible);
    // Read credential presence independently of connecting/listing, including disabled servers.
    if (cwd && !server.validationError) void fetch("/api/mcp/resources", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, serverKey: server.serverKey, statusOnly: true }), signal: abort.signal,
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "mcp.managementFailed");
      if (!abort.signal.aborted) setStatus(data);
    }).catch((reason) => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "mcp.managementFailed"); });
    if (eligible) void fetch("/api/mcp/resources", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, serverKey: server.serverKey }), signal: abort.signal,
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "mcp.managementFailed");
      if (!abort.signal.aborted) setSnapshot(data);
    }).catch((reason) => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "mcp.managementFailed"); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => { abort.abort(); };
  }, [cwd, server.serverKey, server.validationError, eligible, refresh]);

  const more = async (kind: "resources" | "templates") => {
    const abort = controller.current;
    if (!snapshot || !abort || abort.signal.aborted || loading) return;
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/mcp/resources", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, serverKey: server.serverKey, ...(kind === "resources" ? { resourcesCursor: snapshot.resourcesCursor } : { templatesCursor: snapshot.templatesCursor }) }),
        signal: abort.signal });
      const data = await response.json() as NativeMcpResourcesSnapshot & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "mcp.managementFailed");
      if (abort.signal.aborted) return;
      if (data.state !== "connected") { setSnapshot(data); return; }
      setSnapshot({ ...snapshot, ...(kind === "resources" ? {
        resources: data.resourcesError ? [] : [...snapshot.resources, ...data.resources].slice(0, 1000), resourcesCursor: data.resourcesCursor, resourcesError: data.resourcesError,
      } : {
        resourceTemplates: data.templatesError ? [] : [...snapshot.resourceTemplates, ...data.resourceTemplates].slice(0, 1000), templatesCursor: data.templatesCursor, templatesError: data.templatesError,
      }) });
    } catch {
      if (!abort.signal.aborted) {
        setSnapshot((value) => value ? { ...value, ...(kind === "resources" ? { resources: [], resourcesCursor: undefined } : { resourceTemplates: [], templatesCursor: undefined }) } : value);
      }
    }
    finally { if (!abort.signal.aborted) setLoading(false); }
  };
  const hasCredentials = !!(status?.hasOAuthCredentials || snapshot?.hasOAuthCredentials);
  const showAuth = hasCredentials || !!snapshot?.oauthRequired || !!status?.oauthConfigured || !!server.definition.oauth;
  const oauthAvailable = status?.oauthAvailable ?? snapshot?.oauthAvailable;
  const showResources = snapshot?.state === "connected" && !snapshot.resourcesError && snapshot.resources.length > 0;
  const showTemplates = snapshot?.state === "connected" && !snapshot.templatesError && snapshot.resourceTemplates.length > 0;
  return <>
    <section className="tools-mcp-connection">
      <div className="tools-detail-heading"><h3>{t("mcp.connection")}</h3>
        <span className="tools-badge">{!server.enabled ? t("mcp.disabled") : loading && !snapshot ? t("mcp.state.connecting") : snapshot ? t(`mcp.state.${snapshot.state}`) : ""}</span>
        <button type="button" disabled={loading || auth.running || !cwd || !!server.validationError} onClick={() => setRefresh((value) => value + 1)}>{t("general.refresh")}</button>
        {showAuth && <button type="button" disabled={auth.running || !eligible || oauthAvailable === false || server.definition.exposure === "hidden"}
          title={oauthAvailable === false ? t("mcp.oauthAuthConflict") : undefined} onClick={() => void start()}>{t(hasCredentials ? "mcp.reauthenticate" : "mcp.authenticate")}</button>}
        {auth.running && <button type="button" onClick={() => cancel()}>{t("general.cancel")}</button>}
      </div>
      <div className="tools-connection-line"><code>{connection}</code></div>
      <ToolError error={error ? t(error) : snapshot?.error ? t(snapshot.error) : null} />
      {snapshot?.oauthRequired && <p className="tools-help">{t("mcp.authRequired")}</p>}
    </section>
    {auth.running && <p className="tools-help">{t("mcp.authWaiting")}{auth.url && <> · <a href={auth.url} target="_blank" rel="noopener noreferrer">{t("mcp.openAuthorization")}</a></>}</p>}
    <ToolError error={auth.error ? t(auth.error) : null} />
    {auth.running && auth.manual && <McpOAuthDialog url={auth.url} ready={!!auth.ready} onSubmit={submit} onCancel={() => cancel()} />}
    {eligible && snapshot && (showResources || showTemplates) && <section className="tools-mcp-resources">
      <div className="tools-detail-heading"><h3>{t("mcp.resources")}</h3></div>
      {showResources && <>
        <ResourceItems items={snapshot.resources} />
        {snapshot.resourcesCursor && snapshot.resources.length < 1000 && <button type="button" disabled={loading || auth.running} onClick={() => void more("resources")}>{t("mcp.loadMoreResources")}</button>}
      </>}
      {showTemplates && <>
        <h4>{t("mcp.resourceTemplates")}</h4>
        <ResourceItems items={snapshot.resourceTemplates} />
        {snapshot.templatesCursor && snapshot.resourceTemplates.length < 1000 && <button type="button" disabled={loading || auth.running} onClick={() => void more("templates")}>{t("mcp.loadMoreResources")}</button>}
      </>}
      {(snapshot.resources.length >= 1000 || snapshot.resourceTemplates.length >= 1000) && <p className="tools-help">{t("mcp.resourceDisplayLimit")}</p>}
    </section>}
    {!cwd && server.enabled && <p className="tools-help">{t("mcp.workspaceRequired")}</p>}
  </>;
}

function ResourceItems({ items }: { items: McpResourceSummary[] }) {
  return <ul className="tools-resource-list">{items.map((item, index) => <li key={`${item.uri ?? item.uriTemplate ?? item.name}:${index}`}>
    <strong>{item.title || item.name}</strong>{item.mimeType && <span className="tools-badge">{item.mimeType}</span>}
    <code>{item.uri ?? item.uriTemplate}</code>{item.description && <p className="tools-help">{item.description}</p>}
  </li>)}</ul>;
}

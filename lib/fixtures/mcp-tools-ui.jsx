import React from "react";
import { createRoot } from "react-dom/client";
import { McpPanel } from "../../components/tools/McpPanel";
const MASK = "<redacted:unchanged>";
const server = (serverKey, extra = {}) => ({ serverKey, name: serverKey, description: "", source: "global", inherited: true,
  definition: { url: "https://fixture.invalid/mcp" }, enabled: true, managedByPack: false, editScope: "global", ...extra });
let servers = [
  server("plain"),
  server("secret", { enabled: false, definition: { url: "https://fixture.invalid/mcp", headers: { "X-Key": MASK } } }),
  server("explicit", { definition: { url: "https://fixture.invalid/mcp", oauth: {} } }),
  server("detected"), server("expired"), server("broken"), server("resources"), server("templates"),
  server("both"), server("slow"),
  server("override", { source: "project", inherited: false, overridesGlobal: true, workspaceDefinition: { enabled: true } }),
  server("pack", { source: "project", inherited: false, overridesGlobal: true, managedByPack: true, workspaceDefinition: { enabled: true } }),
];
let revision = 0, authStream;
window.requests = []; window.opened = []; window.confirms = [];
window.confirm = text => { window.confirms.push(text); return true; };
window.open = () => ({ opener: null, closed: false, location: { replace: url => window.opened.push(url) }, close() {} });
const response = data => Promise.resolve(Response.json(data));
function resourceData(key) {
  return { serverKey: key, state: key === "detected" ? "needs-auth" : "connected", oauthRequired: key === "detected", oauthAvailable: true,
    oauthConfigured: key === "explicit", hasOAuthCredentials: key === "expired", resourcesSupported: true,
    resources: ["resources", "both"].includes(key) ? [{ name: "Guide", uri: "file://guide" }] : [],
    ...(["resources", "both"].includes(key) ? { resourcesCursor: "resource-second" } : {}),
    resourceTemplates: ["templates", "both"].includes(key) ? [{ name: "Template", uriTemplate: "file://{id}" }] : [],
    ...(key === "broken" ? { resourcesError: "mcp.resourceListFailed", templatesError: "mcp.templateListFailed" } : {}) };
}
window.fetch = (input, init = {}) => {
  const url = new URL(input, location.href), body = init.body ? JSON.parse(init.body) : {};
  window.requests.push({ path: url.pathname, method: init.method || "GET", body });
  if (url.pathname === "/api/mcp/servers") {
    if (init.method === "DELETE") {
      servers = servers.map(s => s.serverKey === body.serverKey ? { ...s, source: "global", inherited: true, overridesGlobal: false, workspaceDefinition: undefined } : s);
      revision++;
    } else if (["POST", "PATCH"].includes(init.method)) {
      servers = servers.map(s => s.serverKey === body.serverKey ? { ...s, definition: body.definition ?? s.definition, enabled: body.enabled ?? s.enabled } : s);
      revision++;
    }
    return response({ scope: url.searchParams.get("scope") || "project", revision: String(revision), filePath: "fixture/mcp.json",
      servers: servers.map(s => url.searchParams.get("scope") === "global" ? { ...s, inherited: false } : s) });
  }
  if (url.pathname === "/api/mcp/resources") {
    if (body.serverKey === "slow" && !body.statusOnly) return new Promise(resolve => {
      window.resolveSlow = () => resolve(Response.json({ ...resourceData("slow"), resources: [{ name: "STALE", uri: "file://stale" }] }));
    });
    const data = resourceData(body.serverKey);
    if (body.resourcesCursor) { data.resources = [{ name: "Next guide", uri: "file://next" }]; delete data.resourcesCursor; }
    return response(body.statusOnly ? { ...data, state: "disconnected", oauthRequired: false, resources: [], resourceTemplates: [] } : data);
  }
  if (url.pathname === "/api/mcp/auth") {
    if (body.action === "start") return Promise.resolve(new Response(new ReadableStream({ start(controller) {
      authStream = controller;
      controller.enqueue(new TextEncoder().encode('data: {"type":"started","token":"ui-attempt"}\n\ndata: {"type":"auth","url":"https://fixture.invalid/authorize"}\n\ndata: {"type":"prompt"}\n\n'));
    }}), { headers: { "Content-Type": "text/event-stream" } }));
    authStream?.enqueue(new TextEncoder().encode('data: {"type":"cancelled"}\n\n')); authStream?.close(); authStream = undefined;
    return response({ ok: true });
  }
  throw new Error("Unexpected test fetch: " + input);
};
createRoot(document.getElementById("app")).render(<McpPanel cwd="fixture-workspace" />);

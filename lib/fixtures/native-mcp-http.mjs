import { createServer } from "node:http";
import { createHash } from "node:crypto";

// Local-only protocol/OAuth peer. Never contacts real accounts or providers.
export async function mcpHttpFixture(options = {}) {
  const calls = [], grants = new Map();
  let base;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    const body = text ? (req.headers["content-type"]?.includes("json") ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text))) : {};
    calls.push({ path: url.pathname, method: body.method, body, authorization: req.headers.authorization });
    const json = (value, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    if (oauthReply(url, body, res, json, base, grants, options)) return;
    if (url.pathname !== "/mcp" || req.method !== "POST") { json({}, 405); return; }
    if (options.requireAuth && !req.headers.authorization) {
      res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
      json({}, 401); return;
    }
    if (body.id === undefined) { res.writeHead(202); res.end(); return; }
    const reply = mcpReply(body, options, base);
    json({ jsonrpc: "2.0", id: body.id, ...reply });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, url: `${base}/mcp`, calls,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
function mcpReply(request, options, base) {
  const { method, params = {} } = request;
  if (method === "initialize") return { result: { protocolVersion: "2025-03-26", capabilities: {
    tools: {}, ...(options.resources === false ? {} : { resources: {} }),
  }, serverInfo: { name: "local-http-fixture", version: "1" } } };
  if (method === "tools/list") return { result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] } };
  if (method === "resources/list") {
    if (options.failResources) return { error: { code: -32603, message: "resource fixture unavailable" } };
    return { result: { resources: [{ name: params.cursor ? "second" : "first", uri: base + "/" + (params.cursor || "first") },
      ...(params.cursor ? [] : [{ name: "app", uri: "ui://fixture" }, { name: "app-profile", uri: base + "/app", mimeType: "text/html;profile=mcp-app" }])],
      ...(!params.cursor ? { nextCursor: "second" } : {}) } };
  }
  if (method === "resources/templates/list") return options.templates
    ? { result: { resourceTemplates: [{ name: params.cursor ? "template-second" : "template", uriTemplate: base + "/{id}" },
      { name: "app-template", uriTemplate: "ui://{id}" }], ...(!params.cursor ? { nextCursor: "templates-second" } : {}) } }
    : { error: { code: -32601, message: "method not found" } };
  return { result: {} };
}
function oauthReply(url, body, res, json, base, grants, options) {
  if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
    json({ resource: base + "/mcp", authorization_servers: [base], scopes_supported: ["read"] }); return true;
  }
  if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
    json({ issuer: base, authorization_endpoint: base + "/authorize", token_endpoint: base + "/token",
      registration_endpoint: base + "/register", response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true }); return true;
  }
  if (url.pathname === "/register") { json({ ...body, client_id: "fixture-client" }); return true; }
  if (url.pathname === "/authorize") {
    const code = "fixture-code-" + grants.size;
    grants.set(code, url.searchParams.get("code_challenge"));
    const target = new URL(url.searchParams.get("redirect_uri"));
    target.searchParams.set("code", code); target.searchParams.set("state", url.searchParams.get("state"));
    target.searchParams.set("iss", base);
    res.writeHead(302, { Location: target.href }); res.end(); return true;
  }
  if (url.pathname === "/token") {
    if (body.grant_type !== "authorization_code" || options.failTokens ||
      createHash("sha256").update(body.code_verifier || "").digest("base64url") !== grants.get(body.code)) {
      json({ error: "invalid_grant" }, 400); return true;
    }
    json({ access_token: "fixture-new-access", refresh_token: "fixture-new-refresh", token_type: "Bearer", expires_in: 3600 }); return true;
  }
  return false;
}

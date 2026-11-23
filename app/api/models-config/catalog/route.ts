import { isObject, normalizeProviderCatalog } from "@/lib/provider-catalog";

// Discovery never invokes credential commands, even for an explicitly configured header.
function credential(template: unknown): string {
  if (typeof template !== "string" || template.startsWith("!")) throw new Error();
  return template.replace(/\$(?:([$!])|\{([A-Za-z_][A-Za-z_0-9]*)\}|([A-Za-z_][A-Za-z_0-9]*))/g,
    (_, escaped: string, braced: string, bare: string) => {
      if (escaped) return escaped;
      const value = process.env[braced ?? bare];
      if (!value) throw new Error();
      return value;
    });
}

function requestHeaders(provider: Record<string, unknown>) {
  const headers = new Headers({ Accept: "application/json" });
  if (provider.headers !== undefined) {
    if (!isObject(provider.headers)) throw new Error();
    for (const [name, value] of Object.entries(provider.headers)) headers.set(name, credential(value));
  }
  if (provider.apiKey) {
    const name = provider.authHeader === true ? "Authorization" : provider.api === "anthropic-messages" ? "x-api-key"
      : provider.api === "google-generative-ai" ? "x-goog-api-key" : "Authorization";
    if (!headers.has(name)) {
      const key = credential(provider.apiKey);
      headers.set(name, name === "Authorization" ? `Bearer ${key}` : key);
    }
  }
  if (provider.api === "anthropic-messages" && !headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  return headers;
}

async function readCatalog(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return [];
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8 * 1024 * 1024) { await reader.cancel(); return []; }
    chunks.push(value);
  }
  return normalizeProviderCatalog(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

export async function POST(req: Request) {
  const reply = (models: ReturnType<typeof normalizeProviderCatalog>) =>
    Response.json({ models }, { headers: { "Cache-Control": "no-store" } });
  try {
    if (req.headers.get("sec-fetch-site") === "cross-site" || req.headers.get("content-type")?.split(";")[0] !== "application/json") return reply([]);
    const provider: unknown = await req.json();
    if (!isObject(provider) || typeof provider.baseUrl !== "string") return reply([]);
    const url = new URL(provider.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return reply([]);
    const path = url.pathname.replace(/\/+$/, "");
    url.pathname = path + (path.endsWith("/v1") ? "/models" : "/v1/models");
    url.hash = "";
    const response = await fetch(url, { headers: requestHeaders(provider), redirect: "error", cache: "no-store",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(6000)]) });
    if (!response.ok) { await response.body?.cancel(); return reply([]); }
    return reply(await readCatalog(response));
  } catch {
    // Provider errors and bodies can contain secrets. Discovery is best-effort.
    return reply([]);
  }
}

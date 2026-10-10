export const MCP_SECRET_PLACEHOLDER = "<redacted:unchanged>";

type JsonObject = Record<string, unknown>;
export function isMcpObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function hasMcpSecretPlaceholder(value: unknown): boolean {
  if (value === MCP_SECRET_PLACEHOLDER) return true;
  if (Array.isArray(value)) return value.some(hasMcpSecretPlaceholder);
  return isMcpObject(value) && Object.values(value).some(hasMcpSecretPlaceholder);
}
function secret(path: string[], value: unknown, parent: unknown): boolean {
  if (typeof value !== "string") return false;
  const key = path.at(-1) ?? "";
  if ((path[0] === "env" || path[0] === "headers") && path.length === 2) return true;
  if (/secret|password|token|api[-_]?key|authorization|credential/i.test(key)) return true;
  if (path[0] === "args" && Array.isArray(parent)) {
    const previous = parent[Number(key) - 1];
    if (typeof previous === "string" && /(?:token|secret|password|api[-_]?key)/i.test(previous)) return true;
    if (/^--[^=]*(?:token|secret|password|api[-_]?key)[^=]*=/i.test(value)) return true;
  }
  if (key === "url") {
    try { const url = new URL(value); return Boolean(url.username || url.password || url.search || url.hash); }
    catch { return false; }
  }
  return false;
}
export function redactMcpDefinition(value: JsonObject): JsonObject {
  function visit(item: unknown, path: string[], parent?: unknown): unknown {
    if (secret(path, item, parent)) return MCP_SECRET_PLACEHOLDER;
    if (Array.isArray(item)) return item.map((child, index) => visit(child, [...path, String(index)], item));
    if (isMcpObject(item)) return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child, [...path, key], item)]));
    return item;
  }
  return visit(value, []) as JsonObject;
}

/** Unchanged masked values survive edits without ever entering the browser. */
export function restoreMcpSecrets(value: JsonObject, original: JsonObject): JsonObject {
  function visit(item: unknown, old: unknown, path: string[], parent?: unknown): unknown {
    if (item === MCP_SECRET_PLACEHOLDER) {
      if (!secret(path, old, parent)) throw new Error("A redacted value has no original credential to preserve");
      return old;
    }
    if (Array.isArray(item)) return item.map((child, index) => visit(child, Array.isArray(old) ? old[index] : undefined, [...path, String(index)], old));
    if (isMcpObject(item)) return Object.fromEntries(Object.entries(item).map(([key, child]) => [key,
      visit(child, isMcpObject(old) && Object.hasOwn(old, key) ? old[key] : undefined, [...path, key], old),
    ]));
    return item;
  }
  return visit(value, original, []) as JsonObject;
}

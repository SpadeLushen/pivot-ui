import type { AgentMessage, NestedToolCalls, ToolResultView } from "./types";

export type NestedCallStatus = "running" | "ok" | "error" | "unfinished";
export interface NestedCallNode {
  id: string;
  name: string;
  parentId: string;
  arguments?: Record<string, unknown>;
  argumentsBytes?: number;
  status: NestedCallStatus;
  durationMs?: number;
  error?: string;
  preview?: ToolResultView;
  previewOmitted?: boolean;
  previewTruncated?: boolean;
}
export interface NestedCallGroup {
  calls: NestedCallNode[];
  complete: boolean;
  uncertain: boolean;
  finalized: boolean;
}
interface RootState extends NestedCallGroup {
  argumentBytes: number;
  previewBytes: Map<string, number>;
}
export interface NestedEvent { type: string; [key: string]: unknown }
const MAX_CALLS = 256;
const MAX_ROOTS = 64;
const MAX_PREVIEW = 2 * 1024 * 1024;
const MAX_PREVIEWS = 8 * 1024 * 1024;
const MAX_TEXT = 64 * 1024;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parentFromId(id: string): string | null {
  const slash = id.lastIndexOf("/");
  return slash > 0 && /^[1-9]\d*$/.test(id.slice(slash + 1)) ? id.slice(0, slash) : null;
}

function clippedText(text: string, characters: number): string {
  if (text.length <= characters) return text;
  // Copy the bounded slice: a V8 sliced string can otherwise retain its full backing string.
  return new TextDecoder().decode(new TextEncoder().encode(text.slice(0, characters)));
}

// Conservative UTF-16 payload accounting; no raw result/details object is retained.
function boundedPreview(value: unknown, id: string, isError: boolean) {
  if (!object(value) || !Array.isArray(value.content)) return null;
  const content: ToolResultView["content"] = [];
  let bytes = 0;
  let textBytes = 0;
  let truncated = false;
  for (const block of value.content.slice(0, MAX_CALLS)) {
    if (!object(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      const remaining = Math.max(0, Math.min(MAX_TEXT - textBytes, MAX_PREVIEW - bytes));
      const text = clippedText(block.text, Math.floor(remaining / 2));
      textBytes += text.length * 2;
      bytes += text.length * 2;
      truncated ||= text.length < block.text.length;
      if (text) content.push({ type: "text", text });
    } else if (block.type === "image") {
      const source = object(block.source) ? block.source : null;
      const data = source?.type === "base64" ? source.data : block.data;
      const mime = source?.type === "base64" ? source.media_type : block.mimeType;
      const url = source?.type === "url" ? source.url : undefined;
      const size = typeof data === "string" ? data.length * 2 : typeof url === "string" ? url.length * 2 : MAX_PREVIEW + 1;
      if (bytes + size > MAX_PREVIEW) { truncated = true; continue; }
      if (typeof data === "string" && typeof mime === "string") content.push({ type: "image", data, mimeType: mime });
      else if (typeof url === "string") content.push({ type: "image", source: { type: "url", url } });
      bytes += size;
    }
  }
  truncated ||= value.content.length > MAX_CALLS;
  const details: Record<string, string> = {};
  if (object(value.details)) for (const key of ["diff", "patch"]) {
    const patch = value.details[key];
    if (typeof patch !== "string") continue;
    if (patch.length * 2 <= MAX_TEXT && bytes + patch.length * 2 <= MAX_PREVIEW) {
      details[key] = patch;
      bytes += patch.length * 2;
    } else truncated = true;
  }
  return { preview: { toolCallId: id, content, isError, details } satisfies ToolResultView, bytes, truncated };
}

export class NestedToolState {
  private sessionId: string | null = null;
  private runId = -1;
  private roots = new Map<string, RootState>();
  private views = new Map<string, NestedCallGroup>();
  private dirty = new Set<string>();

  begin(sessionId: string, runId: number): boolean {
    if (this.sessionId === sessionId && this.runId === runId) return false;
    this.clear();
    this.sessionId = sessionId;
    this.runId = runId;
    return true;
  }

  clear(): void {
    this.roots.clear();
    this.views.clear();
    this.dirty.clear();
    this.sessionId = null;
    this.runId = -1;
  }

  owns(id: unknown): id is string {
    return typeof id === "string" && this.roots.has(id);
  }

  register(id: string): void {
    if (!id || this.roots.has(id)) return;
    if (this.roots.size >= MAX_ROOTS) {
      const oldest = [...this.roots].find(([, root]) => root.finalized);
      if (!oldest) return;
      this.roots.delete(oldest[0]);
      this.views.delete(oldest[0]);
    }
    this.roots.set(id, { calls: [], complete: true, uncertain: false, finalized: false, argumentBytes: 0, previewBytes: new Map() });
  }

  observeMessage(message: AgentMessage): void {
    if (message.role === "assistant") {
      for (const block of message.content ?? []) if (block.type === "toolCall") this.register(block.toolCallId);
    } else if (message.role === "toolResult") {
      this.settle(message.toolCallId, message.nestedCalls);
    }
  }

  observe(event: NestedEvent, sessionId: string, runId: number): boolean {
    if (!["tool_execution_start", "tool_execution_update", "tool_execution_end"].includes(event.type)) return false;
    if (sessionId !== this.sessionId || runId !== this.runId) return false;
    const id = event.toolCallId;
    const parentId = event.parentToolCallId;
    if (typeof id !== "string" || typeof parentId !== "string" || parentFromId(id) !== parentId) return false;
    const match = [...this.roots].filter(([rootId]) => id.startsWith(`${rootId}/`)).sort((a, b) => b[0].length - a[0].length)[0];
    if (!match || match[1].finalized) return false;
    const [rootId, root] = match;
    const index = root.calls.findIndex((call) => call.id === id);
    const old = index < 0 ? undefined : root.calls[index];
    // An update/start replay cannot resurrect a call whose end was observed.
    if (old && (old.status === "ok" || old.status === "error")) return false;
    if (old && event.type === "tool_execution_start") return false;
    if (!old && root.calls.length >= MAX_CALLS) {
      root.complete = false;
      this.dirty.add(rootId);
      return true;
    }
    const node: NestedCallNode = { ...old, id, parentId, name: typeof event.toolName === "string" ? event.toolName : old?.name ?? id, status: "running" };
    if (!old?.arguments && old?.argumentsBytes === undefined && object(event.args)) {
      const json = JSON.stringify(event.args);
      const bytes = new TextEncoder().encode(json).byteLength;
      if (bytes <= 8192 && root.argumentBytes + bytes <= 32768) {
        node.arguments = event.args;
        root.argumentBytes += bytes;
      } else {
        node.argumentsBytes = bytes;
        root.complete = false;
      }
    }
    if (event.type === "tool_execution_end") node.status = event.isError === true ? "error" : "ok";
    const value = event.type === "tool_execution_update" ? event.partialResult : event.type === "tool_execution_end" ? event.result : undefined;
    const preview = boundedPreview(value, id, node.status === "error");
    if (preview) {
      const total = [...this.roots.values()].reduce((sum, entry) => sum + [...entry.previewBytes.values()].reduce((a, b) => a + b, 0), 0);
      const previousBytes = root.previewBytes.get(id) ?? 0;
      if (total - previousBytes + preview.bytes <= MAX_PREVIEWS) {
        node.preview = preview.preview;
        node.previewTruncated = preview.truncated;
        node.previewOmitted = false;
        root.previewBytes.set(id, preview.bytes);
      } else {
        node.preview = undefined;
        node.previewOmitted = true;
        root.previewBytes.delete(id);
      }
      if (node.status === "error") node.error = preview.preview.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      if (node.error) node.error = clippedText(node.error, 500);
    }
    if (!old && event.type !== "tool_execution_start") root.uncertain = true;
    if (index < 0) root.calls.push(node); else root.calls[index] = node;
    this.dirty.add(rootId);
    return true;
  }

  settle(id: string, summary?: NestedToolCalls): void {
    const root = this.roots.get(id);
    if (!root) return;
    if (summary) {
      const saved = historicalNestedGroup(id, summary);
      const old = new Map(root.calls.map((call) => [call.id, call]));
      const order = new Map(root.calls.map((call, index) => [call.id, index]));
      root.calls = saved.calls.map((call) => ({
        ...call, preview: old.get(call.id)?.preview, previewOmitted: old.get(call.id)?.previewOmitted,
        previewTruncated: old.get(call.id)?.previewTruncated,
      })).sort((a, b) => (order.get(a.id) ?? MAX_CALLS) - (order.get(b.id) ?? MAX_CALLS));
      root.complete = saved.complete;
      const retained = new Set(root.calls.map((call) => call.id));
      for (const key of root.previewBytes.keys()) if (!retained.has(key)) root.previewBytes.delete(key);
      root.uncertain = false;
    } else if (root.calls.length) {
      root.complete = false;
      root.calls = root.calls.map((call) => call.status === "running" ? { ...call, status: "unfinished" } : call);
    }
    root.finalized = true;
    this.dirty.add(id);
  }

  interrupt(): void {
    for (const [id, root] of this.roots) {
      if (root.finalized) continue;
      root.uncertain = true;
      root.calls = root.calls.map((call) => call.status === "running" ? { ...call, status: "unfinished" } : call);
      this.dirty.add(id);
    }
  }

  finish(): void {
    this.interrupt();
    for (const root of this.roots.values()) root.finalized = true;
  }

  snapshot(): Map<string, NestedCallGroup> {
    for (const id of this.dirty) {
      const root = this.roots.get(id);
      if (root && (root.calls.length || !root.complete)) this.views.set(id, {
        calls: [...root.calls], complete: root.complete, uncertain: root.uncertain, finalized: root.finalized,
      });
    }
    this.dirty.clear();
    return new Map(this.views);
  }
}

export function displayedNestedGroup(rootId: string, summary: NestedToolCalls | undefined, live: NestedCallGroup | undefined): NestedCallGroup | undefined {
  if (!summary || !Array.isArray(summary.calls)) return live;
  const saved = historicalNestedGroup(rootId, summary);
  if (!live) return saved;
  const observed = new Map(live.calls.map((call, index) => [call.id, { call, index }]));
  return { ...saved, calls: saved.calls.map((call) => ({
    ...call, preview: observed.get(call.id)?.call.preview, previewOmitted: observed.get(call.id)?.call.previewOmitted,
    previewTruncated: observed.get(call.id)?.call.previewTruncated,
  })).sort((a, b) => (observed.get(a.id)?.index ?? MAX_CALLS) - (observed.get(b.id)?.index ?? MAX_CALLS)) };
}

export interface NestedTreeRow { node: NestedCallNode; depth: number; orphan: boolean; hasChildren: boolean }

export function nestedTreeRows(rootId: string, calls: NestedCallNode[], expanded: ReadonlySet<string>): NestedTreeRow[] {
  const children = new Map<string, NestedCallNode[]>();
  for (const call of calls) children.set(call.parentId, [...(children.get(call.parentId) ?? []), call]);
  const covered = new Set<string>();
  const rows: NestedTreeRow[] = [];
  const addTree = (seeds: NestedCallNode[], orphan: boolean) => {
    // Mark collapsed descendants too, so they never become artificial orphan roots.
    const all = [...seeds];
    while (all.length) {
      const node = all.pop()!;
      if (covered.has(node.id)) continue;
      covered.add(node.id);
      all.push(...(children.get(node.id) ?? []));
    }
    const stack = seeds.slice().reverse().map((node) => ({ node, depth: 0 }));
    const visited = new Set<string>();
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      const next = children.get(node.id) ?? [];
      rows.push({ node, depth, orphan, hasChildren: next.length > 0 });
      if (expanded.has(node.id)) for (const child of next.slice().reverse()) stack.push({ node: child, depth: depth + 1 });
    }
  };
  addTree(children.get(rootId) ?? [], false);
  const ids = new Set(calls.map((call) => call.id));
  for (const node of calls) if (!covered.has(node.id) && !ids.has(node.parentId)) addTree([node], true);
  for (const node of calls) if (!covered.has(node.id)) addTree([node], true);
  return rows;
}

export function historicalNestedGroup(rootId: string, summary: NestedToolCalls): NestedCallGroup {
  const source = Array.isArray(summary.calls) ? summary.calls : [];
  const seen = new Set<string>();
  const calls: NestedCallNode[] = [];
  for (const call of source.slice(0, MAX_CALLS)) {
    if (!object(call) || typeof call.id !== "string" || typeof call.name !== "string" || seen.has(call.id)) continue;
    if (call.status !== "ok" && call.status !== "error" && call.status !== "unfinished") continue;
    seen.add(call.id);
    calls.push({
      id: call.id, name: call.name, status: call.status,
      parentId: call.id.startsWith(`${rootId}/`) ? parentFromId(call.id) ?? "" : "",
      arguments: object(call.arguments) ? call.arguments : undefined,
      argumentsBytes: typeof call.argumentsBytes === "number" ? call.argumentsBytes : undefined,
      durationMs: typeof call.durationMs === "number" && Number.isFinite(call.durationMs) && call.durationMs >= 0 ? call.durationMs : undefined,
      error: typeof call.error === "string" ? clippedText(call.error, 500) : undefined,
    });
  }
  return { calls, complete: summary.complete === true && calls.length === source.length, uncertain: false, finalized: true };
}

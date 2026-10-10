import type { ApplyPreviewResponse } from "./api-types";

type Translate = (key: string, params?: Record<string, string | number>) => string;
export type WorkspacePackErrorResponse = { error?: string; plan?: ApplyPreviewResponse };

export function requiresWorkspaceTrust(plan: ApplyPreviewResponse): boolean {
  return plan.mcp.blocked.some((entry) => entry.reason === "untrusted_project");
}

export function workspacePackBlockMessages(plan: ApplyPreviewResponse, t: Translate): string[] {
  const blocked = [...plan.blocked.map((entry) => ({ name: entry.skillKey, reason: entry.reason })),
    ...plan.mcp.blocked.map((entry) => ({ name: entry.serverKey, reason: entry.reason }))];
  const messages = blocked.map(({ name, reason }) => {
    const key = `packs.blocked.${reason}`;
    const message = t(key, { entry: name });
    return message === key ? `${name || "Pack"}: ${reason}` : message;
  });
  for (const entry of [...plan.versionConflicts.map((item) => item.skillKey), ...plan.mcp.versionConflicts.map((item) => item.serverKey)]) {
    messages.push(t("packs.blocked.version_conflict", { entry }));
  }
  return [...new Set(messages)];
}

export class WorkspacePackRequestError extends Error {
  readonly plan?: ApplyPreviewResponse;
  constructor(data: WorkspacePackErrorResponse, t: Translate) {
    super((data.plan && workspacePackBlockMessages(data.plan, t).join("\n")) || data.error || "Unable to change workspace Packs");
    this.plan = data.plan;
  }
}

/** Trust is saved only after an explicit user confirmation, never on a Pack toggle. */
export async function confirmWorkspaceTrust(cwd: string, t: Translate): Promise<boolean> {
  if (!window.confirm(t("packs.trustConfirm", { cwd }))) return false;
  const response = await fetch("/api/workspace-trust", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, trusted: true }),
  });
  const data = await response.json() as { error?: string };
  if (!response.ok || data.error) throw new Error(data.error ?? `Request failed (${response.status})`);
  return true;
}

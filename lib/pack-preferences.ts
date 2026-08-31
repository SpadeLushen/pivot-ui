import type { AppliedPackInfo, ApplyPreviewResponse, WorkspaceSkillPacksResponse } from "./api-types";

export const LAST_SESSION_PACKS_STORAGE_KEY = "pi-last-session-packs";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLastSessionPackIds(): string[] | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAST_SESSION_PACKS_STORAGE_KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : null;
  } catch {
    return null;
  }
}

export function writeLastSessionPackIds(packIds: string[]): void {
  try {
    getStorage()?.setItem(LAST_SESSION_PACKS_STORAGE_KEY, JSON.stringify([...new Set(packIds)]));
  } catch {
    // Storage may be unavailable in private browsing or when its quota is full.
  }
}

let lastPackRecordPromise: Promise<void> = Promise.resolve();

/** Record the pack set for an opened session, serializing reads so the last opened session wins. */
export function rememberLastSessionPacks(cwd: string): Promise<void> {
  lastPackRecordPromise = lastPackRecordPromise.then(async () => {
    try {
      const response = await fetch(`/api/workspace-skill-packs?cwd=${encodeURIComponent(cwd)}`);
      if (!response.ok) return;
      const state = await response.json() as WorkspaceSkillPacksResponse;
      if (!Array.isArray(state.appliedPacks)) return;
      writeLastSessionPackIds(state.appliedPacks.map((pack: AppliedPackInfo) => pack.packId));
    } catch {
      // A failed background read must not affect opening or using a session.
    }
  });
  return lastPackRecordPromise;
}

export async function readLastSessionPacksAfterPendingReads(): Promise<string[] | null> {
  await lastPackRecordPromise;
  return readLastSessionPackIds();
}

export interface LastSessionPackInheritanceResult {
  inherited: boolean;
  packIds: string[];
  missingPackIds: string[];
}

/** Apply the remembered Pack set only when this workspace has no Pack state yet. */
export async function inheritLastSessionPacks(cwd: string): Promise<LastSessionPackInheritanceResult> {
  const remembered = await readLastSessionPacksAfterPendingReads();
  if (!remembered || remembered.length === 0) return { inherited: false, packIds: [], missingPackIds: [] };

  const stateResponse = await fetch(`/api/workspace-skill-packs?cwd=${encodeURIComponent(cwd)}`);
  if (!stateResponse.ok) throw new Error(`HTTP ${stateResponse.status}`);
  const state = await stateResponse.json() as WorkspaceSkillPacksResponse;
  if (state.configured || state.appliedPacks.length > 0) {
    return { inherited: false, packIds: [], missingPackIds: [] };
  }

  const packsResponse = await fetch("/api/skill-packs");
  if (!packsResponse.ok) throw new Error(`HTTP ${packsResponse.status}`);
  const packsData = await packsResponse.json() as { packs?: { id: string }[]; error?: string };
  if (packsData.error) throw new Error(packsData.error);
  const known = new Set((packsData.packs ?? []).map((pack) => pack.id));
  const requested = [...new Set(remembered)];
  const packIds = requested.filter((id) => known.has(id));
  const missingPackIds = requested.filter((id) => !known.has(id));
  if (missingPackIds.length > 0) writeLastSessionPackIds(packIds);
  if (packIds.length === 0) return { inherited: false, packIds: [], missingPackIds };

  const previewResponse = await fetch("/api/workspace-skill-packs/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, packIds }),
  });
  const preview = await previewResponse.json() as ApplyPreviewResponse & { error?: string };
  if (!previewResponse.ok || preview.error) throw new Error(preview.error ?? `HTTP ${previewResponse.status}`);
  if (!preview.canApply) throw new Error("The last session's Packs cannot be applied to this workspace");

  const applyResponse = await fetch("/api/workspace-skill-packs/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, packIds, workspaceRevision: preview.workspaceRevision }),
  });
  const applied = await applyResponse.json() as { error?: string };
  if (!applyResponse.ok || applied.error) throw new Error(applied.error ?? `HTTP ${applyResponse.status}`);
  return { inherited: true, packIds, missingPackIds };
}

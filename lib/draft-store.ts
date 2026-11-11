/** Persistable subset of ChatAttachment (no previewUrl / revocable URLs). */
export interface ChatDraftAttachment {
  name: string;
  size: number;
  mimeType: string;
  savedPath?: string;
}

export interface ChatDraft {
  value: string;
  attachments: ChatDraftAttachment[];
  updatedAt?: number;
}

// Per-key storage avoids rewriting (or overwriting) other conversations' drafts.
const STORAGE_PREFIX = "pi-chat-draft:";
const drafts = new Map<string, ChatDraft>();
const CHANGE_EVENT = "pi-chat-drafts-changed";

function notifyDraftsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeDrafts(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && !event.key.startsWith(STORAGE_PREFIX)) return;
    if (event.key === null) drafts.clear();
    else drafts.delete(event.key.slice(STORAGE_PREFIX.length));
    listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Nonempty drafts, including legacy drafts whose update time is unknown (0). */
export function getDraftUpdates(): ReadonlyMap<string, number> {
  const keys = new Set(drafts.keys());
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keys.add(key.slice(STORAGE_PREFIX.length));
    }
  } catch { /* In-memory drafts remain available without browser storage. */ }
  const updates = new Map<string, number>();
  for (const key of keys) {
    const draft = getDraft(key);
    if (draft && !isEmptyDraft(draft)) updates.set(key, draft.updatedAt ?? 0);
  }
  return updates;
}

function readStoredDraft(key: string): ChatDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ChatDraft> | null;
    if (!value || typeof value.value !== "string" || !Array.isArray(value.attachments)) return null;
    const attachments = value.attachments.filter((a): a is ChatDraftAttachment => (
      a !== null && typeof a === "object" && typeof a.name === "string"
      && typeof a.size === "number" && Number.isFinite(a.size) && a.size >= 0
      && typeof a.mimeType === "string" && typeof a.savedPath === "string" && !!a.savedPath
    ));
    return {
      value: value.value, attachments,
      updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) && value.updatedAt > 0
        ? value.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    value: draft.value,
    updatedAt: draft.updatedAt,
    attachments: draft.attachments.map((a) => ({ ...a })),
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value && draft.attachments.length === 0;
}

export function getDraft(key: string): ChatDraft | null {
  if (typeof window === "undefined") return null;
  const draft = drafts.get(key) ?? readStoredDraft(key);
  if (draft) drafts.set(key, cloneDraft(draft));
  return draft ? cloneDraft(draft) : null;
}

export function setDraft(key: string, draft: ChatDraft): void {
  const persistable: ChatDraft = {
    value: draft.value,
    attachments: draft.attachments.filter((a) => !!a.savedPath),
  };
  if (isEmptyDraft(persistable)) {
    clearDraft(key);
    return;
  }
  const previous = getDraft(key);
  // Mount, blur and unmount flushes must not count as editing the draft.
  if (previous && previous.value === persistable.value
    && JSON.stringify(previous.attachments) === JSON.stringify(persistable.attachments)) return;
  persistable.updatedAt = Date.now();
  drafts.set(key, cloneDraft(persistable));
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(persistable));
  } catch {
    // Retain the in-memory fallback when browser storage is unavailable/full.
  }
  notifyDraftsChanged();
}

export function clearDraft(key: string): void {
  const existed = getDraft(key) !== null;
  drafts.delete(key);
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Sending and clearing the composer must work without browser storage.
  }
  if (existed) notifyDraftsChanged();
}

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
}

// Per-key storage avoids rewriting (or overwriting) other conversations' drafts.
const STORAGE_PREFIX = "pi-chat-draft:";
const drafts = new Map<string, ChatDraft>();

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
    return { value: value.value, attachments };
  } catch {
    return null;
  }
}

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    value: draft.value,
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
  const persistable = {
    value: draft.value,
    attachments: draft.attachments.filter((a) => !!a.savedPath),
  };
  if (isEmptyDraft(persistable)) {
    clearDraft(key);
    return;
  }
  drafts.set(key, cloneDraft(persistable));
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(persistable));
  } catch {
    // Retain the in-memory fallback when browser storage is unavailable/full.
  }
}

export function clearDraft(key: string): void {
  drafts.delete(key);
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Sending and clearing the composer must work without browser storage.
  }
}

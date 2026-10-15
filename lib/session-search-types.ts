export interface SessionSearchStatus {
  enabled: boolean;
  path: string;
  bytes: number;
  indexing: boolean;
  completed: number;
  total: number;
  error: string | null;
  revision: number;
}

export type SessionSearchAction =
  | { action: "enable" | "disable" | "rebuild" }
  | { action: "check-path"; path: string }
  | { action: "move"; path: string; migrate: true };

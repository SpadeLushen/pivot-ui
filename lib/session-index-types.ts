export interface SessionIndexStatus {
  rebuilding: boolean;
  completed: number;
  total: number;
  revision: number;
  error?: string;
}

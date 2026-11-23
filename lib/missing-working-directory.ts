export class MissingWorkingDirectoryError extends Error {
  static readonly code = "SESSION_CWD_MISSING";
  readonly code = MissingWorkingDirectoryError.code;

  constructor(message = "Session working directory no longer exists") {
    super(message);
  }

  static matches(value: unknown): boolean {
    return typeof value === "object" && value !== null && "code" in value && value.code === this.code;
  }
}

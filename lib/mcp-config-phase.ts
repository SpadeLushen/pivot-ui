import { NextResponse } from "next/server";

/** Native-only runtime; adapter-format management must not write native data. */
export class NativeMcpConfigurationUnavailable extends Error {
  readonly code = "NATIVE_MCP_CONFIGURATION_UNAVAILABLE";
  constructor(message = "Legacy adapter and Library MCP configuration writes are no longer supported; use the native MCP editor") {
    super(message);
  }
}
export function isMcpConfigUnavailable(error: unknown): error is NativeMcpConfigurationUnavailable {
  return typeof error === "object" && error !== null && "code" in error && error.code === "NATIVE_MCP_CONFIGURATION_UNAVAILABLE";
}
export function rejectMcpConfigChanges(): never {
  throw new NativeMcpConfigurationUnavailable();
}
export function mcpConfigUnavailableResponse(message?: string) {
  return NextResponse.json({ error: message ?? new NativeMcpConfigurationUnavailable().message,
    code: "NATIVE_MCP_CONFIGURATION_UNAVAILABLE" }, { status: 501 });
}

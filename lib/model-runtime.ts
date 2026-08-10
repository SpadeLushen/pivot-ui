import { ModelRuntime } from "@earendil-works/pi-coding-agent";

// ============================================================================
// Shared helpers over pi 0.84's ModelRuntime (the 0.84 replacement for the
// old AuthStorage/ModelRegistry facade the auth routes used).
// ============================================================================

/** Providers that offer OAuth login (`p.auth.oauth` present). */
export function getOAuthProviders(runtime: ModelRuntime) {
  return runtime.getProviders().filter((p) => p.auth.oauth);
}

"use client";

import { useI18n } from "@/lib/i18n";

type ConnectionOverride = { baseUrl?: string; api?: string; compat?: unknown };

/** A review hint only: never normalize or rewrite user endpoints or credentials. */
export function ProviderUpgradeNotice({ providerId, overrides }: {
  providerId: string; overrides: ConnectionOverride[];
}) {
  const { t } = useI18n();
  const kimi = providerId === "kimi-coding" && overrides.some((entry) =>
    entry.api === "anthropic-messages" || /^https:\/\/api\.kimi\.com\/coding\/?$/i.test(entry.baseUrl ?? "")
    || (typeof entry.compat === "object" && entry.compat !== null
      && ("forceAdaptiveThinking" in entry.compat || "allowEmptySignature" in entry.compat)));
  const opencode = ["opencode", "opencode-go"].includes(providerId) && overrides.some((entry) =>
    /^https:\/\/opencode\.ai\/zen(?:\/|$)/i.test(entry.baseUrl ?? ""));
  if (!kimi && !opencode) return null;
  return <p role="status" style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)", overflowWrap: "anywhere" }}>
    {t(kimi ? "models.kimiProtocolUpgrade" : "models.opencodeEndpointUpgrade")}
  </p>;
}

"use client";
import { useI18n } from "@/lib/i18n";
import type { CodemodeMode, OrchestrationSnapshot } from "@/lib/tool-settings-types";

export interface CodemodeDraft { mode?: CodemodeMode; budget?: string }
export function CodemodeSettings({ settings, draft, withWorkspaceOverrides, disabled, onChange }: {
  settings: OrchestrationSnapshot; draft?: CodemodeDraft; withWorkspaceOverrides: boolean; disabled: boolean;
  onChange: (patch: CodemodeDraft) => void;
}) {
  const { t } = useI18n();
  const mode = draft?.mode ?? settings.mode;
  const budget = draft?.budget ?? String(settings.inlineBudget);
  const unavailable = settings.nativeState !== "available";
  const valid = /^\d+$/.test(budget) && Number.isSafeInteger(Number(budget));
  return <section className="tools-orchestration">
    <h4>{t("tools.orchestration")}</h4>
    {unavailable && <p className="tools-help">{t(`tools.native.${settings.nativeState}`)}</p>}
    <label className="tools-field"><span className={`tools-field-title${withWorkspaceOverrides && mode !== settings.inherited.mode ? " tools-field-overridden" : ""}`}>{t("tools.mode")}</span>
      <select value={mode} disabled={disabled || unavailable} onChange={event => onChange({ mode: event.target.value as CodemodeMode })}>
        <option value="on">on</option><option value="only">only</option>
      </select>
    </label>
    <p className="tools-help">{t(`tools.mode.${mode}`)}</p>
    <label className="tools-field"><span className={`tools-field-title${withWorkspaceOverrides && (!valid || Number(budget) !== settings.inherited.inlineBudget) ? " tools-field-overridden" : ""}`}>{t("tools.inlineBudget")}</span>
      <input type="text" inputMode="numeric" value={budget} disabled={disabled || unavailable} aria-invalid={!valid}
        onChange={event => onChange({ budget: event.target.value })} />
    </label>
    <p className="tools-help">{t("tools.budgetHelp")}</p>
    {!valid && <p className="tools-error">{t("tools.invalidBudget")}</p>}
  </section>;
}

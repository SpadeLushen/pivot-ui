import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

const state = globalThis as typeof globalThis & { __pivotHttpSettingsRevision?: number };
export const httpSettingsRevision = () => state.__pivotHttpSettingsRevision ?? 0;

function globalSettings() {
  const agentDir = getAgentDir();
  const settings = SettingsManager.create(agentDir, agentDir, { projectTrusted: false });
  const failure = settings.drainErrors()[0];
  if (failure) throw failure.error;
  return settings;
}

export function readModelHttpTimeout() {
  return globalSettings().getHttpIdleTimeoutMs();
}

export async function saveModelHttpTimeout(ms: number) {
  const settings = globalSettings();
  settings.setHttpIdleTimeoutMs(ms);
  await settings.flush();
  const failure = settings.drainErrors()[0];
  if (failure) throw failure.error;
  state.__pivotHttpSettingsRevision = httpSettingsRevision() + 1;
  return settings.getHttpIdleTimeoutMs();
}

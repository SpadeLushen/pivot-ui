export const THINKING_LEVEL_OPTIONS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevelOption = typeof THINKING_LEVEL_OPTIONS[number];

export function isThinkingLevelOption(value: unknown): value is ThinkingLevelOption {
  return typeof value === "string" && (THINKING_LEVEL_OPTIONS as readonly string[]).includes(value);
}

/** Match pi's clamping order when a provider supports fewer levels. */
export function supportedThinkingLevel(level: ThinkingLevelOption, available?: readonly string[] | null): ThinkingLevelOption {
  if (level === "auto" || !available || available.includes(level)) return level;
  const index = THINKING_LEVEL_OPTIONS.indexOf(level);
  for (let i = index + 1; i < THINKING_LEVEL_OPTIONS.length; i++) {
    if (available.includes(THINKING_LEVEL_OPTIONS[i])) return THINKING_LEVEL_OPTIONS[i];
  }
  for (let i = index - 1; i > 0; i--) {
    if (available.includes(THINKING_LEVEL_OPTIONS[i])) return THINKING_LEVEL_OPTIONS[i];
  }
  return "off";
}

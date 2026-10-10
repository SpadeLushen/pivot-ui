import { Theme, type ThemeColor, type ThemeBg } from "@earendil-works/pi-coding-agent";

// Neutral, server-owned palette. Browser CSS controls presentation; no browser
// request changes the SDK's process-global theme or another session's bridge.
const foreground = [
  "accent", "border", "borderAccent", "borderMuted", "success", "error", "warning",
  "muted", "dim", "text", "thinkingText", "scrollbarTrack", "scrollbarThumb",
  "searchMatchText", "userMessageText", "customMessageText", "customMessageLabel",
  "toolTitle", "toolOutput", "mdHeading", "mdLink", "mdLinkUrl", "mdCode",
  "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr",
  "mdListBullet", "toolDiffAdded", "toolDiffRemoved", "toolDiffContext",
  "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable",
  "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh",
  "thinkingXhigh", "thinkingMax", "bashMode",
] as const satisfies readonly ThemeColor[];
const background = ["selectedBg", "searchMatchBg", "userMessageBg", "customMessageBg",
  "toolPendingBg", "toolSuccessBg", "toolErrorBg"] as const satisfies readonly ThemeBg[];
// Compile-time coverage guards: adding a new SDK token requires updating this bridge.
const fgCoverage: Record<Exclude<ThemeColor, typeof foreground[number]>, never> = {};
const bgCoverage: Record<Exclude<ThemeBg, typeof background[number]>, never> = {};
void fgCoverage; void bgCoverage;

/** Full SDK color math/appearance contract, but every formatting method is plain text. */
export class PlainTextTheme extends Theme {
  constructor() {
    super(Object.fromEntries(foreground.map(token => [token, "#e5e7eb"])) as Record<ThemeColor, string>,
      Object.fromEntries(background.map(token => [token, "#111827"])) as Record<ThemeBg, string>,
      "truecolor", { name: "pivot-plain-text", appearance: "dark" });
  }
  override style(text: string, _options: Parameters<Theme["style"]>[1]): string { return text; }
  override fg(...[, text]: Parameters<Theme["fg"]>): string { return text; }
  override bg(...[, text]: Parameters<Theme["bg"]>): string { return text; }
  override bold(text: string): string { return text; }
  override italic(text: string): string { return text; }
  override underline(text: string): string { return text; }
  override inverse(text: string): string { return text; }
  override strikethrough(text: string): string { return text; }
  override getFgAnsi(): string { return ""; }
  override getBgAnsi(): string { return ""; }
  override getThinkingBorderColor(): (text: string) => string { return text => text; }
  override getBashModeBorderColor(): (text: string) => string { return text => text; }
}

import { stripAnsi } from "./ansi";
import type { ExtensionWidgetItem } from "./types";

/** Widget key used by the shared @pi-plugins status-line extensions. */
export const EXTENSION_STATUSLINE_WIDGET_KEY = "pi-plugins:statusline";

const FAST_MODE_LABEL_RE = /\[fast mode\]/i;

/**
 * Return the fast-mode label only when the extension actually rendered it.
 * This keeps the browser title tied to runtime UI state rather than to the
 * presence of an installed package or a config file.
 */
export function getFastModeTitleSuffix(widgets: readonly ExtensionWidgetItem[]): string | null {
  const statusline = widgets.find((widget) => widget.key === EXTENSION_STATUSLINE_WIDGET_KEY);
  if (!statusline) return null;

  const text = stripAnsi(statusline.lines.join(" ")).replace(/\s+/g, " ").trim();
  return text.match(FAST_MODE_LABEL_RE)?.[0] ?? null;
}

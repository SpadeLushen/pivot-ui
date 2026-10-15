import type { CSSProperties } from "react";

// Consume whole control strings before the two-character escape fallback.
const ANSI_ESCAPE_SOURCE = "\\x1B(?:[\\]_][^\\x07\\x1B]*(?:\\x07|\\x1B\\\\)|[PX^][\\s\\S]*?\\x1B\\\\|\\[[0-?]*[ -/]*[@-~]|[@-Z\\\\-_])";
const ANSI_ESCAPE_RE = new RegExp(ANSI_ESCAPE_SOURCE, "g");
const ANSI_ESCAPE_AT_START_RE = new RegExp(`^${ANSI_ESCAPE_SOURCE}`);
const ANSI_SGR_RE = /\x1B\[([0-9;]*)m/g;

/** Web rendering keeps SGR styling, not terminal commands or zero-width APC payloads. */
export function normalizeTerminalLine(text: string): string {
  const cursors = text.replaceAll("\x1b_pi:fc\x07", "\x1b[7m")
    .replaceAll("\x1b_pi:/fc\x07", "\x1b[27m");
  return cursors.replace(ANSI_ESCAPE_RE, (sequence) => /^\x1B\[[0-9;]*m$/.test(sequence) ? sequence : "");
}
const hasDrawnCursor = (line: string) => visibleCharPositions(line).some(position => position.inverse);

function nextInverse(codes: number[], inverse: boolean): boolean {
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if ((code === 38 || code === 48) && codes[i + 1] === 2) { i += 4; continue; }
    if ((code === 38 || code === 48) && codes[i + 1] === 5) { i += 2; continue; }
    if (code === 0 || code === 27) inverse = false;
    else if (code === 7) inverse = true;
  }
  return inverse;
}

const ANSI_8_COLORS = [
  "#1f2937",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#2563eb",
  "#9333ea",
  "#0891b2",
  "#6b7280",
];

const ANSI_BRIGHT_COLORS = [
  "#9ca3af",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#3b82f6",
  "#a855f7",
  "#06b6d4",
  "#e5e7eb",
];

export interface AnsiSegment {
  text: string;
  style: CSSProperties;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

function visibleCharPositions(text: string): Array<{ start: number; end: number; char: string; inverse: boolean }> {
  const positions: Array<{ start: number; end: number; char: string; inverse: boolean }> = [];
  let i = 0, inverse = false;
  while (i < text.length) {
    if (text.charCodeAt(i) === 0x1b) {
      const match = text.slice(i).match(ANSI_ESCAPE_AT_START_RE);
      if (match) {
        const sgr = /^\x1B\[([0-9;]*)m$/.exec(match[0]);
        if (sgr) inverse = nextInverse(sgr[1] ? sgr[1].split(";").map(Number) : [0], inverse);
        i += match[0].length;
        continue;
      }
    }
    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    positions.push({ start: i, end: i + char.length, char, inverse });
    i += char.length;
  }
  return positions;
}

function removeVisibleCharAt(text: string, index: number): string {
  const positions = visibleCharPositions(text);
  const pos = positions[index];
  if (!pos) return text;
  return text.slice(0, pos.start) + text.slice(pos.end);
}

function firstVisibleChar(text: string): string | undefined {
  return visibleCharPositions(text)[0]?.char;
}

function lastNonSpaceVisibleCharIndex(text: string): number {
  const positions = visibleCharPositions(text);
  for (let i = positions.length - 1; i >= 0; i--) {
    if (positions[i].char.trim() !== "") return i;
  }
  return -1;
}

function trimEndVisibleSpaces(text: string): string {
  let next = text;
  while (true) {
    const positions = visibleCharPositions(next);
    const last = positions[positions.length - 1];
    if (!last || last.inverse || last.char.trim() !== "") return next;
    next = next.slice(0, last.start) + next.slice(last.end);
  }
}

export function normalizeCustomPanelLines(lines: string[]): string[] {
  const horizontalFrameLine = /^[┌├└╭╰][─┬┴┼]+[┐┤┘╮╯]$/;
  const normalized: string[] = [];

  for (const rawLine of lines) {
    let line = normalizeTerminalLine(rawLine);
    const plain = stripAnsi(line).trimEnd();
    if (horizontalFrameLine.test(plain)) continue;
    const first = firstVisibleChar(line);
    if (first === "│" || first === "┃") {
      line = removeVisibleCharAt(line, 0);
      if (firstVisibleChar(line) === " ") line = removeVisibleCharAt(line, 0);
    }

    const rightBorderIndex = lastNonSpaceVisibleCharIndex(line);
    const rightBorder = rightBorderIndex >= 0 ? visibleCharPositions(line)[rightBorderIndex]?.char : undefined;
    if (rightBorder === "│" || rightBorder === "┃") {
      line = removeVisibleCharAt(line, rightBorderIndex);
    }

    // An empty editor draws its cursor as a highlighted space. Do not trim it away.
    normalized.push(trimEndVisibleSpaces(line));
  }

  const empty = (line: string) => !hasDrawnCursor(line) && stripAnsi(line).trim() === "";
  while (normalized.length > 0 && empty(normalized[0])) normalized.shift();
  while (normalized.length > 0 && empty(normalized[normalized.length - 1])) normalized.pop();
  return normalized.length ? normalized : lines.map(normalizeTerminalLine);
}

export function ansi256Color(index: number): string | undefined {
  if (index >= 0 && index < 8) return ANSI_8_COLORS[index];
  if (index >= 8 && index < 16) return ANSI_BRIGHT_COLORS[index - 8];
  if (index >= 16 && index <= 231) {
    const n = index - 16;
    const r = Math.floor(n / 36);
    const g = Math.floor((n % 36) / 6);
    const b = n % 6;
    const scale = (v: number) => v === 0 ? 0 : 55 + v * 40;
    return `rgb(${scale(r)}, ${scale(g)}, ${scale(b)})`;
  }
  if (index >= 232 && index <= 255) {
    const gray = 8 + (index - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
  }
  return undefined;
}

function applyAnsiCodes(style: CSSProperties, codes: number[]): CSSProperties {
  const next: CSSProperties = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) {
      for (const key of Object.keys(next) as Array<keyof CSSProperties>) delete next[key];
    } else if (code === 1) {
      next.fontWeight = 700;
    } else if (code === 2) {
      next.opacity = 0.65;
    } else if (code === 3) {
      next.fontStyle = "italic";
    } else if (code === 4) {
      next.textDecoration = "underline";
    } else if (code === 22) {
      delete next.fontWeight;
      delete next.opacity;
    } else if (code === 23) {
      delete next.fontStyle;
    } else if (code === 24) {
      delete next.textDecoration;
    } else if (code === 39) {
      delete next.color;
    } else if (code === 49) {
      delete next.backgroundColor;
    } else if (code >= 30 && code <= 37) {
      next.color = ANSI_8_COLORS[code - 30];
    } else if (code >= 90 && code <= 97) {
      next.color = ANSI_BRIGHT_COLORS[code - 90];
    } else if (code >= 40 && code <= 47) {
      next.backgroundColor = ANSI_8_COLORS[code - 40];
    } else if (code >= 100 && code <= 107) {
      next.backgroundColor = ANSI_BRIGHT_COLORS[code - 100];
    } else if ((code === 38 || code === 48) && codes[i + 1] === 2) {
      const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]];
      if ([r, g, b].every((value) => typeof value === "number" && Number.isFinite(value))) {
        if (code === 38) next.color = `rgb(${r}, ${g}, ${b})`;
        else next.backgroundColor = `rgb(${r}, ${g}, ${b})`;
      }
      i += 4;
    } else if ((code === 38 || code === 48) && codes[i + 1] === 5) {
      const color = ansi256Color(codes[i + 2]);
      if (color) {
        if (code === 38) next.color = color;
        else next.backgroundColor = color;
      }
      i += 2;
    }
  }
  return next;
}

export function parseAnsiLine(line: string): AnsiSegment[] {
  line = normalizeTerminalLine(line);
  const segments: AnsiSegment[] = [];
  let style: CSSProperties = {};
  let inverse = false;
  const displayStyle = (): CSSProperties => inverse ? {
    ...style, color: style.backgroundColor ?? "var(--bg)",
    backgroundColor: style.color ?? "var(--text)",
  } : style;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  ANSI_SGR_RE.lastIndex = 0;

  while ((match = ANSI_SGR_RE.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index), style: displayStyle() });
    }
    const codes = match[1]
      ? match[1].split(";").map((part) => Number(part || "0"))
      : [0];
    inverse = nextInverse(codes, inverse);
    style = applyAnsiCodes(style, codes);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex), style: displayStyle() });
  }

  return segments;
}

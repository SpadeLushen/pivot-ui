import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./ansi.ts");
}

test("strips ANSI escape sequences", async () => {
  const { stripAnsi } = await loadSubject();

  assert.equal(stripAnsi("\x1b[31mred\x1b[0m plain"), "red plain");
});

test("normalizes boxed custom panel lines while preserving ANSI codes", async () => {
  const { normalizeCustomPanelLines, stripAnsi } = await loadSubject();
  const lines = [
    "┌──────┐",
    "│ \x1b[32mOK\x1b[0m   │",
    "└──────┘",
  ];

  const normalized = normalizeCustomPanelLines(lines);

  assert.equal(normalized.length, 1);
  assert.equal(stripAnsi(normalized[0]), "OK");
  assert.match(normalized[0], /\x1b\[32m/);
});

test("parses ANSI style segments and reset codes", async () => {
  const { parseAnsiLine } = await loadSubject();

  assert.deepEqual(parseAnsiLine("\x1b[31;1mhot\x1b[0m cold"), [
    { text: "hot", style: { color: "#dc2626", fontWeight: 700 } },
    { text: " cold", style: {} },
  ]);
});

test("maps 256-color SGR codes", async () => {
  const { ansi256Color, parseAnsiLine } = await loadSubject();

  assert.equal(ansi256Color(196), "rgb(255, 0, 0)");
  assert.deepEqual(parseAnsiLine("\x1b[38;5;196mred"), [
    { text: "red", style: { color: "rgb(255, 0, 0)" } },
  ]);
});

const cursor = text => `\x1b_pi:c\x07\x1b_pi:fc\x07${text}\x1b_pi:/fc\x07`;
test("pi 1.2 APC/OSC payloads disappear completely but their surrounding text survives", async () => {
  const { stripAnsi, normalizeTerminalLine, parseAnsiLine } = await loadSubject();
  for (const end of ["\x07", "\x1b\\"]) {
    const text = `前\x1b_hidden${end}中\x1b]8;;https://example.invalid${end}link\x1b]8;;${end}后`;
    assert.equal(stripAnsi(text), "前中link后");
    assert.equal(normalizeTerminalLine(text), "前中link后");
    assert.equal(parseAnsiLine(text).map(s => s.text).join(""), "前中link后");
  }
});

test("fake cursor preserves Chinese/emoji and SGR foreground with reversible inverse", async () => {
  const { parseAnsiLine, stripAnsi, normalizeTerminalLine } = await loadSubject();
  const raw = `\x1b[31m前${cursor("🙂")}后\x1b[0m`;
  assert.equal(stripAnsi(raw), "前🙂后");
  assert.deepEqual(parseAnsiLine(raw), [
    { text: "前", style: { color: "#dc2626" } },
    { text: "🙂", style: { color: "var(--bg)", backgroundColor: "#dc2626" } },
    { text: "后", style: { color: "#dc2626" } },
  ]);
  assert.equal(normalizeTerminalLine(normalizeTerminalLine(raw)), normalizeTerminalLine(raw));
});

test("empty and end-of-line cursor cells are not trimmed as blank padding", async () => {
  const { normalizeCustomPanelLines, parseAnsiLine, stripAnsi } = await loadSubject();
  const lines = normalizeCustomPanelLines(["", "┌────┐", `│ ${cursor(" ")}  │`, "└────┘", ""]);
  assert.equal(lines.length, 1);
  assert.ok(parseAnsiLine(lines[0]).some(s => s.text === " " && s.style.backgroundColor === "var(--text)"));
  assert.doesNotMatch(stripAnsi(lines[0]), /[│┌└]/);
  assert.equal(stripAnsi(normalizeCustomPanelLines([`文本${cursor(" ")}`])[0]), "文本 ");
  assert.equal(stripAnsi(normalizeCustomPanelLines([`│ 前${cursor("🙂")}后  │`])[0]), "前🙂后");
});

test("reset clears cursor inverse, and terminal commands never become visible text", async () => {
  const { parseAnsiLine, normalizeTerminalLine } = await loadSubject();
  assert.deepEqual(parseAnsiLine("\x1b[7ma\x1b[0mb"), [
    { text: "a", style: { color: "var(--bg)", backgroundColor: "var(--text)" } },
    { text: "b", style: {} },
  ]);
  assert.equal(normalizeTerminalLine("a\x1b[2Jb\x1bPprivate\x1b\\c"), "abc");
});

test("RGB/256-color payload values never toggle inverse or keep non-cursor padding", async () => {
  const { parseAnsiLine, normalizeCustomPanelLines, stripAnsi } = await loadSubject();
  assert.deepEqual(parseAnsiLine("\x1b[38;2;7;27;0mtext"), [
    { text: "text", style: { color: "rgb(7, 27, 0)" } },
  ]);
  assert.equal(stripAnsi(normalizeCustomPanelLines(["│ \x1b[38;5;7mtext  │"])[0]), "text");
  assert.deepEqual(parseAnsiLine("\x1b[7m\x1b[38;2;7;27;0mtext"), [
    { text: "text", style: { color: "var(--bg)", backgroundColor: "rgb(7, 27, 0)" } },
  ]);
});

test("real SDK Input render has no leaked APC in Web text and retains its cursor cell", async () => {
  const { Input, stripTerminalSequences } = await import("@earendil-works/pi-tui");
  const { normalizeCustomPanelLines, parseAnsiLine, stripAnsi } = await loadSubject();
  const input = new Input(); input.focused = true;
  for (const value of ["", "中文🙂"]) {
    input.setValue(value);
    const raw = input.render(20);
    assert.ok(raw.some(line => line.includes("\x1b_pi:fc\x07")));
    for (const line of raw) assert.equal(stripAnsi(line), stripTerminalSequences(line));
    const web = normalizeCustomPanelLines(raw);
    assert.ok(web.flatMap(parseAnsiLine).some(segment => segment.style.backgroundColor));
    assert.doesNotMatch(web.flatMap(parseAnsiLine).map(s => s.text).join(""), /pi:(?:c|fc|\/fc)|\x1b|\x07/);
  }
});

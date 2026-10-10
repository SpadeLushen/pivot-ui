import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React, { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import swc from "next/dist/build/swc/index.js";

const transpile = (source) => swc.transformSync(source, {
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;

const require = createRequire(import.meta.url);
const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const statusBarSource = source.slice(source.indexOf("function ExtensionStatusBar("), source.indexOf("type SessionCopyField"));
const compiled = transpile(statusBarSource);
const ExtensionStatusBar = new Function("require", "exports", "useRef", "useState", "useEffect", "useI18n", "ChevronDown", `${compiled}\nreturn ExtensionStatusBar;`)(
  require, {}, useRef, useState, useEffect,
  () => ({ t: (key) => key }), () => React.createElement("svg"),
);

function renderStatusBar(isMobile, statuses = [], open = false) {
  return renderToStaticMarkup(React.createElement(ExtensionStatusBar, { isMobile, statuses, open, onToggle() {} }));
}

test("mobile expansion stays available with empty or short extension statuses", () => {
  for (const statuses of [[], [{ key: "mode", text: "ready" }]]) {
    const html = renderStatusBar(true, statuses);
    assert.match(html, /<button/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-label="app.expandExtensionStatuses"/);
  }
  assert.match(renderStatusBar(true, [], true), /aria-expanded="true"/);
});

test("one shared action set moves to the mobile panel and stays inline on desktop", () => {
  const start = source.indexOf("const renderToolbarActions =");
  const renderer = source.slice(start, source.indexOf(": actions;", start) + ": actions;".length);
  const compiledRenderer = transpile(renderer);
  const actions = { buttons: ["theme", "history", "branches", "system", "compact"] };
  const container = {};
  const render = (mobile, host) => new Function("isMobile", "mobileActionsContainer", "createPortal", `${compiledRenderer}\nreturn renderToolbarActions;`)(
    mobile, host, (children, target) => ({ children, target }),
  )(actions);

  assert.equal(render(false, null), actions);
  assert.equal(render(true, null), null);
  assert.deepEqual(render(true, container), { children: actions, target: container });
  assert.match(source, /\(isMobile \|\| \(showChat && extensionStatuses\.length > 0\)\)/);
  assert.match(source, /containerRef=\{isMobile \? mobileActionsRef : topBarRef\}/);
  const popover = source.slice(source.indexOf('className="workspace-popover"'));
  assert.ok(popover.indexOf('className="mobile-toolbar-actions"') < popover.indexOf('activeTopPanel === "extensions"'));
  assert.match(popover, /ref=\{attachMobileActions\}/);
});

test("desktop retains empty and non-overflowing status bar behavior", () => {
  assert.equal(renderStatusBar(false), "");
  assert.doesNotMatch(renderStatusBar(false, [{ key: "mode", text: "ready" }]), /<button/);
});

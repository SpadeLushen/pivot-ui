import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("./useDragDrop.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
});

// Exercise the real hook callbacks and effect cleanup without a browser/DOM dependency.
function mount() {
  let isDragOver;
  const cleanups = [];
  const drops = [];
  const listeners = new Map();
  const document = {};
  const window = {
    addEventListener(type, fn, capture = false) {
      if (!listeners.has(type)) listeners.set(type, new Map());
      listeners.get(type).set(fn, capture);
    },
    removeEventListener(type, fn, capture = false) {
      assert.equal(listeners.get(type)?.get(fn), capture);
      listeners.get(type).delete(fn);
    },
  };
  const react = {
    useState: (initial) => [isDragOver = initial, (value) => { isDragOver = value; }],
    useRef: (current) => ({ current }),
    useCallback: (fn) => fn,
    useEffect: (fn) => { cleanups.push(fn()); },
  };
  const exports = {};
  runInNewContext(outputText, {
    exports, window, document,
    require(name) { assert.equal(name, "react"); return react; },
  });
  const hook = exports.useDragDrop((files) => drops.push(files));
  return {
    ...hook, document, window, drops, listeners,
    get isDragOver() { return isDragOver; },
    emit(type, event = {}) {
      for (const fn of listeners.get(type)?.keys() ?? []) fn(event);
    },
    unmount() { for (const cleanup of cleanups) cleanup?.(); },
  };
}

function drag(target, overrides = {}) {
  return {
    target,
    relatedTarget: null,
    dataTransfer: { types: ["Files"], items: [{ kind: "file" }], files: [] },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...overrides,
  };
}

function leave(hook, event) {
  // Window capture runs before React's bubbling handler.
  hook.emit("dragleave", event);
  hook.handleDragLeave(event);
}

test("leaving the window clears unmatched enters from nested session content", () => {
  const hook = mount();
  const workspace = {};
  const message = {};
  const code = {};
  hook.handleDragEnter(drag(workspace));
  hook.handleDragEnter(drag(message));
  hook.handleDragEnter(drag(code));
  assert.equal(hook.isDragOver, true);

  leave(hook, drag(code));
  assert.equal(hook.isDragOver, false);
  assert.equal(hook.drops.length, 0);

  // Returning to the same session must work without remounting it.
  hook.handleDragEnter(drag(message));
  assert.equal(hook.isDragOver, true);
  leave(hook, drag(message));
  assert.equal(hook.isDragOver, false);
});

test("moving between descendants does not flicker, even with a null relatedTarget", () => {
  const hook = mount();
  const parent = {};
  const child = {};
  const sibling = {};
  hook.handleDragEnter(drag(parent));
  for (const [previous, next] of [[parent, child], [child, sibling], [sibling, parent]]) {
    hook.handleDragEnter(drag(next));
    leave(hook, drag(previous));
    assert.equal(hook.isDragOver, true);
  }
  leave(hook, drag(parent, { relatedTarget: {} }));
  assert.equal(hook.isDragOver, false, "moving to the sidebar leaves the drop zone");
});

for (const target of ["document", "window"]) {
  test(`handles a window exit reported only on ${target}`, () => {
    const hook = mount();
    hook.handleDragEnter(drag({}));
    hook.handleDragEnter(drag({}));
    hook.emit("dragleave", drag(hook[target]));
    assert.equal(hook.isDragOver, false);
    assert.equal(hook.drops.length, 0);
  });
}

for (const type of ["dragend", "drop", "blur"]) {
  test(`${type} outside the drop zone resets the overlay`, () => {
    const hook = mount();
    hook.handleDragEnter(drag({}));
    hook.emit(type);
    assert.equal(hook.isDragOver, false);
    assert.equal(hook.drops.length, 0);
  });
}

test("a valid drop forwards files exactly once after window capture cleanup", () => {
  const hook = mount();
  const target = {};
  const file = { name: "example.txt" };
  const event = drag(target);
  event.dataTransfer.files = [file];
  hook.handleDragEnter(drag(target));
  hook.emit("drop", event);
  hook.handleDrop(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(hook.isDragOver, false);
  assert.equal(hook.drops.length, 1);
  assert.equal(hook.drops[0].length, 1);
  assert.equal(hook.drops[0][0], file);
});

test("dragover recovers file drags even when protected items are unavailable", () => {
  const hook = mount();
  const event = drag({}, { dataTransfer: { types: ["Files"], items: [], files: [] } });
  hook.handleDragEnter(event);
  assert.equal(hook.isDragOver, true);
  hook.emit("blur");
  hook.handleDragOver(event);
  assert.equal(hook.isDragOver, true);
  assert.equal(event.defaultPrevented, true);
  leave(hook, event);
  assert.equal(hook.isDragOver, false);
});

test("text and link drags do not activate the overlay or block native dragging", () => {
  const hook = mount();
  const event = drag({}, {
    dataTransfer: { types: ["text/plain", "text/uri-list"], items: [{ kind: "string" }], files: [] },
  });
  hook.handleDragEnter(event);
  hook.handleDragOver(event);
  assert.equal(hook.isDragOver, false);
  assert.equal(event.defaultPrevented, false);
});

test("unmount removes every global listener with matching capture options", () => {
  const hook = mount();
  assert.equal(hook.listeners.size, 4);
  hook.unmount();
  for (const callbacks of hook.listeners.values()) assert.equal(callbacks.size, 0);
});

test("the empty new-session drop zone still clears on leave", () => {
  const hook = mount();
  const input = {};
  hook.handleDragEnter(drag(input));
  leave(hook, drag(input));
  assert.equal(hook.isDragOver, false);
});

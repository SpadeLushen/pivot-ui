import assert from "node:assert/strict";
import test from "node:test";
import { assertNativeCompiler } from "./pivot-build-compiler.js";

test("compiler guard accepts the native interfaces required by this Next version", () => {
  assert.doesNotThrow(() => assertNativeCompiler({ projectNew() {}, projectFeatureUsage() {} }, "native"));
});
test("a same-version manifest cannot hide an older compiler binary", () => {
  assert.throws(() => assertNativeCompiler({ projectNew() {} }, "16.3.8"), /missing projectFeatureUsage.*Reinstall/);
});
test("compiler guard rejects non-Turbopack bindings", () => {
  assert.throws(() => assertNativeCompiler({}, "native"), /missing projectNew/);
});

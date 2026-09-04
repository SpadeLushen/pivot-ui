import assert from "node:assert/strict";
import test from "node:test";
import { getSystemHour12 } from "./time-format.ts";

test("reads the browser hour-cycle preference and falls back to 24-hour time", () => {
  const originalDateTimeFormat = Intl.DateTimeFormat;
  try {
    Intl.DateTimeFormat = function () {
      return { resolvedOptions: () => ({ hour12: true }) };
    };
    assert.equal(getSystemHour12(), true);

    Intl.DateTimeFormat = function () {
      return { resolvedOptions: () => ({ hour12: false }) };
    };
    assert.equal(getSystemHour12(), false);

    Intl.DateTimeFormat = function () {
      throw new Error("Intl unavailable");
    };
    assert.equal(getSystemHour12(), false);
  } finally {
    Intl.DateTimeFormat = originalDateTimeFormat;
  }
});

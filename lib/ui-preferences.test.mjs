import assert from "node:assert/strict";
import test from "node:test";
import {
  readEnterBehaviorPreference,
  readTimeFormatPreference,
  readSoundEnabledPreference,
  readTpsEnabledPreference,
  readToolPresetPreference,
  writeEnterBehaviorPreference,
  writeTimeFormatPreference,
  writeSoundEnabledPreference,
  writeTpsEnabledPreference,
  writeToolPresetPreference,
} from "./ui-preferences.ts";

function withStorage(run) {
  const previousWindow = globalThis.window;
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  try {
    return run(values);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

test("UI preferences use safe defaults and round-trip stored values", () => {
  withStorage((values) => {
    assert.equal(readToolPresetPreference(), "full");
    assert.equal(readSoundEnabledPreference(), false);
    assert.equal(readTpsEnabledPreference(), false);
    assert.equal(readEnterBehaviorPreference(), "followUp");
    assert.equal(readTimeFormatPreference(), "24");

    writeToolPresetPreference("full");
    writeSoundEnabledPreference(false);
    writeTpsEnabledPreference(false);
    writeEnterBehaviorPreference("followUp");
    writeTimeFormatPreference("24");

    assert.equal(readToolPresetPreference(), "full");
    assert.equal(readSoundEnabledPreference(), false);
    assert.equal(readTpsEnabledPreference(), false);
    assert.equal(readEnterBehaviorPreference(), "followUp");
    assert.equal(readTimeFormatPreference(), "24");
    assert.equal(values.size, 5);
  });
});

test("UI preferences ignore invalid stored values", () => {
  withStorage((values) => {
    values.set("pi-tool-preset", "unexpected");
    values.set("pi-sound-enabled", "unexpected");
    values.set("pi-tps-enabled", "unexpected");
    values.set("pi-enter-behavior", "unexpected");
    values.set("pi-time-format", "unexpected");

    assert.equal(readToolPresetPreference(), "full");
    assert.equal(readSoundEnabledPreference(), false);
    assert.equal(readTpsEnabledPreference(), false);
    assert.equal(readEnterBehaviorPreference(), "followUp");
    assert.equal(readTimeFormatPreference(), "24");

    values.set("pi-time-format", "system");
    assert.equal(readTimeFormatPreference(), "24");
  });
});

test("UI preferences tolerate unavailable localStorage", () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    get localStorage() {
      throw new Error("storage unavailable");
    },
  };
  try {
    assert.equal(readToolPresetPreference(), "full");
    assert.equal(readSoundEnabledPreference(), false);
    assert.equal(readTpsEnabledPreference(), false);
    assert.equal(readEnterBehaviorPreference(), "followUp");
    assert.equal(readTimeFormatPreference(), "24");
    writeToolPresetPreference("none");
    writeSoundEnabledPreference(false);
    writeTpsEnabledPreference(false);
    writeEnterBehaviorPreference("followUp");
    writeTimeFormatPreference("12");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

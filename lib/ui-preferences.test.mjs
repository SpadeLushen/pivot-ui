import assert from "node:assert/strict";
import test from "node:test";
import {
  readSoundEnabledPreference,
  readTpsEnabledPreference,
  readToolPresetPreference,
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
    assert.equal(readToolPresetPreference(), "default");
    assert.equal(readSoundEnabledPreference(), true);
    assert.equal(readTpsEnabledPreference(), true);

    writeToolPresetPreference("full");
    writeSoundEnabledPreference(false);
    writeTpsEnabledPreference(false);

    assert.equal(readToolPresetPreference(), "full");
    assert.equal(readSoundEnabledPreference(), false);
    assert.equal(readTpsEnabledPreference(), false);
    assert.equal(values.size, 3);
  });
});

test("UI preferences ignore invalid stored values", () => {
  withStorage((values) => {
    values.set("pi-tool-preset", "unexpected");
    values.set("pi-sound-enabled", "unexpected");
    values.set("pi-tps-enabled", "unexpected");

    assert.equal(readToolPresetPreference(), "default");
    assert.equal(readSoundEnabledPreference(), true);
    assert.equal(readTpsEnabledPreference(), true);
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
    assert.equal(readToolPresetPreference(), "default");
    assert.equal(readSoundEnabledPreference(), true);
    assert.equal(readTpsEnabledPreference(), true);
    writeToolPresetPreference("none");
    writeSoundEnabledPreference(false);
    writeTpsEnabledPreference(false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

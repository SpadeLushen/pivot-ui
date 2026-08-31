import assert from "node:assert/strict";
import test from "node:test";
import {
  LAST_SESSION_PACKS_STORAGE_KEY,
  inheritLastSessionPacks,
  readLastSessionPackIds,
  rememberLastSessionPacks,
} from "./pack-preferences.ts";

async function withBrowser(run) {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const values = new Map();
  const calls = [];
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  try {
    await run(values, calls);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
}

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test("does nothing without a remembered Pack set", async () => {
  await withBrowser(async (_values, calls) => {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return response({});
    };
    const result = await inheritLastSessionPacks("/target");
    assert.deepEqual(result, { inherited: false, packIds: [], missingPackIds: [] });
    assert.equal(calls.length, 0);
  });
});

test("remembers the Pack set of an opened session", async () => {
  await withBrowser(async (_values, calls) => {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return response({ configured: false, revision: 0, appliedPacks: [], skippedConflicts: [] });
    };
    await rememberLastSessionPacks("/source");
    assert.deepEqual(readLastSessionPackIds(), []);
    assert.deepEqual(calls, ["/api/workspace-skill-packs?cwd=%2Fsource"]);
  });
});

test("inherits remembered Packs only into an unconfigured workspace", async () => {
  await withBrowser(async (values, calls) => {
    values.set(LAST_SESSION_PACKS_STORAGE_KEY, JSON.stringify(["pack-a"]));
    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      calls.push(`${init.method ?? "GET"} ${target}`);
      if (target.startsWith("/api/workspace-skill-packs?")) {
        return response({ configured: false, revision: 0, appliedPacks: [], skippedConflicts: [] });
      }
      if (target === "/api/skill-packs") return response({ packs: [{ id: "pack-a" }] });
      if (target === "/api/workspace-skill-packs/preview") return response({ workspaceRevision: 0, canApply: true });
      if (target === "/api/workspace-skill-packs/apply") return response({ success: true });
      throw new Error(`unexpected fetch: ${target}`);
    };

    const result = await inheritLastSessionPacks("/target");
    assert.deepEqual(result, { inherited: true, packIds: ["pack-a"], missingPackIds: [] });
    assert.equal(calls.length, 4);
  });
});

test("skips remembered Packs deleted from the global configuration", async () => {
  await withBrowser(async (values, calls) => {
    values.set(LAST_SESSION_PACKS_STORAGE_KEY, JSON.stringify(["gone"]));
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).startsWith("/api/workspace-skill-packs?")) {
        return response({ configured: false, revision: 0, appliedPacks: [], skippedConflicts: [] });
      }
      return response({ packs: [] });
    };

    const result = await inheritLastSessionPacks("/target");
    assert.deepEqual(result, { inherited: false, packIds: [], missingPackIds: ["gone"] });
    assert.deepEqual(readLastSessionPackIds(), []);
    assert.equal(calls.length, 2);
  });
});

test("does not inherit into a workspace with an explicit empty Pack state", async () => {
  await withBrowser(async (values, calls) => {
    values.set(LAST_SESSION_PACKS_STORAGE_KEY, JSON.stringify(["pack-a"]));
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return response({ configured: true, revision: 1, appliedPacks: [], skippedConflicts: [] });
    };

    const result = await inheritLastSessionPacks("/configured");
    assert.equal(result.inherited, false);
    assert.equal(calls.length, 1);
  });
});

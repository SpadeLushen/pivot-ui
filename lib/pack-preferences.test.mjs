import assert from "node:assert/strict";
import test from "node:test";
import {
  LAST_SESSION_PACKS_STORAGE_KEY,
  inheritLastSessionPacks,
  prepareWorkspacePacks,
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

function mockWorkspaces(states, calls) {
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: target, body });
    if (target.startsWith("/api/workspace-skill-packs?")) {
      const cwd = new URL(target, "http://localhost").searchParams.get("cwd");
      const ids = states.get(cwd);
      return response({
        configured: ids !== undefined, revision: ids ? 1 : 0,
        appliedPacks: (ids ?? []).map((packId) => ({ packId })), skippedConflicts: [],
      });
    }
    if (target === "/api/skill-packs") return response({ packs: [{ id: "pack-a" }, { id: "pack-b" }] });
    if (target === "/api/workspace-skill-packs/preview") return response({ workspaceRevision: 0, canApply: true });
    if (target === "/api/workspace-skill-packs/apply") {
      assert.equal(body.workspaceRevision, 0);
      states.set(body.cwd, body.packIds);
      return response({ success: true });
    }
    throw new Error(`unexpected fetch: ${target}`);
  };
}

test("prepares a new workspace from the last saved session before first send", async () => {
  await withBrowser(async (_values, calls) => {
    const states = new Map([["/saved", ["pack-a"]]]);
    mockWorkspaces(states, calls);
    // Do not await the source read: switching while it is pending must work.
    const source = prepareWorkspacePacks("/saved");
    const target = prepareWorkspacePacks("/new", { inherit: true });
    await source;
    assert.equal((await target).inherited, true);
    assert.deepEqual(states.get("/new"), ["pack-a"]);
    assert.deepEqual(readLastSessionPackIds(), ["pack-a"]);
  });
});

test("inherits changes made in New Session without saving a session", async () => {
  await withBrowser(async (_values, calls) => {
    const states = new Map([["/draft", ["pack-a"]]]);
    mockWorkspaces(states, calls);
    await prepareWorkspacePacks("/draft", { inherit: true });
    states.set("/draft", ["pack-b"]);
    const changed = prepareWorkspacePacks("/draft", { inherit: true });
    const target = prepareWorkspacePacks("/target", { inherit: true });
    await Promise.all([changed, target]);
    assert.deepEqual(states.get("/target"), ["pack-b"]);
    assert.deepEqual(readLastSessionPackIds(), ["pack-b"]);
  });
});

test("shares pending preparation between workspace mount and first send", async () => {
  await withBrowser(async (values, calls) => {
    values.set(LAST_SESSION_PACKS_STORAGE_KEY, JSON.stringify(["pack-a"]));
    mockWorkspaces(new Map(), calls);
    const mounted = prepareWorkspacePacks("/new", { inherit: true });
    const firstSend = prepareWorkspacePacks("/new", { inherit: true });
    assert.equal(mounted, firstSend);
    await Promise.all([mounted, firstSend]);
    assert.equal(calls.filter((call) => call.url.endsWith("/apply")).length, 1);
  });
});

test("preserves configured workspaces and remembers explicit empty selections", async () => {
  await withBrowser(async (values, calls) => {
    values.set(LAST_SESSION_PACKS_STORAGE_KEY, JSON.stringify(["pack-a"]));
    const states = new Map([["/configured", ["pack-b"]]]);
    mockWorkspaces(states, calls);
    assert.equal((await prepareWorkspacePacks("/configured", { inherit: true })).inherited, false);
    assert.deepEqual(readLastSessionPackIds(), ["pack-b"]);
    states.set("/configured", []);
    await prepareWorkspacePacks("/configured", { inherit: true });
    await prepareWorkspacePacks("/new", { inherit: true });
    assert.deepEqual(readLastSessionPackIds(), []);
    assert.equal(calls.some((call) => call.url.endsWith("/apply")), false);
  });
});

test("rapid navigation back to a workspace records the latest selection last", async () => {
  await withBrowser(async (_values, calls) => {
    mockWorkspaces(new Map([["/a", ["pack-a"]], ["/b", ["pack-b"]]]), calls);
    await Promise.all([
      prepareWorkspacePacks("/a", { inherit: true }),
      prepareWorkspacePacks("/b", { inherit: true }),
      prepareWorkspacePacks("/a", { inherit: true }),
    ]);
    assert.deepEqual(readLastSessionPackIds(), ["pack-a"]);
  });
});

test("failed inheritance preserves the source and does not poison retries", async () => {
  await withBrowser(async (values, calls) => {
    values.set(LAST_SESSION_PACKS_STORAGE_KEY, JSON.stringify(["pack-a"]));
    const states = new Map();
    mockWorkspaces(states, calls);
    const fetchOk = globalThis.fetch;
    globalThis.fetch = async (url, init) => String(url).endsWith("/apply")
      ? response({ error: "MCP_ADAPTER_REQUIRED" }, 412)
      : fetchOk(url, init);
    await assert.rejects(prepareWorkspacePacks("/new", { inherit: true }), /MCP_ADAPTER_REQUIRED/);
    assert.deepEqual(readLastSessionPackIds(), ["pack-a"]);
    assert.equal(states.has("/new"), false);
    globalThis.fetch = fetchOk;
    assert.equal((await prepareWorkspacePacks("/new", { inherit: true })).inherited, true);
  });
});

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

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { readFile, writeFile, rm, stat } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const sdkDir = path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const load = (file) => import(pathToFileURL(path.join(sdkDir, file)));
const { OutputAccumulator } = await load("core/tools/output-accumulator.js");
const { executeBashWithOperations } = await load("core/bash-executor.js");
const { writeOutputFile, createOutputFileStream } = await load("utils/output-files.js");
test("empty and nonzero Shell executions retain output and exit status", async () => {
  for (const [output, exitCode] of [["", 0], ["local error\n", 2]]) {
    const result = await executeBashWithOperations("local fixture", tmpdir(), {
      exec: async (_command, _cwd, { onData }) => { onData(Buffer.from(output)); return { exitCode }; },
    });
    assert.equal(result.output, output);
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.truncated, false);
    assert.equal(result.fullOutputPath, undefined);
  }
});

test("SDK output files never overwrite an existing path (including streamed creation)", async (t) => {
  const prefix = `pivot-output-collision-${process.pid}`;
  const file = path.join(tmpdir(), `${prefix}-${"01".repeat(8)}.log`);
  await writeFile(file, "do not overwrite", { flag: "wx" });
  t.after(() => rm(file, { force: true }));
  const original = crypto.randomBytes;
  crypto.randomBytes = (size) => Buffer.alloc(size, 1);
  syncBuiltinESMExports();
  try {
    await assert.rejects(writeOutputFile(prefix, ".log", "replacement"), { code: "EEXIST" });
    const { stream } = createOutputFileStream(prefix, ".log");
    const completion = finished(stream);
    stream.end("replacement");
    await assert.rejects(completion, { code: "EEXIST" });
    assert.equal(await readFile(file, "utf8"), "do not overwrite");
  } finally { crypto.randomBytes = original; syncBuiltinESMExports(); }
});

const { isFilePathAllowed } = await createJiti(import.meta.url).import("./file-access.ts");

test("truncated Shell output remains complete, private and outside the Web allow-list", async (t) => {
  const output = "private-output\n".repeat(6000);
  const accumulator = new OutputAccumulator();
  accumulator.append(Buffer.from(output));
  accumulator.finish();
  await accumulator.closeTempFile();
  const snapshot = accumulator.snapshot();
  const file = snapshot.fullOutputPath;
  t.after(() => rm(file, { force: true }));
  assert.equal(snapshot.truncation.truncated, true);
  assert.equal(await readFile(file, "utf8"), output);
  assert.deepEqual(await accumulator.readFullOutput(Buffer.byteLength(output)), { content: output, truncated: false });
  if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(isFilePathAllowed(file, new Set([path.join(tmpdir(), "unrelated-workspace")])), false);
  assert.equal(isFilePathAllowed(file, new Set([file])), true);
});

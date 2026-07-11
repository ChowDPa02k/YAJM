import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readJsonl, writeJsonl } from "./jsonl.js";

let tempDir: string | undefined;

describe("JSONL", () => {
  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("reads existing JSON records containing literal Unicode line separators", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "yajm-jsonl-"));
    const file = path.join(tempDir, "records.jsonl");
    await writeFile(file, `{"text":"before\u2028after"}\n{"text":"next"}\n`);

    const rows = [];
    for await (const row of readJsonl<{ text: string }>(file)) rows.push(row);

    expect(rows).toEqual([{ text: "before\u2028after" }, { text: "next" }]);
  });

  it("escapes Unicode line separators when writing new records", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "yajm-jsonl-"));
    const file = path.join(tempDir, "records.jsonl");
    await writeJsonl(file, [{ text: "a\u2028b\u2029c" }]);

    const contents = await readFile(file, "utf8");
    expect(contents).toContain("\\u2028");
    expect(contents).toContain("\\u2029");
    expect(contents).not.toContain("\u2028");
    expect(contents).not.toContain("\u2029");
  });
});

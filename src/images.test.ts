import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportImages, restoreImages } from "./images.js";
import type { JellyfinClient } from "./jellyfin.js";
import type { ImageRecord } from "./types.js";

let tempDir: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("artwork snapshots", () => {
  it("archives Season and Episode images and deduplicates identical content", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "yajm-images-"));
    const data = new TextEncoder().encode("same image");
    const client = {
      getLogicalLibraryItemsWithImages: vi.fn().mockResolvedValue([
        { Id: "season", Type: "Season", ImageTags: { Primary: "s" } },
        { Id: "episode", Type: "Episode", ImageTags: { Primary: "e" } }
      ]),
      downloadItemImage: vi.fn().mockResolvedValue({ data, contentType: "image/jpeg" })
    } as unknown as JellyfinClient;

    const result = await exportImages({ client, snapshotDir: tempDir, concurrency: 2 });

    expect(result.records.map((record) => record.itemType)).toEqual(["Season", "Episode"]);
    expect(result.records[0]?.file).toBe(result.records[1]?.file);
    expect(await readdir(path.join(tempDir, "images", result.records[0]!.sha256.slice(0, 2)))).toHaveLength(1);
    expect((await readFile(path.join(tempDir, "images.jsonl"), "utf8")).trim().split("\n")).toHaveLength(2);
  });

  it("removes existing images and restores multiple images in source order", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "yajm-images-"));
    await Promise.all([
      import("node:fs/promises").then(({ writeFile }) => writeFile(path.join(tempDir!, "zero.jpg"), "zero")),
      import("node:fs/promises").then(({ writeFile }) => writeFile(path.join(tempDir!, "one.jpg"), "one"))
    ]);
    const calls: string[] = [];
    const client = {
      getItemImages: vi.fn().mockResolvedValue([
        { ImageType: "Backdrop", ImageIndex: 0 },
        { ImageType: "Backdrop", ImageIndex: 1 }
      ]),
      deleteItemImage: vi.fn(async (_id: string, type: string, index: number) => calls.push(`delete:${type}:${index}`)),
      uploadItemImage: vi.fn(async (_id: string, type: string, index: number) => calls.push(`upload:${type}:${index}`))
    } as unknown as JellyfinClient;
    const records: ImageRecord[] = [0, 1].map((imageIndex) => ({
      sourceItemId: "source",
      itemType: "Series",
      imageType: "Backdrop",
      imageIndex,
      contentType: "image/jpeg",
      size: 3 + imageIndex,
      sha256: String(imageIndex),
      file: imageIndex === 0 ? "zero.jpg" : "one.jpg"
    }));

    const report = await restoreImages({
      client,
      snapshotDir: tempDir,
      records,
      guidMap: new Map([["source", "target"]]),
      concurrency: 4,
      dryRun: false
    });

    expect(calls).toEqual(["delete:Backdrop:1", "delete:Backdrop:0", "upload:Backdrop:0", "upload:Backdrop:1"]);
    expect(report.written).toBe(2);
    expect(report.failed).toEqual([]);
  });
});

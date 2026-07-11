import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mapConcurrent } from "./concurrency.js";
import { JellyfinClient } from "./jellyfin.js";
import { writeJsonl } from "./jsonl.js";
import type { ImageRecord, JellyfinItemDto } from "./types.js";

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tiff"
};

type ImageReference = Pick<ImageRecord, "sourceItemId" | "itemType" | "imageType" | "imageIndex" | "sourceTag">;

export async function exportImages(input: {
  client: JellyfinClient;
  snapshotDir: string;
  concurrency: number;
  onProgress?: (message: string) => void;
}): Promise<{ records: ImageRecord[]; bytes: number; failed: unknown[] }> {
  const items = await input.client.getLogicalLibraryItemsWithImages((progress) =>
    input.onProgress?.(`⠙ images: catalog ${progress.fetched}`)
  );
  const references = items.flatMap(imageReferences);
  const imagesDir = path.join(input.snapshotDir, "images");
  await mkdir(imagesDir, { recursive: true });
  let bytes = 0;
  let completed = 0;
  const failed: unknown[] = [];
  const records = (await mapConcurrent(references, input.concurrency, async (reference) => {
    try {
      const image = await input.client.downloadItemImage(reference.sourceItemId, reference.imageType, reference.imageIndex);
      const sha256 = createHash("sha256").update(image.data).digest("hex");
      const extension = CONTENT_TYPE_EXTENSIONS[image.contentType] ?? "img";
      const relativeFile = path.join("images", sha256.slice(0, 2), `${sha256}.${extension}`);
      const absoluteFile = path.join(input.snapshotDir, relativeFile);
      await mkdir(path.dirname(absoluteFile), { recursive: true });
      try {
        await writeFile(absoluteFile, image.data, { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      bytes += image.data.byteLength;
      return { ...reference, contentType: image.contentType, size: image.data.byteLength, sha256, file: relativeFile } satisfies ImageRecord;
    } catch (error) {
      failed.push({ ...reference, error: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      completed++;
      if (completed === 1 || completed % 250 === 0 || completed === references.length) {
        input.onProgress?.(`⠋ images: ${completed}/${references.length} failed=${failed.length}`);
      }
    }
  })).filter((record): record is ImageRecord => record !== null);
  await writeJsonl(path.join(input.snapshotDir, "images.jsonl"), records);
  return { records, bytes, failed };
}

export async function restoreImages(input: {
  client: JellyfinClient;
  snapshotDir: string;
  records: ImageRecord[];
  guidMap: Map<string, string>;
  concurrency: number;
  dryRun: boolean;
  onProgress?: (message: string) => void;
}) {
  const groups = groupImages(input.records, input.guidMap);
  const report = { planned: input.records.length, written: 0, unmatched: 0, failed: [] as unknown[], dryRun: input.dryRun };
  report.unmatched = input.records.length - [...groups.values()].reduce((sum, group) => sum + group.records.length, 0);
  let completed = 0;
  await mapConcurrent([...groups.values()], input.concurrency, async (group) => {
    if (input.dryRun) return;
    try {
      const targetImages = await input.client.getItemImages(group.targetItemId);
      for (const [imageType, records] of groupByType(group.records)) {
        const existing = targetImages.filter((image) => image.ImageType === imageType);
        for (const image of [...existing].sort((a, b) => (b.ImageIndex ?? 0) - (a.ImageIndex ?? 0))) {
          await input.client.deleteItemImage(group.targetItemId, imageType, image.ImageIndex);
        }
        for (const record of records.sort((a, b) => a.imageIndex - b.imageIndex)) {
          const data = new Uint8Array(await readFile(path.join(input.snapshotDir, record.file)));
          await input.client.uploadItemImage(group.targetItemId, imageType, record.imageIndex, record.contentType, data);
          report.written++;
        }
      }
    } catch (error) {
      report.failed.push({ targetItemId: group.targetItemId, error: error instanceof Error ? error.message : String(error) });
    } finally {
      completed++;
      if (completed === 1 || completed % 50 === 0 || completed === groups.size) {
        input.onProgress?.(`⠋ import images: items ${completed}/${groups.size} written=${report.written} failed=${report.failed.length}`);
      }
    }
  });
  return report;
}

function imageReferences(item: JellyfinItemDto): ImageReference[] {
  if (!item.Type || !["Movie", "Series", "Season", "Episode"].includes(item.Type)) return [];
  const itemType = item.Type as ImageRecord["itemType"];
  const references = Object.entries(item.ImageTags ?? {}).map(([imageType, sourceTag]) => ({
    sourceItemId: item.Id, itemType, imageType, imageIndex: 0, sourceTag
  }));
  for (const [imageIndex, sourceTag] of (item.BackdropImageTags ?? []).entries()) {
    references.push({ sourceItemId: item.Id, itemType, imageType: "Backdrop", imageIndex, sourceTag });
  }
  return references;
}

function groupImages(records: ImageRecord[], guidMap: Map<string, string>) {
  const groups = new Map<string, { targetItemId: string; records: ImageRecord[] }>();
  for (const record of records) {
    const targetItemId = guidMap.get(record.sourceItemId) ?? guidMap.get(record.sourceItemId.toLowerCase());
    if (!targetItemId) continue;
    const group = groups.get(targetItemId) ?? { targetItemId, records: [] };
    group.records.push(record);
    groups.set(targetItemId, group);
  }
  return groups;
}

function groupByType(records: ImageRecord[]): Map<string, ImageRecord[]> {
  const groups = new Map<string, ImageRecord[]>();
  for (const record of records) groups.set(record.imageType, [...(groups.get(record.imageType) ?? []), record]);
  return groups;
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readJsonl, writeJsonl } from "./jsonl.js";
import { ensureMigrateDirs, resolveSnapshotPath, snapshotPath } from "./paths.js";
import {
  ManifestSchema,
  SCHEMA_VERSION,
  SnapshotUsersSchema,
  type Manifest,
  type LibraryItem,
  type MediaRecord,
  type SnapshotUsers,
  type UserRecord
} from "./types.js";

export async function createSnapshot(
  name: string,
  manifest: Omit<Manifest, "schemaVersion" | "exportedAt" | "stats">,
  users: UserRecord[],
  media: MediaRecord[],
  library: LibraryItem[] = []
): Promise<Manifest> {
  await ensureMigrateDirs();
  const dir = snapshotPath(name);
  await mkdir(dir, { recursive: true });
  await mkdir(path.join(dir, "reports"), { recursive: true });
  await writeFile(
    path.join(dir, "users.json"),
    `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, users } satisfies SnapshotUsers, null, 2)}\n`
  );
  const userDataCount = await writeJsonl(path.join(dir, "userdata.jsonl"), media);
  const libraryCount = await writeJsonl(path.join(dir, "library.jsonl"), library);
  const fullManifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sourceType: manifest.sourceType,
    source: manifest.source,
    stats: {
      users: users.length,
      userData: userDataCount,
      library: libraryCount,
      images: 0,
      imageBytes: 0
    }
  };
  await writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(fullManifest, null, 2)}\n`);
  return fullManifest;
}

export async function readSnapshot(name: string): Promise<{
  manifest: Manifest;
  users: UserRecord[];
  userDataPath: string;
  libraryPath: string;
  imagesPath: string;
  dir: string;
}> {
  const dir = await resolveSnapshotPath(name);
  const manifest = ManifestSchema.parse(JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")));
  const usersFile = SnapshotUsersSchema.parse(JSON.parse(await readFile(path.join(dir, "users.json"), "utf8")));
  return {
    manifest,
    users: usersFile.users,
    userDataPath: path.join(dir, "userdata.jsonl"),
    libraryPath: path.join(dir, "library.jsonl"),
    imagesPath: path.join(dir, "images.jsonl"),
    dir
  };
}

export async function updateSnapshotManifest(name: string, manifest: Manifest): Promise<void> {
  const dir = await resolveSnapshotPath(name);
  await writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function writeReport(snapshot: string, name: string, data: unknown): Promise<void> {
  const reportsDir = await resolveSnapshotPath(snapshot, "reports");
  await mkdir(reportsDir, { recursive: true });
  await writeFile(path.join(reportsDir, name), `${JSON.stringify(data, null, 2)}\n`);
}

export { readJsonl };

import { JellyfinClient } from "./jellyfin.js";
import { exportLibraryFromApi, exportLibraryFromSqlite } from "./library.js";
import { createSnapshot } from "./snapshot.js";
import { updateSnapshotManifest, writeReport } from "./snapshot.js";
import { exportImages } from "./images.js";
import { snapshotPath } from "./paths.js";
import { assertJellyfinDb, exportMediaFromSqlite, exportUsersFromSqlite } from "./sqlite.js";
import type { JellyfinItemDto, LibraryItem, Manifest, MediaRecord, UserRecord } from "./types.js";
import { hasMeaningfulUserData, mergeUserData } from "./userdata.js";

export type DisplayPreferenceProfile = {
  displayPreferencesId: string;
  client: string;
};

export type ExportSource =
  | { type: "api"; serverUrl: string; apiKey: string }
  | { type: "sqlite"; dbPath: string };

export type WatchSource = ExportSource | { type: "none" };
export type LibrarySource = ExportSource;

export type ExportProgress = (message: string) => void;

export async function exportUsersFromApi(input: {
  serverUrl: string;
  apiKey: string;
  displayPreferenceProfiles: DisplayPreferenceProfile[];
  onProgress?: ExportProgress;
}): Promise<UserRecord[]> {
  const client = new JellyfinClient(input.serverUrl, input.apiKey);
  input.onProgress?.("⠋ users(api): fetching user list...");
  const users = await client.getUsers();
  const exportedUsers: UserRecord[] = [];
  let index = 0;

  for (const user of users) {
    index++;
    const userId = user.Id;
    const userName = user.Name ?? user.Id;
    input.onProgress?.(`⠋ users(api): ${index}/${users.length} ${userName} preferences...`);
    const displayPreferences: Record<string, unknown>[] = [];
    for (const profile of input.displayPreferenceProfiles) {
      const prefs = await client.getDisplayPreferences(userId, profile.displayPreferencesId, profile.client);
      if (prefs) {
        displayPreferences.push({
          ...prefs,
          __displayPreferencesId: profile.displayPreferencesId,
          __client: profile.client
        });
      }
    }
    exportedUsers.push({
      id: userId,
      name: userName,
      configuration: user.Configuration ?? null,
      policy: user.Policy ?? null,
      displayPreferences,
      raw: user
    });
    input.onProgress?.(`⠙ users(api): ${exportedUsers.length}/${users.length} exported`);
  }
  return exportedUsers;
}

export async function exportMediaFromApi(input: {
  serverUrl: string;
  apiKey: string;
  users: UserRecord[];
  onProgress?: ExportProgress;
}): Promise<MediaRecord[]> {
  const client = new JellyfinClient(input.serverUrl, input.apiKey);
  const media = new Map<string, MediaRecord>();
  let userIndex = 0;

  for (const user of input.users) {
    userIndex++;
    input.onProgress?.(`⠋ watch(api): user ${userIndex}/${input.users.length} ${user.name}, scanning... total=${media.size}`);
    const items = await client.getMovieAndEpisodeItemsForUser(user.id, (progress) => {
      const total = progress.total === undefined ? "?" : String(progress.total);
      input.onProgress?.(
        `⠙ watch(api): user ${userIndex}/${input.users.length} ${user.name}, items ${progress.fetched}/${total}, rows=${media.size}`
      );
    });
    for (const item of items) {
      const record = mediaRecordFromApiItem(user, item);
      if (!record) continue;
      const key = mediaRecordKey(record);
      const previous = media.get(key);
      media.set(key, previous ? mergeApiMediaRecord(previous, record) : record);
    }
    input.onProgress?.(`⠹ watch(api): user ${userIndex}/${input.users.length} ${user.name} done, rows=${media.size}`);
  }
  return [...media.values()];
}

export async function exportUsersFromSqliteSource(input: { dbPath: string; onProgress?: ExportProgress }): Promise<UserRecord[]> {
  input.onProgress?.("⠋ users(sqlite): checking schema...");
  await assertJellyfinDb(input.dbPath);
  input.onProgress?.("⠙ users(sqlite): reading Users...");
  const users = await exportUsersFromSqlite(input.dbPath);
  input.onProgress?.(`⠹ users(sqlite): ${users.length} users exported`);
  return users;
}

export async function exportMediaFromSqliteSource(input: { dbPath: string; onProgress?: ExportProgress }): Promise<MediaRecord[]> {
  input.onProgress?.("⠋ watch(sqlite): checking schema...");
  await assertJellyfinDb(input.dbPath);
  input.onProgress?.("⠙ watch(sqlite): reading UserData/BaseItems/BaseItemProviders...");
  const media = await exportMediaFromSqlite(input.dbPath);
  input.onProgress?.(`⠹ watch(sqlite): ${media.length} rows exported`);
  return media;
}

export async function exportLibraryFromSource(input: { source: LibrarySource; onProgress?: ExportProgress }): Promise<LibraryItem[]> {
  return input.source.type === "api"
    ? exportLibraryFromApi({ serverUrl: input.source.serverUrl, apiKey: input.source.apiKey, onProgress: input.onProgress })
    : exportLibraryFromSqlite({ dbPath: input.source.dbPath, onProgress: input.onProgress });
}

export async function exportSnapshot(input: {
  snapshotName: string;
  userSource: ExportSource;
  watchSource: WatchSource;
  librarySource: LibrarySource;
  displayPreferenceProfiles: DisplayPreferenceProfile[];
  exportImages?: boolean;
  imageConcurrency?: number;
  onProgress?: ExportProgress;
}): Promise<Manifest> {
  const users =
    input.userSource.type === "api"
      ? await exportUsersFromApi({
          serverUrl: input.userSource.serverUrl,
          apiKey: input.userSource.apiKey,
          displayPreferenceProfiles: input.displayPreferenceProfiles,
          onProgress: input.onProgress
        })
      : await exportUsersFromSqliteSource({ dbPath: input.userSource.dbPath, onProgress: input.onProgress });

  const media =
    input.watchSource.type === "none"
      ? []
      : input.watchSource.type === "api"
        ? await exportMediaFromApi({
            serverUrl: input.watchSource.serverUrl,
            apiKey: input.watchSource.apiKey,
            users,
            onProgress: input.onProgress
          })
        : await exportMediaFromSqliteSource({ dbPath: input.watchSource.dbPath, onProgress: input.onProgress });

  const library = await exportLibraryFromSource({ source: input.librarySource, onProgress: input.onProgress });

  let manifest = await createSnapshot(
    input.snapshotName,
    {
      sourceType: sourceType(input.userSource, input.watchSource, input.librarySource),
      source: {
        users: sourceManifest(input.userSource),
        watch: watchManifest(input.watchSource),
        library: sourceManifest(input.librarySource),
        serverUrl: input.userSource.type === "api" ? input.userSource.serverUrl : undefined,
        dbPath: input.userSource.type === "sqlite" ? input.userSource.dbPath : undefined
      }
    },
    users,
    media,
    library
  );
  if (input.exportImages) {
    if (input.librarySource.type !== "api") throw new Error("Image export requires an API library source");
    const result = await exportImages({
      client: new JellyfinClient(input.librarySource.serverUrl, input.librarySource.apiKey),
      snapshotDir: snapshotPath(input.snapshotName),
      concurrency: input.imageConcurrency ?? 16,
      onProgress: input.onProgress
    });
    manifest = {
      ...manifest,
      stats: { ...manifest.stats, images: result.records.length, imageBytes: result.bytes }
    };
    await updateSnapshotManifest(input.snapshotName, manifest);
    await writeReport(input.snapshotName, "image-export-report.json", {
      exported: result.records.length,
      bytes: result.bytes,
      failed: result.failed
    });
  }
  return manifest;
}

export async function exportFromApi(input: {
  snapshotName: string;
  serverUrl: string;
  apiKey: string;
  displayPreferenceProfiles: DisplayPreferenceProfile[];
  onProgress?: ExportProgress;
}) {
  return exportSnapshot({
    snapshotName: input.snapshotName,
    userSource: { type: "api", serverUrl: input.serverUrl, apiKey: input.apiKey },
    watchSource: { type: "api", serverUrl: input.serverUrl, apiKey: input.apiKey },
    librarySource: { type: "api", serverUrl: input.serverUrl, apiKey: input.apiKey },
    displayPreferenceProfiles: input.displayPreferenceProfiles,
    onProgress: input.onProgress
  });
}

export async function exportFromSqlite(input: { snapshotName: string; dbPath: string; onProgress?: ExportProgress }) {
  return exportSnapshot({
    snapshotName: input.snapshotName,
    userSource: { type: "sqlite", dbPath: input.dbPath },
    watchSource: { type: "sqlite", dbPath: input.dbPath },
    librarySource: { type: "sqlite", dbPath: input.dbPath },
    displayPreferenceProfiles: [],
    onProgress: input.onProgress
  });
}

function mediaRecordFromApiItem(user: UserRecord, item: JellyfinItemDto): MediaRecord | null {
  if (!hasMeaningfulUserData(item.UserData)) return null;
  if (item.Type !== "Movie" && item.Type !== "Episode") return null;
  return {
    sourceItemId: item.Id,
    userId: user.id,
    userName: user.name,
    type: item.Type,
    name: item.Name ?? "",
    originalTitle: item.OriginalTitle ?? null,
    productionYear: item.ProductionYear ?? null,
    providerIds: item.ProviderIds ?? {},
    seriesName: item.SeriesName ?? null,
    seasonName: item.SeasonName ?? null,
    parentIndexNumber: item.ParentIndexNumber ?? null,
    indexNumber: item.IndexNumber ?? null,
    path: item.Path ?? null,
    userData: {
      ...item.UserData,
      ItemId: item.Id
    }
  };
}

function mediaRecordKey(record: MediaRecord): string {
  return `${record.userId}\u0000${record.sourceItemId}`;
}

function mergeApiMediaRecord(left: MediaRecord, right: MediaRecord): MediaRecord {
  return {
    ...left,
    providerIds: { ...right.providerIds, ...left.providerIds },
    userData: mergeUserData(left.userData, right.userData)
  };
}

function sourceType(userSource: ExportSource, watchSource: WatchSource, librarySource: LibrarySource): "api" | "sqlite" | "mixed" {
  const types = new Set([userSource.type, librarySource.type]);
  if (watchSource.type !== "none") types.add(watchSource.type);
  return types.size === 1 ? userSource.type : "mixed";
}

function sourceManifest(source: ExportSource) {
  return source.type === "api"
    ? { type: "api" as const, serverUrl: source.serverUrl }
    : { type: "sqlite" as const, dbPath: source.dbPath };
}

function watchManifest(source: WatchSource) {
  if (source.type === "none") return { type: "none" as const };
  return sourceManifest(source);
}

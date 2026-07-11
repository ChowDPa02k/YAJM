import { MediaMatcher } from "./match.js";
import { JellyfinClient, JellyfinApiError } from "./jellyfin.js";
import { readJsonl, readSnapshot, writeReport } from "./snapshot.js";
import { shouldOverwriteUserData } from "./match.js";
import { buildLibraryDiff, buildMetadataUpdates } from "./library-match.js";
import { mapConcurrent } from "./concurrency.js";
import { remapGuidsInValue } from "./remap.js";
import { restoreImages } from "./images.js";
import type { MediaRecord, UserMapping, UserRecord, JellyfinUserDto, UserItemData, LibraryItem, ImageRecord } from "./types.js";

const SAFE_POLICY_KEYS = new Set([
  "IsAdministrator",
  "IsHidden",
  "EnableCollectionManagement",
  "EnableSubtitleManagement",
  "EnableLyricManagement",
  "IsDisabled",
  "MaxParentalRating",
  "MaxParentalSubRating",
  "BlockedTags",
  "AllowedTags",
  "EnableUserPreferenceAccess",
  "AccessSchedules",
  "BlockUnratedItems",
  "EnableRemoteControlOfOtherUsers",
  "EnableSharedDeviceControl",
  "EnableRemoteAccess",
  "EnableLiveTvManagement",
  "EnableLiveTvAccess",
  "EnableMediaPlayback",
  "EnableAudioPlaybackTranscoding",
  "EnableVideoPlaybackTranscoding",
  "EnablePlaybackRemuxing",
  "EnableContentDeletion",
  "EnableContentDeletionFromFolders",
  "EnableContentDownloading",
  "EnableSyncTranscoding",
  "EnableMediaConversion",
  "EnabledDevices",
  "EnableAllDevices",
  "EnabledChannels",
  "EnableAllChannels",
  "EnabledFolders",
  "EnableAllFolders",
  "InvalidLoginAttemptCount",
  "LoginAttemptsBeforeLockout",
  "MaxActiveSessions",
  "RemoteClientBitrateLimit",
  "AuthenticationProviderId",
  "PasswordResetProviderId",
  "SyncPlayAccess"
]);

export type ImportDecision =
  | { action: "map"; targetUserId: string }
  | { action: "create" }
  | { action: "skip"; reason: string };

export type ImportDecisionProvider = (user: UserRecord, targetUsers: JellyfinUserDto[]) => Promise<ImportDecision>;

export async function importSnapshot(input: {
  snapshotName: string;
  serverUrl: string;
  apiKey: string;
  initialPassword: string;
  dryRun: boolean;
  restoreMetadata: boolean;
  restoreImages: boolean;
  readConcurrency: number;
  writeConcurrency: number;
  decideUser: ImportDecisionProvider;
  onProgress?: (message: string) => void;
}) {
  const snapshot = await readSnapshot(input.snapshotName);
  const client = new JellyfinClient(input.serverUrl, input.apiKey);

  input.onProgress?.("⠋ import library: loading logical backup...");
  const sourceLibrary = await collectJsonl<LibraryItem>(snapshot.libraryPath);
  input.onProgress?.("⠋ import library: fetching target Movie/TV catalog...");
  const targetLibraryDtos = await client.getLogicalLibraryItems((progress) => {
    const total = progress.total === undefined ? "?" : String(progress.total);
    input.onProgress?.(`⠙ import library: target items ${progress.fetched}/${total}`);
  });
  targetLibraryDtos.push(...(await client.getVirtualFolders()));
  const library = buildLibraryDiff(sourceLibrary, targetLibraryDtos);
  await writeReport(input.snapshotName, "item-map.json", library.diff.matches);
  await writeReport(input.snapshotName, "library-diff.json", library.diff);
  input.onProgress?.(
    `⠹ import library: matched=${library.diff.summary.matched} changed=${library.diff.summary.changed} missing=${library.diff.summary.unmatched} ambiguous=${library.diff.summary.ambiguous}`
  );

  let metadataReport = { planned: library.diff.changes.length, written: 0, failed: [] as unknown[], skipped: input.dryRun || !input.restoreMetadata };
  if (!input.dryRun && input.restoreMetadata && library.diff.changes.length > 0) {
    input.onProgress?.(`⠋ import metadata: preparing ${library.diff.changes.length} updates...`);
    const updates = await buildMetadataUpdates({
      changes: library.diff.changes,
      source: sourceLibrary,
      targetDtoById: library.targetDtoById,
      concurrency: input.readConcurrency
    });
    await mapConcurrent(updates, input.writeConcurrency, async (update, index) => {
      try {
        if (index === 0 || index % 25 === 0) input.onProgress?.(`⠋ import metadata: ${index + 1}/${updates.length} written=${metadataReport.written}`);
        await client.updateItem(update.itemId, update.body);
        metadataReport.written++;
      } catch (error) {
        metadataReport.failed.push({ itemId: update.itemId, name: update.name, error: error instanceof Error ? error.message : String(error) });
      }
    });
  }
  await writeReport(input.snapshotName, "metadata-report.json", metadataReport);

  let imageReport = { planned: 0, written: 0, unmatched: 0, failed: [] as unknown[], dryRun: input.dryRun };
  if (input.restoreImages && snapshot.manifest.stats.images > 0) {
    input.onProgress?.("⠋ import images: loading image manifest...");
    const imageRecords = await collectJsonl<ImageRecord>(snapshot.imagesPath);
    imageReport = await restoreImages({
      client,
      snapshotDir: snapshot.dir,
      records: imageRecords,
      guidMap: library.guidMap,
      concurrency: input.writeConcurrency,
      dryRun: input.dryRun,
      onProgress: input.onProgress
    });
  }
  await writeReport(input.snapshotName, "image-import-report.json", imageReport);

  input.onProgress?.("⠋ import: fetching target users...");
  const targetUsers = await client.getUsers();
  const targetByName = new Map(targetUsers.map((user) => [(user.Name ?? "").toLowerCase(), user]));
  const targetById = new Map(targetUsers.map((user) => [user.Id, user]));
  const mappings: UserMapping[] = [];

  let mappedCount = 0;
  let createdCount = 0;
  let skippedCount = 0;
  let userIndex = 0;
  for (const sourceUser of snapshot.users) {
    userIndex++;
    input.onProgress?.(`⠋ import users: ${userIndex}/${snapshot.users.length} ${sourceUser.name}`);
    const sameName = targetByName.get(sourceUser.name.toLowerCase());
    if (sameName) {
      mappings.push({
        action: "map",
        oldUserId: sourceUser.id,
        oldUserName: sourceUser.name,
        newUserId: sameName.Id,
        newUserName: sameName.Name ?? sameName.Id
      });
      mappedCount++;
      continue;
    }
    const decision = await input.decideUser(sourceUser, targetUsers);
    if (decision.action === "skip") {
      mappings.push({ action: "skip", oldUserId: sourceUser.id, oldUserName: sourceUser.name, reason: decision.reason });
      skippedCount++;
    } else if (decision.action === "map") {
      const target = targetById.get(decision.targetUserId);
      if (!target) {
        mappings.push({ action: "skip", oldUserId: sourceUser.id, oldUserName: sourceUser.name, reason: "selected target user not found" });
        skippedCount++;
      } else {
        mappings.push({
          action: "map",
          oldUserId: sourceUser.id,
          oldUserName: sourceUser.name,
          newUserId: target.Id,
          newUserName: target.Name ?? target.Id
        });
        mappedCount++;
      }
    } else {
      if (input.dryRun) {
        mappings.push({
          action: "create",
          oldUserId: sourceUser.id,
          oldUserName: sourceUser.name,
          newUserName: sourceUser.name
        });
        createdCount++;
      } else {
        input.onProgress?.(`⠙ import users: creating ${sourceUser.name} (${userIndex}/${snapshot.users.length})`);
        const created = await client.createUser(sourceUser.name, input.initialPassword);
        targetUsers.push(created);
        targetById.set(created.Id, created);
        targetByName.set((created.Name ?? "").toLowerCase(), created);
        mappings.push({
          action: "create",
          oldUserId: sourceUser.id,
          oldUserName: sourceUser.name,
          newUserId: created.Id,
          newUserName: created.Name ?? sourceUser.name
        });
        createdCount++;
      }
    }
    input.onProgress?.(`⠹ import users: mapped=${mappedCount} created=${createdCount} skipped=${skippedCount}`);
  }

  const sourceById = new Map(snapshot.users.map((user) => [user.id, user]));
  let settingsIndex = 0;
  for (const mapping of mappings) {
    if (mapping.action === "skip" || !mapping.newUserId || input.dryRun) continue;
    const sourceUser = sourceById.get(mapping.oldUserId);
    if (!sourceUser) continue;
    settingsIndex++;
    input.onProgress?.(`⠋ import settings: ${settingsIndex}/${mappings.length} ${sourceUser.name}`);
    await restoreUserSettings(
      client,
      mapping.newUserId,
      sourceUser,
      library.guidMap,
      snapshot.manifest.stats.userData > 0,
      input.onProgress
    );
  }

  if (snapshot.manifest.stats.userData === 0) {
    const mediaReport = {
      matched: 0,
      skippedUsers: 0,
      skippedNewerTarget: 0,
      missing: [] as unknown[],
      ambiguous: [] as unknown[],
      failed: [] as unknown[],
      dryRunPlannedWrites: 0
    };
    await writeReport(input.snapshotName, "user-map.json", mappings);
    await writeReport(input.snapshotName, "import-report.json", mediaReport);
    input.onProgress?.("⠹ import: no watch history in snapshot; skipped media import");
    return { mappings, mediaReport, imageReport, manifest: snapshot.manifest };
  }

  input.onProgress?.("⠋ import watch: preparing target media matcher...");
  const catalog = targetLibraryDtos.filter((item) => item.Type === "Movie" || item.Type === "Episode");
  input.onProgress?.(`⠙ import watch: target catalog=${catalog.length} Movie/Episode items`);
  const matcher = new MediaMatcher(catalog);
  const resolveUserMapping = createUserMappingResolver(mappings);

  const mediaReport = {
    matched: 0,
    skippedUsers: 0,
    skippedNewerTarget: 0,
    missing: [] as unknown[],
    ambiguous: [] as unknown[],
    failed: [] as unknown[],
    dryRunPlannedWrites: 0
  };

  const mediaRecords = await collectJsonl<MediaRecord>(snapshot.userDataPath);
  const mediaConcurrency = input.dryRun ? input.readConcurrency : input.writeConcurrency;
  try {
    await mapConcurrent(mediaRecords, mediaConcurrency, async (record, index) => {
      const processed = index + 1;
      if (processed === 1 || processed % 100 === 0) {
        input.onProgress?.(
          `⠋ import watch: ${processed}/${snapshot.manifest.stats.userData} matched=${mediaReport.matched} planned=${mediaReport.dryRunPlannedWrites} missing=${mediaReport.missing.length} ambiguous=${mediaReport.ambiguous.length}`
        );
      }
      const userMapping = resolveUserMapping(record);
      if (!userMapping || userMapping.action === "skip") {
        mediaReport.skippedUsers++;
        return;
      }
      const mappedItemId = library.guidMap.get(record.sourceItemId) ?? library.guidMap.get(record.sourceItemId.toLowerCase());
      const match = mappedItemId
        ? { status: "matched" as const, item: { Id: mappedItemId }, confidence: "guid-map" as const }
        : matcher.match(record);
      if (match.status === "missing") {
        mediaReport.missing.push(reportRecord(record, match.reason));
        return;
      }
      if (match.status === "ambiguous") {
        mediaReport.ambiguous.push(reportRecord(record, match.reason, match.candidates.map((item) => ({ id: item.Id, name: item.Name }))));
        return;
      }
      if (input.dryRun) {
        mediaReport.dryRunPlannedWrites++;
        return;
      }
      const targetUserId = userMapping.newUserId;
      if (!targetUserId) {
        mediaReport.skippedUsers++;
        return;
      }
      try {
        const targetData = await client.getItemUserData(targetUserId, match.item.Id);
        if (!shouldOverwriteUserData(record.userData, targetData)) {
          mediaReport.skippedNewerTarget++;
          return;
        }
        await writeUserData(client, targetUserId, match.item.Id, record.userData);
        mediaReport.matched++;
      } catch (error) {
        mediaReport.failed.push(reportRecord(record, error instanceof Error ? error.message : String(error)));
      }
    });
  } finally {
    if (!input.dryRun) {
      input.onProgress?.("⠋ import policies: restoring final library access...");
      for (const mapping of mappings) {
        if (mapping.action === "skip" || !mapping.newUserId) continue;
        const sourceUser = sourceById.get(mapping.oldUserId);
        if (!sourceUser) continue;
        const policy = buildRestoredPolicy(sourceUser.policy, library.guidMap);
        if (Object.keys(policy).length > 0) await client.updateUserPolicy(mapping.newUserId, policy);
      }
    }
  }

  await writeReport(input.snapshotName, "user-map.json", mappings);
  await writeReport(input.snapshotName, "import-report.json", mediaReport);
  return { mappings, mediaReport, imageReport, manifest: snapshot.manifest };
}

export function createUserMappingResolver(mappings: UserMapping[]): (record: Pick<MediaRecord, "userId" | "userName">) => UserMapping | undefined {
  const byId = new Map(mappings.map((mapping) => [normalizeUserIdentity(mapping.oldUserId), mapping]));
  const byName = new Map(mappings.map((mapping) => [mapping.oldUserName.trim().toLowerCase(), mapping]));
  return (record) =>
    byId.get(normalizeUserIdentity(record.userId)) ?? byName.get(record.userName.trim().toLowerCase());
}

function normalizeUserIdentity(value: string): string {
  return value.replace(/-/g, "").toLowerCase();
}

async function restoreUserSettings(
  client: JellyfinClient,
  targetUserId: string,
  sourceUser: UserRecord,
  guidMap: Map<string, string>,
  temporaryFullLibraryAccess: boolean,
  onProgress?: (message: string) => void
): Promise<void> {
  onProgress?.(`Restoring settings for ${sourceUser.name}...`);
  if (sourceUser.configuration) {
    await client.updateUserConfiguration(targetUserId, remapGuidsInValue(sourceUser.configuration, guidMap) as Record<string, unknown>);
  }
  const safePolicy = buildRestoredPolicy(sourceUser.policy, guidMap);
  if (Object.keys(safePolicy).length > 0) {
    await client.updateUserPolicy(
      targetUserId,
      temporaryFullLibraryAccess ? buildTemporaryImportPolicy(safePolicy) : safePolicy
    );
  }
  for (const prefs of sourceUser.displayPreferences) {
    const displayPreferencesId = String(prefs.__displayPreferencesId ?? prefs.Id ?? "usersettings");
    const clientName = String(prefs.__client ?? prefs.Client ?? "emby");
    const clean = { ...prefs };
    delete clean.__displayPreferencesId;
    delete clean.__client;
    await client.updateDisplayPreferences(targetUserId, displayPreferencesId, clientName, remapGuidsInValue(clean, guidMap) as Record<string, unknown>);
  }
}

export function buildRestoredPolicy(policy: Record<string, unknown> | null, guidMap: Map<string, string>): Record<string, unknown> {
  return sanitizePolicy(remapGuidsInValue(policy, guidMap) as Record<string, unknown> | null);
}

export function buildTemporaryImportPolicy(finalPolicy: Record<string, unknown>): Record<string, unknown> {
  return { ...finalPolicy, EnableAllFolders: true, EnabledFolders: [] };
}

function sanitizePolicy(policy: Record<string, unknown> | null): Record<string, unknown> {
  if (!policy) return {};
  return Object.fromEntries(Object.entries(policy).filter(([key]) => SAFE_POLICY_KEYS.has(key)));
}

async function writeUserData(client: JellyfinClient, userId: string, itemId: string, source: UserItemData): Promise<void> {
  try {
    await client.updateItemUserData(userId, itemId, { ...source, ItemId: itemId });
  } catch (error) {
    if (error instanceof JellyfinApiError && source.Played) {
      await client.markPlayed(userId, itemId, source.LastPlayedDate);
      return;
    }
    throw error;
  }
}

function reportRecord(record: MediaRecord, reason: string, candidates?: unknown): Record<string, unknown> {
  return {
    reason,
    user: record.userName,
    sourceItemId: record.sourceItemId,
    type: record.type,
    name: record.name,
    seriesName: record.seriesName,
    season: record.parentIndexNumber,
    episode: record.indexNumber,
    providerIds: record.providerIds,
    candidates
  };
}

async function collectJsonl<T>(file: string): Promise<T[]> {
  const rows: T[] = [];
  try {
    for await (const row of readJsonl<T>(file)) rows.push(row);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return rows;
}

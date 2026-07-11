import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import type { MediaRecord, UserRecord } from "./types.js";
import { hasMeaningfulUserData, mergeUserData } from "./userdata.js";

export { mergeUserData } from "./userdata.js";

const execFileAsync = promisify(execFile);

type SqliteUserRow = {
  Id: string;
  Username: string;
  AudioLanguagePreference: string | null;
  CastReceiverId: string | null;
  DisplayCollectionsView: number;
  DisplayMissingEpisodes: number;
  EnableLocalPassword: number;
  EnableNextEpisodeAutoPlay: number;
  HidePlayedInLatest: number;
  PlayDefaultAudioTrack: number;
  RememberAudioSelections: number;
  RememberSubtitleSelections: number;
  SubtitleLanguagePreference: string | null;
  SubtitleMode: number;
  EnableUserPreferenceAccess: number;
};

type SqliteMediaRow = {
  UserId: string;
  Username: string;
  ItemId: string;
  CustomDataKey: string;
  Name: string | null;
  OriginalTitle: string | null;
  Type: string;
  ProductionYear: number | null;
  SeriesName: string | null;
  SeasonName: string | null;
  ParentIndexNumber: number | null;
  IndexNumber: number | null;
  Path: string | null;
  ProviderIds: string | null;
  IsFavorite: number;
  LastPlayedDate: string | null;
  Likes: number | null;
  PlayCount: number;
  PlaybackPositionTicks: number;
  Played: number;
  Rating: number | null;
};

export async function assertJellyfinDb(dbPath: string): Promise<void> {
  if (!existsSync(dbPath)) {
    throw new Error(`SQLite database does not exist: ${dbPath}`);
  }
  const tables = await sqliteJson<{ name: string }>(dbPath, "select name from sqlite_master where type='table'");
  const names = new Set(tables.map((table) => table.name));
  for (const required of ["Users", "UserData", "BaseItems", "BaseItemProviders"]) {
    if (!names.has(required)) {
      throw new Error(`SQLite database is missing required table ${required}`);
    }
  }
}

export async function exportUsersFromSqlite(dbPath: string): Promise<UserRecord[]> {
  const rows = await sqliteJson<SqliteUserRow>(
    dbPath,
    `select Id, Username, AudioLanguagePreference, CastReceiverId, DisplayCollectionsView,
            DisplayMissingEpisodes, EnableLocalPassword, EnableNextEpisodeAutoPlay,
            HidePlayedInLatest, PlayDefaultAudioTrack, RememberAudioSelections,
            RememberSubtitleSelections, SubtitleLanguagePreference, SubtitleMode,
            EnableUserPreferenceAccess
       from Users
      order by Username`
  );
  return rows.map((row) => ({
    id: row.Id,
    name: row.Username,
    configuration: {
      AudioLanguagePreference: row.AudioLanguagePreference,
      CastReceiverId: row.CastReceiverId,
      DisplayCollectionsView: Boolean(row.DisplayCollectionsView),
      DisplayMissingEpisodes: Boolean(row.DisplayMissingEpisodes),
      EnableLocalPassword: Boolean(row.EnableLocalPassword),
      EnableNextEpisodeAutoPlay: Boolean(row.EnableNextEpisodeAutoPlay),
      HidePlayedInLatest: Boolean(row.HidePlayedInLatest),
      PlayDefaultAudioTrack: Boolean(row.PlayDefaultAudioTrack),
      RememberAudioSelections: Boolean(row.RememberAudioSelections),
      RememberSubtitleSelections: Boolean(row.RememberSubtitleSelections),
      SubtitleLanguagePreference: row.SubtitleLanguagePreference,
      SubtitleMode: subtitleMode(row.SubtitleMode)
    },
    policy: {
      EnableUserPreferenceAccess: Boolean(row.EnableUserPreferenceAccess)
    },
    displayPreferences: [],
    raw: row as unknown as Record<string, unknown>
  }));
}

export async function exportMediaFromSqlite(dbPath: string): Promise<MediaRecord[]> {
  const rows = await sqliteJson<SqliteMediaRow>(
    dbPath,
    `select ud.UserId,
            u.Username,
            ud.ItemId,
            ud.CustomDataKey,
            bi.Name,
            bi.OriginalTitle,
            bi.Type,
            bi.ProductionYear,
            bi.SeriesName,
            bi.SeasonName,
            bi.ParentIndexNumber,
            bi.IndexNumber,
            bi.Path,
            group_concat(p.ProviderId || '=' || p.ProviderValue, char(31)) as ProviderIds,
            ud.IsFavorite,
            ud.LastPlayedDate,
            ud.Likes,
            ud.PlayCount,
            ud.PlaybackPositionTicks,
            ud.Played,
            ud.Rating
       from UserData ud
       join Users u on u.Id = ud.UserId
       join BaseItems bi on bi.Id = ud.ItemId
       left join BaseItemProviders p on p.ItemId = bi.Id
      where bi.Type in ('MediaBrowser.Controller.Entities.Movies.Movie',
                        'MediaBrowser.Controller.Entities.TV.Episode',
                        'Movie',
                        'Episode')
      group by ud.UserId, ud.ItemId, ud.CustomDataKey
      order by u.Username, bi.Type, bi.SeriesName, bi.ParentIndexNumber, bi.IndexNumber, bi.Name`
  );

  const merged = new Map<string, MediaRecord>();
  for (const row of rows) {
    const type = mapItemType(row.Type);
    if (!type) continue;
    const key = `${row.UserId}:${row.ItemId}`;
    const current: MediaRecord = {
      sourceItemId: row.ItemId,
      userId: row.UserId,
      userName: row.Username,
      type,
      name: row.Name ?? "",
      originalTitle: row.OriginalTitle,
      productionYear: row.ProductionYear,
      providerIds: parseProviderIds(row.ProviderIds),
      seriesName: row.SeriesName,
      seasonName: row.SeasonName,
      parentIndexNumber: row.ParentIndexNumber,
      indexNumber: row.IndexNumber,
      path: row.Path,
      userData: {
        Rating: row.Rating,
        PlaybackPositionTicks: row.PlaybackPositionTicks,
        PlayCount: row.PlayCount,
        IsFavorite: Boolean(row.IsFavorite),
        Likes: row.Likes === null ? null : Boolean(row.Likes),
        LastPlayedDate: normalizeSqliteDate(row.LastPlayedDate),
        Played: Boolean(row.Played),
        Key: row.CustomDataKey,
        ItemId: row.ItemId
      }
    };
    const previous = merged.get(key);
    merged.set(key, previous ? mergeMediaRecord(previous, current) : current);
  }
  return [...merged.values()].filter((record) => hasMeaningfulUserData(record.userData));
}

function mergeMediaRecord(left: MediaRecord, right: MediaRecord): MediaRecord {
  return {
    ...left,
    providerIds: { ...right.providerIds, ...left.providerIds },
    userData: mergeUserData(left.userData, right.userData)
  };
}

function parseProviderIds(value: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value) return result;
  for (const pair of value.split("\u001f")) {
    const equals = pair.indexOf("=");
    if (equals <= 0) continue;
    result[pair.slice(0, equals)] = pair.slice(equals + 1);
  }
  return result;
}

function mapItemType(type: string): "Movie" | "Episode" | null {
  if (type === "Movie" || type.endsWith(".Movies.Movie")) return "Movie";
  if (type === "Episode" || type.endsWith(".TV.Episode")) return "Episode";
  return null;
}

function normalizeSqliteDate(value: string | null): string | null {
  if (!value) return null;
  return value.includes("T") ? value : value.replace(" ", "T");
}

function subtitleMode(value: number): string {
  return ["Default", "Always", "OnlyForced", "None", "Smart"][value] ?? "Default";
}

async function sqliteJson<T>(dbPath: string, sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-json", dbPath, sql], {
    maxBuffer: 1024 * 1024 * 200
  });
  return JSON.parse(stdout || "[]") as T[];
}

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { JellyfinClient } from "./jellyfin.js";
import { stripImageMetadata } from "./image-metadata.js";
import type { JellyfinItemDto, LibraryItem } from "./types.js";

const execFileAsync = promisify(execFile);

type SqliteLibraryRow = {
  Id: string;
  Type: string;
  Name: string | null;
  OriginalTitle: string | null;
  SortName: string | null;
  Path: string | null;
  ParentId: string | null;
  SeriesId: string | null;
  SeasonId: string | null;
  SeriesName: string | null;
  SeasonName: string | null;
  ParentIndexNumber: number | null;
  IndexNumber: number | null;
  ProductionYear: number | null;
  PremiereDate: string | null;
  EndDate: string | null;
  RunTimeTicks: number | null;
  Overview: string | null;
  OfficialRating: string | null;
  CustomRating: string | null;
  CommunityRating: number | null;
  ProviderIds: string | null;
  ItemValues: string | null;
  People: string | null;
  Data: string | null;
};

export type LibraryProgress = (message: string) => void;

export async function exportLibraryFromApi(input: {
  serverUrl: string;
  apiKey: string;
  onProgress?: LibraryProgress;
}): Promise<LibraryItem[]> {
  const client = new JellyfinClient(input.serverUrl, input.apiKey);
  input.onProgress?.("⠋ library(api): scanning Movie/TV items...");
  const items = await client.getLogicalLibraryItems((progress) => {
    const total = progress.total === undefined ? "?" : String(progress.total);
    input.onProgress?.(`⠙ library(api): items ${progress.fetched}/${total}`);
  });
  const virtualFolders = await client.getVirtualFolders();
  const library = [...virtualFolders, ...items].map(libraryItemFromApi).filter((item): item is LibraryItem => item !== null);
  input.onProgress?.(`⠹ library(api): ${library.length} logical items exported`);
  return library;
}

export async function exportLibraryFromSqlite(input: { dbPath: string; onProgress?: LibraryProgress }): Promise<LibraryItem[]> {
  input.onProgress?.("⠋ library(sqlite): reading BaseItems/BaseItemProviders...");
  const rows = await sqliteJson<SqliteLibraryRow>(
    input.dbPath,
    `select bi.Id,
            bi.Type,
            bi.Name,
            bi.OriginalTitle,
            bi.SortName,
            bi.Path,
            bi.ParentId,
            bi.SeriesId,
            bi.SeasonId,
            bi.SeriesName,
            bi.SeasonName,
            bi.ParentIndexNumber,
            bi.IndexNumber,
            bi.ProductionYear,
            bi.PremiereDate,
            bi.EndDate,
            bi.RunTimeTicks,
            bi.Overview,
            bi.OfficialRating,
            bi.CustomRating,
            bi.CommunityRating,
            group_concat(distinct p.ProviderId || '=' || p.ProviderValue) as ProviderIds,
            group_concat(distinct iv.Type || '=' || replace(iv.Value, ',', '%2C')) as ItemValues,
            group_concat(distinct ppl.Name || '=' || coalesce(ppl.PersonType, '') || '=' || replace(pbm.Role, ',', '%2C') || '=' || coalesce(pbm.ListOrder, 0)) as People,
            bi.Data
       from BaseItems bi
       left join BaseItemProviders p on p.ItemId = bi.Id
       left join ItemValuesMap ivm on ivm.ItemId = bi.Id
       left join ItemValues iv on iv.ItemValueId = ivm.ItemValueId
       left join PeopleBaseItemMap pbm on pbm.ItemId = bi.Id
       left join Peoples ppl on ppl.Id = pbm.PeopleId
      where bi.Type in ('MediaBrowser.Controller.Entities.Movies.Movie',
                        'MediaBrowser.Controller.Entities.TV.Series',
                        'MediaBrowser.Controller.Entities.TV.Season',
                        'MediaBrowser.Controller.Entities.TV.Episode',
                        'MediaBrowser.Controller.Entities.CollectionFolder',
                        'Movie','Series','Season','Episode','CollectionFolder')
      group by bi.Id
      order by bi.Type, bi.SeriesName, bi.ParentIndexNumber, bi.IndexNumber, bi.Name`
  );
  const library = rows.map(libraryItemFromSqlite).filter((item): item is LibraryItem => item !== null);
  input.onProgress?.(`⠹ library(sqlite): ${library.length} logical items exported`);
  return library;
}

export function libraryItemFromApi(item: JellyfinItemDto): LibraryItem | null {
  const type = normalizeLibraryType(item.Type ?? "");
  if (!type) return null;
  const parts = pathParts(item.Path ?? null);
  return {
    sourceItemId: item.Id,
    type,
    name: item.Name ?? "",
    originalTitle: item.OriginalTitle ?? null,
    sortName: item.SortName ?? null,
    path: item.Path ?? null,
    ...parts,
    providerIds: item.ProviderIds ?? {},
    parentId: item.ParentId ?? null,
    seriesId: item.SeriesId ?? null,
    seasonId: item.SeasonId ?? null,
    seriesName: item.SeriesName ?? null,
    seasonName: item.SeasonName ?? null,
    parentIndexNumber: item.ParentIndexNumber ?? null,
    indexNumber: item.IndexNumber ?? null,
    productionYear: item.ProductionYear ?? null,
    premiereDate: item.PremiereDate ?? null,
    endDate: item.EndDate ?? null,
    status: item.Status ?? null,
    airTime: item.AirTime ?? null,
    airDays: item.AirDays ?? [],
    displayOrder: item.DisplayOrder ?? null,
    runTimeTicks: item.RunTimeTicks ?? null,
    overview: item.Overview ?? null,
    genres: item.Genres ?? [],
    tags: item.Tags ?? [],
    studios: (item.Studios ?? []).map((studio) => studio.Name).filter((name): name is string => Boolean(name)),
    people: stripImageMetadata(item.People ?? []),
    officialRating: item.OfficialRating ?? null,
    customRating: item.CustomRating ?? null,
    communityRating: item.CommunityRating ?? null,
    taglines: item.Taglines ?? [],
    lockData: item.LockData ?? null,
    lockedFields: item.LockedFields ?? [],
    raw: item
  };
}

function libraryItemFromSqlite(row: SqliteLibraryRow): LibraryItem | null {
  const type = normalizeLibraryType(row.Type);
  if (!type) return null;
  const itemValues = parseItemValues(row.ItemValues);
  const data = parseData(row.Data);
  return {
    sourceItemId: row.Id,
    type,
    name: row.Name ?? "",
    originalTitle: row.OriginalTitle,
    sortName: row.SortName,
    path: type === "CollectionFolder" ? collectionFolderLocation(data, row.Path) : row.Path,
    ...pathParts(type === "CollectionFolder" ? collectionFolderLocation(data, row.Path) : row.Path),
    providerIds: parseProviderIds(row.ProviderIds),
    parentId: row.ParentId,
    seriesId: row.SeriesId,
    seasonId: row.SeasonId,
    seriesName: row.SeriesName,
    seasonName: row.SeasonName,
    parentIndexNumber: row.ParentIndexNumber,
    indexNumber: row.IndexNumber,
    productionYear: row.ProductionYear,
    premiereDate: normalizeDate(row.PremiereDate),
    endDate: normalizeDate(row.EndDate),
    status: stringValue(data?.Status),
    airTime: stringValue(data?.AirTime),
    airDays: stringArray(data?.AirDays),
    displayOrder: stringValue(data?.DisplayOrder),
    runTimeTicks: row.RunTimeTicks,
    overview: row.Overview,
    genres: itemValues[0] ?? [],
    tags: itemValues[4] ?? [],
    studios: itemValues[3] ?? [],
    people: parsePeople(row.People),
    officialRating: row.OfficialRating,
    customRating: row.CustomRating,
    communityRating: row.CommunityRating,
    taglines: [],
    lockData: null,
    lockedFields: [],
    raw: { itemValues, data }
  };
}

export function normalizeLibraryType(type: string): LibraryItem["type"] | null {
  if (type === "Movie" || type.endsWith(".Movies.Movie")) return "Movie";
  if (type === "Series" || type.endsWith(".TV.Series")) return "Series";
  if (type === "Season" || type.endsWith(".TV.Season")) return "Season";
  if (type === "Episode" || type.endsWith(".TV.Episode")) return "Episode";
  if (type === "CollectionFolder" || type.endsWith(".CollectionFolder")) return "CollectionFolder";
  return null;
}

function collectionFolderLocation(data: Record<string, unknown> | null, fallback: string | null): string | null {
  const locations = data?.PhysicalLocationsList;
  if (!Array.isArray(locations)) return fallback;
  return locations.find((value): value is string => typeof value === "string" && !value.includes("/config/data/root/")) ?? fallback;
}

export function pathParts(value: string | null): Pick<LibraryItem, "fileName" | "parentDirName" | "grandParentDirName"> {
  if (!value) return { fileName: null, parentDirName: null, grandParentDirName: null };
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return {
    fileName: parts.at(-1) ?? null,
    parentDirName: parts.at(-2) ?? null,
    grandParentDirName: parts.at(-3) ?? null
  };
}

export function parseProviderIds(value: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value) return result;
  for (const pair of value.split(",")) {
    const equals = pair.indexOf("=");
    if (equals <= 0) continue;
    result[pair.slice(0, equals)] = pair.slice(equals + 1);
  }
  return result;
}

function parseItemValues(value: string | null): Record<number, string[]> {
  const result: Record<number, string[]> = {};
  if (!value) return result;
  for (const pair of value.split(",")) {
    const equals = pair.indexOf("=");
    if (equals <= 0) continue;
    const type = Number(pair.slice(0, equals));
    const entry = pair.slice(equals + 1).replace(/%2C/g, ",");
    if (!Number.isFinite(type) || !entry) continue;
    result[type] = [...(result[type] ?? []), entry];
  }
  return result;
}

function parsePeople(value: string | null): Array<Record<string, unknown>> {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => {
      const [Name, Type, Role, SortOrder] = entry.split("=");
      return { Name, Type, Role: Role ? Role.replace(/%2C/g, ",") : undefined, SortOrder: Number(SortOrder ?? 0) };
    })
    .filter((person) => Boolean(person.Name));
}

function parseData(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  return value.includes("T") ? value : value.replace(" ", "T");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

async function sqliteJson<T>(dbPath: string, sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-json", dbPath, sql], {
    maxBuffer: 1024 * 1024 * 300
  });
  return JSON.parse(stdout || "[]") as T[];
}

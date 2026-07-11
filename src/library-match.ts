import { mapConcurrent } from "./concurrency.js";
import { libraryItemFromApi } from "./library.js";
import { addGuidMapping } from "./remap.js";
import { stripImageMetadata } from "./image-metadata.js";
import type { JellyfinItemDto, LibraryItem } from "./types.js";

export type ItemMapEntry = {
  oldItemId: string;
  oldType: LibraryItem["type"];
  oldName: string;
  newItemId: string;
  newName: string;
  newType: LibraryItem["type"];
  confidence: number;
  method: string;
};

export type LibraryDiff = {
  summary: {
    source: number;
    target: number;
    matched: number;
    unmatched: number;
    ambiguous: number;
    changed: number;
    unchanged: number;
  };
  matches: ItemMapEntry[];
  unmatched: Array<Record<string, unknown>>;
  ambiguous: Array<Record<string, unknown>>;
  changes: Array<{ oldItemId: string; newItemId: string; type: string; name: string; fields: Record<string, { source: unknown; target: unknown }> }>;
};

export function buildLibraryDiff(source: LibraryItem[], targetDtos: JellyfinItemDto[]): {
  diff: LibraryDiff;
  guidMap: Map<string, string>;
  targetById: Map<string, LibraryItem>;
  targetDtoById: Map<string, JellyfinItemDto>;
} {
  const target = targetDtos.map(libraryItemFromApi).filter((item): item is LibraryItem => item !== null);
  const matcher = new LibraryMatcher(target);
  const matches: ItemMapEntry[] = [];
  const unmatched: Array<Record<string, unknown>> = [];
  const ambiguous: Array<Record<string, unknown>> = [];

  for (const sourceItem of source.filter((item) => item.type === "Movie" || item.type === "Episode")) {
    const result = matcher.matchLeaf(sourceItem);
    if (result.status === "matched") {
      matches.push(toEntry(sourceItem, result.item, result.confidence, result.method));
    } else if (result.status === "ambiguous") {
      ambiguous.push(reportSource(sourceItem, result.reason, result.candidates));
    } else {
      unmatched.push(reportSource(sourceItem, result.reason));
    }
  }

  const derived = matcher.deriveParents(source, matches);
  matches.push(...derived.matches);
  unmatched.push(...derived.unmatched);
  ambiguous.push(...derived.ambiguous);

  const roots = matcher.deriveCollectionFolders(source, matches);
  matches.push(...roots.matches);
  unmatched.push(...roots.unmatched);
  ambiguous.push(...roots.ambiguous);

  const guidMap = new Map<string, string>();
  for (const match of matches) addGuidMapping(guidMap, match.oldItemId, match.newItemId);
  const targetById = new Map(target.map((item) => [item.sourceItemId, item]));
  const targetDtoById = new Map(targetDtos.map((item) => [item.Id, item]));

  const changes = matches
    .map((match) => {
      const sourceItem = source.find((item) => item.sourceItemId === match.oldItemId);
      const targetItem = targetById.get(match.newItemId);
      if (!sourceItem || !targetItem) return null;
      if (sourceItem.type === "CollectionFolder") return null;
      const fields = diffMetadata(sourceItem, targetItem);
      return Object.keys(fields).length > 0
        ? { oldItemId: match.oldItemId, newItemId: match.newItemId, type: match.oldType, name: match.oldName, fields }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return {
    diff: {
      summary: {
        source: source.length,
        target: target.length,
        matched: matches.length,
        unmatched: unmatched.length,
        ambiguous: ambiguous.length,
        changed: changes.length,
        unchanged: matches.length - changes.length
      },
      matches,
      unmatched,
      ambiguous,
      changes
    },
    guidMap,
    targetById,
    targetDtoById
  };
}

export async function buildMetadataUpdates(input: {
  changes: LibraryDiff["changes"];
  source: LibraryItem[];
  targetDtoById: Map<string, JellyfinItemDto>;
  concurrency: number;
}): Promise<Array<{ itemId: string; body: Record<string, unknown>; name: string }>> {
  const sourceById = new Map(input.source.map((item) => [item.sourceItemId, item]));
  return mapConcurrent(input.changes, input.concurrency, async (change) => {
    const source = sourceById.get(change.oldItemId)!;
    const target = input.targetDtoById.get(change.newItemId)!;
    return { itemId: change.newItemId, body: mergeMetadataForUpdate(target, source), name: source.name };
  });
}

export function mergeMetadataForUpdate(target: JellyfinItemDto, source: LibraryItem): Record<string, unknown> {
  const body: Record<string, unknown> = { ...target };
  const set = (key: string, value: unknown) => {
    if (value !== undefined) body[key] = value;
  };
  set("ProviderIds", source.providerIds);
  set("Name", source.name);
  set("OriginalTitle", source.originalTitle ?? null);
  set("SortName", source.sortName ?? null);
  set("Overview", source.overview ?? null);
  set("Genres", source.genres);
  set("Tags", source.tags);
  set("Studios", source.studios.map((Name) => ({ Name })));
  set("People", source.people);
  set("PremiereDate", source.premiereDate ?? null);
  set("EndDate", sourceMetadata(source, "endDate", "EndDate", null));
  set("ProductionYear", source.productionYear ?? null);
  set("Status", sourceMetadata(source, "status", "Status", null));
  set("AirTime", sourceMetadata(source, "airTime", "AirTime", null));
  set("AirDays", sourceMetadata(source, "airDays", "AirDays", []));
  set("RunTimeTicks", sourceMetadata(source, "runTimeTicks", "RunTimeTicks", null));
  const displayOrder = sourceMetadata(source, "displayOrder", "DisplayOrder", undefined);
  if (displayOrder !== undefined) set("DisplayOrder", displayOrder);
  set("OfficialRating", source.officialRating ?? null);
  set("CustomRating", source.customRating ?? null);
  set("CommunityRating", source.communityRating ?? null);
  set("Taglines", source.taglines);
  set("IndexNumber", source.indexNumber ?? null);
  set("ParentIndexNumber", source.parentIndexNumber ?? null);
  set("LockData", source.lockData ?? body.LockData ?? false);
  set("LockedFields", source.lockedFields);
  for (const forbidden of [
    "Path",
    "ParentId",
    "SeriesId",
    "SeasonId",
    "UserData",
    "ImageTags",
    "BackdropImageTags",
    "MediaSources",
    "Width",
    "Height"
  ]) {
    delete body[forbidden];
  }
  if (source.type !== "Series") delete body.RunTimeTicks;
  return stripImageMetadata(body);
}

class LibraryMatcher {
  private byProvider = new Map<string, LibraryItem[]>();
  private byFile = new Map<string, LibraryItem[]>();
  private byName = new Map<string, LibraryItem[]>();
  private byId: Map<string, LibraryItem>;

  constructor(private target: LibraryItem[]) {
    this.byId = new Map(target.map((item) => [item.sourceItemId, item]));
    for (const item of target) {
      for (const [provider, id] of Object.entries(item.providerIds)) this.push(this.byProvider, providerKey(provider, id), item);
      if (item.fileName) this.push(this.byFile, `${item.type}:${norm(item.fileName)}`, item);
      this.push(this.byName, `${item.type}:${norm(item.name)}:${item.productionYear ?? ""}:${item.parentIndexNumber ?? ""}:${item.indexNumber ?? ""}`, item);
    }
  }

  matchLeaf(source: LibraryItem): MatchResult {
    if (source.fileName) {
      const candidates = (this.byFile.get(`${source.type}:${norm(source.fileName)}`) ?? []).filter((item) => item.type === source.type);
      const ranked = rankCandidates(source, candidates);
      if (ranked.length === 1 && ranked[0]!.score >= 100) {
        return { status: "matched", item: ranked[0]!.item, confidence: ranked[0]!.score, method: "filename" };
      }
      if (ranked.length > 1 && ranked[0]!.score > ranked[1]!.score && ranked[0]!.score >= 100) {
        return { status: "matched", item: ranked[0]!.item, confidence: ranked[0]!.score, method: "filename+context" };
      }
      if (ranked.length > 0) return { status: "ambiguous", candidates: ranked.map((entry) => entry.item), reason: "multiple filename matches" };
    }

    for (const [provider, id] of Object.entries(source.providerIds)) {
      const candidates = (this.byProvider.get(providerKey(provider, id)) ?? []).filter((item) => item.type === source.type);
      if (candidates.length === 1) return { status: "matched", item: candidates[0]!, confidence: 80, method: "provider" };
      if (candidates.length > 1) return { status: "ambiguous", candidates, reason: "multiple provider matches" };
    }

    const fallback = this.byName.get(`${source.type}:${norm(source.name)}:${source.productionYear ?? ""}:${source.parentIndexNumber ?? ""}:${source.indexNumber ?? ""}`) ?? [];
    if (fallback.length === 1) return { status: "matched", item: fallback[0]!, confidence: 50, method: "name" };
    if (fallback.length > 1) return { status: "ambiguous", candidates: fallback, reason: "multiple name matches" };
    return { status: "missing", reason: "no logical match" };
  }

  deriveParents(source: LibraryItem[], leafMatches: ItemMapEntry[]) {
    const targetBySourceId = new Map(leafMatches.map((entry) => [entry.oldItemId, entry.newItemId]));
    const matches: ItemMapEntry[] = [];
    const unmatched: Array<Record<string, unknown>> = [];
    const ambiguous: Array<Record<string, unknown>> = [];
    const already = new Set(leafMatches.map((entry) => entry.oldItemId));

    for (const sourceItem of source.filter((item) => item.type === "Series" || item.type === "Season")) {
      if (already.has(sourceItem.sourceItemId)) continue;
      const provider = this.matchByProviderOnly(sourceItem);
      if (provider.status === "matched") {
        matches.push(toEntry(sourceItem, provider.item, provider.confidence, provider.method));
        continue;
      }

      const children = source.filter((item) => item.type === "Episode" && (sourceItem.type === "Series" ? item.seriesId === sourceItem.sourceItemId : item.seasonId === sourceItem.sourceItemId));
      const counts = new Map<string, number>();
      for (const child of children) {
        const targetChild = targetBySourceId.get(child.sourceItemId);
        if (!targetChild) continue;
        const targetParentId = sourceItem.type === "Series" ? this.byId.get(targetChild)?.seriesId : this.byId.get(targetChild)?.seasonId;
        if (targetParentId) counts.set(targetParentId, (counts.get(targetParentId) ?? 0) + 1);
      }
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length > 0 && (ranked.length === 1 || ranked[0]![1] > ranked[1]![1])) {
        const item = this.byId.get(ranked[0]![0]);
        if (item) {
          matches.push(toEntry(sourceItem, item, 70 + ranked[0]![1], "derived-from-episodes"));
          continue;
        }
      }
      if (provider.status === "ambiguous") {
        ambiguous.push(reportSource(sourceItem, provider.reason, provider.candidates));
        continue;
      }
      const fallback = this.byName.get(`${sourceItem.type}:${norm(sourceItem.name)}:${sourceItem.productionYear ?? ""}:${sourceItem.parentIndexNumber ?? ""}:${sourceItem.indexNumber ?? ""}`) ?? [];
      if (fallback.length === 1) matches.push(toEntry(sourceItem, fallback[0]!, 45, "name"));
      else if (fallback.length > 1) ambiguous.push(reportSource(sourceItem, "multiple parent fallback matches", fallback));
      else unmatched.push(reportSource(sourceItem, "no parent match"));
    }
    return { matches, unmatched, ambiguous };
  }

  deriveCollectionFolders(source: LibraryItem[], itemMatches: ItemMapEntry[]) {
    const matches: ItemMapEntry[] = [];
    const unmatched: Array<Record<string, unknown>> = [];
    const ambiguous: Array<Record<string, unknown>> = [];
    const targetRoots = this.target.filter((item) => item.type === "CollectionFolder" && item.path);
    const sourceById = new Map(source.map((item) => [item.sourceItemId, item]));

    for (const sourceRoot of source.filter((item) => item.type === "CollectionFolder")) {
      const counts = new Map<string, number>();
      for (const match of itemMatches.filter((entry) => entry.oldType === "Movie" || entry.oldType === "Episode")) {
        const sourceItem = sourceById.get(match.oldItemId);
        const targetItem = this.byId.get(match.newItemId);
        if (!isPathWithin(sourceItem?.path, sourceRoot.path) || !targetItem?.path) continue;
        const targetRoot = targetRoots.find((root) => isPathWithin(targetItem.path, root.path));
        if (targetRoot) counts.set(targetRoot.sourceItemId, (counts.get(targetRoot.sourceItemId) ?? 0) + 1);
      }
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length > 0 && (ranked.length === 1 || ranked[0]![1] > ranked[1]![1])) {
        const targetRoot = this.byId.get(ranked[0]![0]);
        if (targetRoot) {
          matches.push(toEntry(sourceRoot, targetRoot, 70 + ranked[0]![1], "derived-from-library-content"));
          continue;
        }
      }
      const byName = targetRoots.filter((root) => norm(root.name) === norm(sourceRoot.name));
      if (byName.length === 1) matches.push(toEntry(sourceRoot, byName[0]!, 50, "name"));
      else if (ranked.length > 1 || byName.length > 1) ambiguous.push(reportSource(sourceRoot, "multiple collection folder matches", byName));
      else unmatched.push(reportSource(sourceRoot, "no collection folder match"));
    }
    return { matches, unmatched, ambiguous };
  }

  private matchByProviderOnly(source: LibraryItem): MatchResult {
    for (const [provider, id] of Object.entries(source.providerIds)) {
      const candidates = (this.byProvider.get(providerKey(provider, id)) ?? []).filter((item) => item.type === source.type);
      if (candidates.length === 1) return { status: "matched", item: candidates[0]!, confidence: 85, method: "provider" };
      if (candidates.length > 1) return { status: "ambiguous", candidates, reason: "multiple provider parent matches" };
    }
    return { status: "missing", reason: "no provider parent match" };
  }

  private push(index: Map<string, LibraryItem[]>, key: string, item: LibraryItem): void {
    if (!key) return;
    index.set(key, [...(index.get(key) ?? []), item]);
  }
}

type MatchResult =
  | { status: "matched"; item: LibraryItem; confidence: number; method: string }
  | { status: "ambiguous"; candidates: LibraryItem[]; reason: string }
  | { status: "missing"; reason: string };

function rankCandidates(source: LibraryItem, candidates: LibraryItem[]) {
  return candidates
    .map((item) => {
      let score = 100;
      if (source.parentDirName && norm(source.parentDirName) === norm(item.parentDirName)) score += 20;
      if (source.grandParentDirName && norm(source.grandParentDirName) === norm(item.grandParentDirName)) score += 10;
      if (source.parentIndexNumber !== null && source.parentIndexNumber === item.parentIndexNumber) score += 10;
      if (source.indexNumber !== null && source.indexNumber === item.indexNumber) score += 10;
      for (const [provider, id] of Object.entries(source.providerIds)) {
        if (item.providerIds[provider] === id) score += 25;
      }
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);
}

function diffMetadata(source: LibraryItem, target: LibraryItem) {
  const fields: Record<string, { source: unknown; target: unknown }> = {};
  const keys: Array<[string, unknown, unknown]> = [
    ["ProviderIds", source.providerIds, target.providerIds],
    ["Name", source.name, target.name],
    ["OriginalTitle", source.originalTitle, target.originalTitle],
    ["SortName", source.sortName, target.sortName],
    ["Overview", source.overview, target.overview],
    ["Genres", source.genres, target.genres],
    ["Tags", source.tags, target.tags],
    ["Studios", source.studios, target.studios],
    ["People", source.people, target.people],
    ["PremiereDate", source.premiereDate, target.premiereDate],
    ["EndDate", sourceMetadata(source, "endDate", "EndDate", null), target.endDate],
    ["ProductionYear", source.productionYear, target.productionYear],
    ["Status", sourceMetadata(source, "status", "Status", null), target.status],
    ["AirTime", sourceMetadata(source, "airTime", "AirTime", null), target.airTime],
    ["AirDays", sourceMetadata(source, "airDays", "AirDays", []), target.airDays],
    ["RunTimeTicks", sourceMetadata(source, "runTimeTicks", "RunTimeTicks", null), target.runTimeTicks],
    ["DisplayOrder", sourceMetadata(source, "displayOrder", "DisplayOrder", undefined), target.displayOrder],
    ["OfficialRating", source.officialRating, target.officialRating],
    ["CustomRating", source.customRating, target.customRating],
    ["CommunityRating", source.communityRating, target.communityRating],
    ["Taglines", source.taglines, target.taglines],
    ["IndexNumber", source.indexNumber, target.indexNumber],
    ["ParentIndexNumber", source.parentIndexNumber, target.parentIndexNumber],
    ["LockData", source.lockData, target.lockData],
    ["LockedFields", source.lockedFields, target.lockedFields]
  ];
  for (const [key, sourceValue, targetValue] of keys) {
    if (JSON.stringify(sourceValue ?? null) !== JSON.stringify(targetValue ?? null)) fields[key] = { source: sourceValue ?? null, target: targetValue ?? null };
  }
  return fields;
}

function sourceMetadata(
  source: LibraryItem,
  key: keyof LibraryItem,
  rawKey: string,
  fallback: unknown
): unknown {
  if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  if (source.raw && Object.prototype.hasOwnProperty.call(source.raw, rawKey)) return source.raw[rawKey];
  return fallback;
}

function toEntry(source: LibraryItem, target: LibraryItem, confidence: number, method: string): ItemMapEntry {
  return {
    oldItemId: source.sourceItemId,
    oldType: source.type,
    oldName: source.name,
    newItemId: target.sourceItemId,
    newName: target.name,
    newType: target.type,
    confidence,
    method
  };
}

function reportSource(source: LibraryItem, reason: string, candidates?: LibraryItem[]) {
  return {
    reason,
    oldItemId: source.sourceItemId,
    type: source.type,
    name: source.name,
    path: source.path,
    providerIds: source.providerIds,
    candidates: candidates?.map((item) => ({ id: item.sourceItemId, type: item.type, name: item.name, path: item.path }))
  };
}

function providerKey(provider: string, id: string): string {
  return `${provider.toLowerCase()}:${id.trim().toLowerCase()}`;
}

function norm(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim().toLowerCase().replace(/[._:：\-–—]+/g, " ").replace(/\s+/g, " ");
}

function isPathWithin(itemPath: string | null | undefined, rootPath: string | null | undefined): boolean {
  if (!itemPath || !rootPath) return false;
  const item = itemPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const root = rootPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return item === root || item.startsWith(`${root}/`);
}

import type { JellyfinItemDto, MediaRecord, UserItemData } from "./types.js";

export type CatalogMatch =
  | { status: "matched"; item: JellyfinItemDto; confidence: "provider" | "fallback" }
  | { status: "missing"; reason: string }
  | { status: "ambiguous"; candidates: JellyfinItemDto[]; reason: string };

export function normalizeName(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[._:：\-–—]+/g, " ")
    .replace(/\s+/g, " ");
}

export class MediaMatcher {
  private providerIndex = new Map<string, JellyfinItemDto[]>();
  private movieFallbackIndex = new Map<string, JellyfinItemDto[]>();
  private episodeFallbackIndex = new Map<string, JellyfinItemDto[]>();

  constructor(items: JellyfinItemDto[]) {
    for (const item of items) {
      for (const [provider, id] of Object.entries(item.ProviderIds ?? {})) {
        this.push(this.providerIndex, providerKey(provider, id), item);
      }
      if (item.Type === "Movie") {
        this.push(this.movieFallbackIndex, movieFallbackKey(item.Name, item.ProductionYear ?? null), item);
      } else if (item.Type === "Episode") {
        this.push(
          this.episodeFallbackIndex,
          episodeFallbackKey(item.SeriesName, item.ParentIndexNumber ?? null, item.IndexNumber ?? null, item.Name),
          item
        );
      }
    }
  }

  match(record: MediaRecord): CatalogMatch {
    for (const [provider, id] of Object.entries(record.providerIds)) {
      const candidates = this.providerIndex.get(providerKey(provider, id)) ?? [];
      const typed = candidates.filter((item) => item.Type === record.type);
      if (typed.length === 1) return { status: "matched", item: typed[0]!, confidence: "provider" };
      if (typed.length > 1) return { status: "ambiguous", candidates: typed, reason: "multiple provider id matches" };
    }

    const key =
      record.type === "Movie"
        ? movieFallbackKey(record.name, record.productionYear ?? null)
        : episodeFallbackKey(record.seriesName, record.parentIndexNumber ?? null, record.indexNumber ?? null, record.name);
    const candidates = (record.type === "Movie" ? this.movieFallbackIndex : this.episodeFallbackIndex).get(key) ?? [];
    if (candidates.length === 1) return { status: "matched", item: candidates[0]!, confidence: "fallback" };
    if (candidates.length > 1) return { status: "ambiguous", candidates, reason: "multiple fallback matches" };
    return { status: "missing", reason: "no provider or fallback match" };
  }

  private push(index: Map<string, JellyfinItemDto[]>, key: string, item: JellyfinItemDto): void {
    if (!key) return;
    const existing = index.get(key);
    if (existing) existing.push(item);
    else index.set(key, [item]);
  }
}

export function shouldOverwriteUserData(source: UserItemData, target: UserItemData | null): boolean {
  if (!target) return true;
  const sourceDate = parseDate(source.LastPlayedDate);
  const targetDate = parseDate(target.LastPlayedDate);
  if (sourceDate !== null || targetDate !== null) {
    return (sourceDate ?? 0) > (targetDate ?? 0);
  }
  return (source.PlaybackPositionTicks ?? 0) > (target.PlaybackPositionTicks ?? 0);
}

function providerKey(provider: string, id: string): string {
  return `${provider.toLowerCase()}:${id.trim().toLowerCase()}`;
}

function movieFallbackKey(name: string | null | undefined, year: number | null | undefined): string {
  return `${normalizeName(name)}:${year ?? ""}`;
}

function episodeFallbackKey(
  seriesName: string | null | undefined,
  season: number | null | undefined,
  episode: number | null | undefined,
  name: string | null | undefined
): string {
  return `${normalizeName(seriesName)}:${season ?? ""}:${episode ?? ""}:${normalizeName(name)}`;
}

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : null;
}


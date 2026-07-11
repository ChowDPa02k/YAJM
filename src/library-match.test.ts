import { describe, expect, it } from "vitest";
import { buildLibraryDiff, mergeMetadataForUpdate } from "./library-match.js";
import type { JellyfinItemDto, LibraryItem } from "./types.js";

function item(partial: Partial<LibraryItem>): LibraryItem {
  return {
    sourceItemId: partial.sourceItemId ?? "old",
    type: partial.type ?? "Movie",
    name: partial.name ?? "Name",
    path: partial.path ?? null,
    fileName: partial.fileName ?? null,
    parentDirName: partial.parentDirName ?? null,
    grandParentDirName: partial.grandParentDirName ?? null,
    parentId: partial.parentId ?? null,
    seriesId: partial.seriesId ?? null,
    seasonId: partial.seasonId ?? null,
    providerIds: partial.providerIds ?? {},
    genres: partial.genres ?? [],
    tags: partial.tags ?? [],
    studios: partial.studios ?? [],
    people: partial.people ?? [],
    taglines: partial.taglines ?? [],
    lockedFields: partial.lockedFields ?? [],
    raw: partial.raw
  };
}

describe("library matching", () => {
  it("matches path-reorganized movies by filename", () => {
    const source = [item({ sourceItemId: "old-movie", type: "Movie", name: "Hero", fileName: "Hero.mkv", parentDirName: "old-root" })];
    const target: JellyfinItemDto[] = [{ Id: "new-movie", Type: "Movie", Name: "Hero", Path: "/new/root/Hero.mkv" }];
    const result = buildLibraryDiff(source, target);
    expect(result.diff.matches[0]?.newItemId).toBe("new-movie");
    expect(result.guidMap.get("old-movie")).toBe("new-movie");
  });

  it("derives series from matched episodes", () => {
    const source = [
      item({ sourceItemId: "old-series", type: "Series", name: "Show" }),
      item({ sourceItemId: "old-episode", type: "Episode", name: "Ep", fileName: "Show.S01E01.mkv", seriesId: "old-series" })
    ];
    const target: JellyfinItemDto[] = [
      { Id: "new-series", Type: "Series", Name: "Show" },
      { Id: "new-episode", Type: "Episode", Name: "Ep", Path: "/tv/Show/Season 1/Show.S01E01.mkv", SeriesId: "new-series" }
    ];
    const result = buildLibraryDiff(source, target);
    expect(result.guidMap.get("old-series")).toBe("new-series");
  });

  it("uses matched episodes to resolve multiple provider-id parent candidates", () => {
    const source = [
      item({ sourceItemId: "old-series", type: "Series", name: "Show", providerIds: { Tvdb: "1" } }),
      item({ sourceItemId: "old-episode", type: "Episode", name: "Ep", fileName: "unique.mkv", seriesId: "old-series" })
    ];
    const target: JellyfinItemDto[] = [
      { Id: "right-series", Type: "Series", Name: "Show A", ProviderIds: { Tvdb: "1" } },
      { Id: "wrong-series", Type: "Series", Name: "Show B", ProviderIds: { Tvdb: "1" } },
      { Id: "right-episode", Type: "Episode", Name: "Ep", Path: "/bahamut/unique.mkv", SeriesId: "right-series" }
    ];

    const result = buildLibraryDiff(source, target);

    expect(result.guidMap.get("old-series")).toBe("right-series");
    expect(result.diff.matches.find((entry) => entry.oldItemId === "old-series")?.method).toBe("derived-from-episodes");
  });

  it("does not write environment-owned fields into metadata update body", () => {
    const body = mergeMetadataForUpdate(
      {
        Id: "new",
        Type: "Movie",
        Name: "Target",
        Path: "/new/movie.mkv",
        RunTimeTicks: 1,
        ImageTags: { Primary: "target-image" },
        ImageBlurHashes: { Primary: { target: "hash" } },
        ParentBackdropItemId: "target-parent-image"
      },
      item({ sourceItemId: "old", type: "Movie", name: "Source", path: "/old/movie.mkv", providerIds: { Tmdb: "1" } })
    );
    expect(body.Name).toBe("Source");
    expect(body.ProviderIds).toEqual({ Tmdb: "1" });
    expect(body.Path).toBeUndefined();
    expect(body.RunTimeTicks).toBeUndefined();
    expect(body.ImageTags).toBeUndefined();
    expect(body.ImageBlurHashes).toBeUndefined();
    expect(body.ParentBackdropItemId).toBeUndefined();
  });

  it("removes nested source image references from people metadata", () => {
    const body = mergeMetadataForUpdate(
      { Id: "new", Type: "Movie", Name: "Target" },
      item({
        people: [
          {
            Name: "Actor",
            Type: "Actor",
            PrimaryImageTag: "source-image",
            ImageBlurHashes: { Primary: { source: "hash" } }
          }
        ]
      })
    );

    expect(body.People).toEqual([{ Name: "Actor", Type: "Actor" }]);
  });

  it("restores Series scheduling fields from an existing snapshot raw DTO", () => {
    const source = item({
      type: "Series",
      raw: {
        Status: "Continuing",
        AirTime: "00:00",
        AirDays: ["Thursday"],
        EndDate: "2026-03-22T16:00:00Z",
        RunTimeTicks: 14400000000
      }
    });

    const body = mergeMetadataForUpdate({ Id: "new", Type: "Series", Name: "Target" }, source);

    expect(body).toMatchObject({
      Status: "Continuing",
      AirTime: "00:00",
      AirDays: ["Thursday"],
      EndDate: "2026-03-22T16:00:00Z",
      RunTimeTicks: 14400000000
    });
  });

  it("maps renamed collection folders from their matched media content", () => {
    const source = [
      item({ sourceItemId: "old-root", type: "CollectionFolder", name: "Old Library", path: "/old/root" }),
      item({ sourceItemId: "old-movie", type: "Movie", name: "Movie", path: "/old/root/Movie/file.mkv", fileName: "file.mkv" })
    ];
    const target: JellyfinItemDto[] = [
      { Id: "new-root", Type: "CollectionFolder", Name: "Renamed Library", Path: "D:\\media" },
      { Id: "new-movie", Type: "Movie", Name: "Movie", Path: "D:\\media\\Movie\\file.mkv" }
    ];

    const result = buildLibraryDiff(source, target);

    expect(result.guidMap.get("old-root")).toBe("new-root");
    expect(result.diff.matches.find((entry) => entry.oldItemId === "old-root")?.method).toBe("derived-from-library-content");
  });
});

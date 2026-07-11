import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { exportMediaFromApi, exportSnapshot } from "./exporters.js";
import { JellyfinClient } from "./jellyfin.js";
import type { UserRecord } from "./types.js";

const SAMPLE_DB = path.resolve("sample/jellyfin.db");
let tempDir: string | undefined;

describe("staged export", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("can export users only from sqlite", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "yajm-users-only-"));
    const cwd = process.cwd();
    process.chdir(tempDir);
    try {
      const manifest = await exportSnapshot({
        snapshotName: "users-only",
        userSource: { type: "sqlite", dbPath: SAMPLE_DB },
        watchSource: { type: "none" },
        librarySource: { type: "sqlite", dbPath: SAMPLE_DB },
        displayPreferenceProfiles: []
      });
      expect(manifest.stats.users).toBeGreaterThan(0);
      expect(manifest.stats.userData).toBe(0);
      expect(manifest.stats.library).toBeGreaterThan(0);
      expect(manifest.source.watch?.type).toBe("none");
      await expect(access(path.join(tempDir, "data", "exports", "users-only", "manifest.json"))).resolves.toBeUndefined();
    } finally {
      process.chdir(cwd);
    }
  });

  it("records mixed sqlite manifest sources", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "yajm-mixed-"));
    const cwd = process.cwd();
    process.chdir(tempDir);
    try {
      const manifest = await exportSnapshot({
        snapshotName: "mixed",
        userSource: { type: "sqlite", dbPath: SAMPLE_DB },
        watchSource: { type: "sqlite", dbPath: SAMPLE_DB },
        librarySource: { type: "sqlite", dbPath: SAMPLE_DB },
        displayPreferenceProfiles: []
      });
      expect(manifest.sourceType).toBe("sqlite");
      expect(manifest.source.users?.type).toBe("sqlite");
      expect(manifest.source.watch?.type).toBe("sqlite");
      expect(manifest.stats.userData).toBeGreaterThan(0);
    } finally {
      process.chdir(cwd);
    }
  });

  it("keeps every meaningful API user-data shape and removes empty rows", async () => {
    vi.spyOn(JellyfinClient.prototype, "getMovieAndEpisodeItemsForUser").mockResolvedValue([
      apiItem("played", { Played: true }),
      apiItem("play-count", { PlayCount: 2 }),
      apiItem("last-played", { LastPlayedDate: "2026-01-01T00:00:00Z" }),
      apiItem("disliked", { Likes: false }),
      apiItem("zero-rating", { Rating: 0 }),
      apiItem("empty", { Played: false, PlaybackPositionTicks: 0, IsFavorite: false })
    ]);

    const media = await exportMediaFromApi({ serverUrl: "http://example.test", apiKey: "test", users: [testUser()] });

    expect(media.map((item) => item.sourceItemId)).toEqual([
      "played",
      "play-count",
      "last-played",
      "disliked",
      "zero-rating"
    ]);
  });

  it("deduplicates repeated API items by user and item id without losing state", async () => {
    vi.spyOn(JellyfinClient.prototype, "getMovieAndEpisodeItemsForUser").mockResolvedValue([
      apiItem("same-item", { Played: false, PlaybackPositionTicks: 120, PlayCount: 1 }),
      apiItem("same-item", { Played: true, PlaybackPositionTicks: 0, PlayCount: 3, IsFavorite: true })
    ]);

    const media = await exportMediaFromApi({ serverUrl: "http://example.test", apiKey: "test", users: [testUser()] });

    expect(media).toHaveLength(1);
    expect(media[0].userData).toMatchObject({
      Played: true,
      PlaybackPositionTicks: 120,
      PlayCount: 3,
      IsFavorite: true
    });
  });
});

function testUser(): UserRecord {
  return { id: "user-1", name: "Tester", configuration: null, policy: null, displayPreferences: [] };
}

function apiItem(id: string, userData: Record<string, unknown>) {
  return { Id: id, Type: "Movie", Name: id, UserData: userData } as never;
}

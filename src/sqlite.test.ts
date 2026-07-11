import { describe, expect, it } from "vitest";
import { assertJellyfinDb, exportMediaFromSqlite, exportUsersFromSqlite, mergeUserData } from "./sqlite.js";

const SAMPLE_DB = "sample/jellyfin.db";

describe("sqlite fallback", () => {
  it("validates and reads the sample Jellyfin database", async () => {
    await assertJellyfinDb(SAMPLE_DB);
    const users = await exportUsersFromSqlite(SAMPLE_DB);
    expect(users.length).toBeGreaterThan(0);
    expect(users[0]).toHaveProperty("configuration");
  });

  it("exports normalized Movie/Episode user data from the sample database", async () => {
    const media = await exportMediaFromSqlite(SAMPLE_DB);
    expect(media.length).toBeGreaterThan(0);
    expect(media.every((item) => item.type === "Movie" || item.type === "Episode")).toBe(true);
    expect(media[0]).toHaveProperty("userData.PlaybackPositionTicks");
  });

  it("merges duplicate item user data conservatively", () => {
    const merged = mergeUserData(
      {
        Played: false,
        PlaybackPositionTicks: 10,
        PlayCount: 1,
        LastPlayedDate: "2024-01-01T00:00:00",
        IsFavorite: false
      },
      {
        Played: true,
        PlaybackPositionTicks: 5,
        PlayCount: 3,
        LastPlayedDate: "2024-02-01T00:00:00",
        IsFavorite: true
      }
    );
    expect(merged.Played).toBe(true);
    expect(merged.PlaybackPositionTicks).toBe(10);
    expect(merged.PlayCount).toBe(3);
    expect(merged.LastPlayedDate).toBe("2024-02-01T00:00:00");
    expect(merged.IsFavorite).toBe(true);
  });
});


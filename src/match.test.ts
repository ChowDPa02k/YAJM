import { describe, expect, it } from "vitest";
import { MediaMatcher, shouldOverwriteUserData } from "./match.js";
import type { JellyfinItemDto, MediaRecord } from "./types.js";

describe("media matching", () => {
  it("prefers provider id matches", () => {
    const catalog: JellyfinItemDto[] = [
      { Id: "target-1", Type: "Movie", Name: "Different", ProviderIds: { Tmdb: "123" } },
      { Id: "target-2", Type: "Movie", Name: "Same Name", ProductionYear: 2024, ProviderIds: { Tmdb: "999" } }
    ];
    const source: MediaRecord = {
      sourceItemId: "source-1",
      userId: "user-1",
      userName: "user",
      type: "Movie",
      name: "Same Name",
      productionYear: 2024,
      providerIds: { Tmdb: "123" },
      userData: { Played: true }
    };
    const match = new MediaMatcher(catalog).match(source);
    expect(match.status).toBe("matched");
    if (match.status === "matched") {
      expect(match.item.Id).toBe("target-1");
      expect(match.confidence).toBe("provider");
    }
  });

  it("falls back to movie title and year", () => {
    const match = new MediaMatcher([{ Id: "target", Type: "Movie", Name: "Hero", ProductionYear: 2002 }]).match({
      sourceItemId: "source",
      userId: "user",
      userName: "user",
      type: "Movie",
      name: "hero",
      productionYear: 2002,
      providerIds: {},
      userData: { Played: true }
    });
    expect(match.status).toBe("matched");
  });

  it("keeps newer target user data", () => {
    expect(
      shouldOverwriteUserData(
        { LastPlayedDate: "2024-01-01T00:00:00", PlaybackPositionTicks: 100 },
        { LastPlayedDate: "2024-02-01T00:00:00", PlaybackPositionTicks: 1 }
      )
    ).toBe(false);
  });
});


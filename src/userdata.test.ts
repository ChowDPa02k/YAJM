import { describe, expect, it } from "vitest";
import { hasMeaningfulUserData } from "./userdata.js";

describe("user data", () => {
  it.each([
    { Played: true },
    { PlaybackPositionTicks: 1 },
    { PlayCount: 1 },
    { IsFavorite: true },
    { Likes: true },
    { Likes: false },
    { Rating: 0 },
    { LastPlayedDate: "2026-01-01T00:00:00Z" }
  ])("recognizes a meaningful persisted state: %j", (userData) => {
    expect(hasMeaningfulUserData(userData)).toBe(true);
  });

  it("rejects absent and default-only state", () => {
    expect(hasMeaningfulUserData(undefined)).toBe(false);
    expect(
      hasMeaningfulUserData({
        Played: false,
        PlaybackPositionTicks: 0,
        PlayCount: 0,
        IsFavorite: false,
        Likes: null,
        Rating: null,
        LastPlayedDate: null
      })
    ).toBe(false);
  });
});

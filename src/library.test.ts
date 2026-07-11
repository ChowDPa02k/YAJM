import { describe, expect, it } from "vitest";
import { libraryItemFromApi } from "./library.js";

describe("API library normalization", () => {
  it("captures Series scheduling metadata from BaseItemDto", () => {
    const item = libraryItemFromApi({
      Id: "series",
      Type: "Series",
      Name: "Show",
      Status: "Continuing",
      AirTime: "22:00",
      AirDays: ["Wednesday"],
      EndDate: "2026-03-22T16:00:00Z",
      DisplayOrder: "Aired",
      RunTimeTicks: 14400000000
    });

    expect(item).toMatchObject({
      status: "Continuing",
      airTime: "22:00",
      airDays: ["Wednesday"],
      endDate: "2026-03-22T16:00:00Z",
      displayOrder: "Aired",
      runTimeTicks: 14400000000
    });
  });
});

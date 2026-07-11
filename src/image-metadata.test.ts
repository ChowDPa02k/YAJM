import { describe, expect, it } from "vitest";
import { stripImageMetadata } from "./image-metadata.js";

describe("image metadata filtering", () => {
  it("removes image references recursively without changing ordinary paths", () => {
    expect(
      stripImageMetadata({
        Path: "/target/media.mkv",
        ParentLogoItemId: "source-logo",
        nested: [{ PrimaryImageTag: "source-image", Name: "Actor" }]
      })
    ).toEqual({ Path: "/target/media.mkv", nested: [{ Name: "Actor" }] });
  });
});

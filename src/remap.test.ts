import { describe, expect, it } from "vitest";
import { addGuidMapping, remapGuidsInValue } from "./remap.js";

describe("guid remap", () => {
  it("replaces uuids in nested settings", () => {
    const oldId = "11111111-1111-1111-1111-111111111111";
    const newId = "22222222-2222-2222-2222-222222222222";
    const result = remapGuidsInValue({ OrderedViews: [oldId], CustomPrefs: { hidden: `x:${oldId}` } }, new Map([[oldId, newId]]));
    expect(result).toEqual({ OrderedViews: [newId], CustomPrefs: { hidden: `x:${newId}` } });
  });

  it("maps compact Jellyfin API ids from hyphenated SQLite ids", () => {
    const map = new Map<string, string>();
    addGuidMapping(map, "11111111-1111-1111-1111-111111111111", "target-folder");

    expect(remapGuidsInValue(["11111111111111111111111111111111"], map)).toEqual(["target-folder"]);
  });
});

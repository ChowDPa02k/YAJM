import { describe, expect, it } from "vitest";
import { buildRestoredPolicy, buildTemporaryImportPolicy, createUserMappingResolver } from "./importer.js";
import { addGuidMapping } from "./remap.js";
import type { UserMapping } from "./types.js";

describe("mixed-source user identity", () => {
  const mapping: UserMapping = {
    action: "map",
    oldUserId: "aabbccddeeff00112233445566778899",
    oldUserName: "Example",
    newUserId: "target-user",
    newUserName: "Example"
  };

  it("matches compact API user ids to hyphenated SQLite ids", () => {
    const resolve = createUserMappingResolver([mapping]);
    expect(resolve({ userId: "AABBCCDD-EEFF-0011-2233-445566778899", userName: "Example" })).toBe(mapping);
  });

  it("falls back to the Jellyfin username when source ids differ", () => {
    const resolve = createUserMappingResolver([mapping]);
    expect(resolve({ userId: "different-id", userName: "example" })).toBe(mapping);
  });
});

describe("restored user policy", () => {
  it("rewrites compact EnabledFolders ids and drops unsafe fields", () => {
    const guidMap = new Map<string, string>();
    addGuidMapping(guidMap, "11111111-1111-1111-1111-111111111111", "target-folder");

    const policy = buildRestoredPolicy(
      { EnabledFolders: ["11111111111111111111111111111111"], EnableAllFolders: false, Password: "secret" },
      guidMap
    );

    expect(policy).toEqual({ EnabledFolders: ["target-folder"], EnableAllFolders: false });
  });

  it("temporarily grants all-folder access without losing the final policy", () => {
    const finalPolicy = { EnableAllFolders: false, EnabledFolders: ["target-folder"], EnableMediaPlayback: true };

    expect(buildTemporaryImportPolicy(finalPolicy)).toEqual({
      EnableAllFolders: true,
      EnabledFolders: [],
      EnableMediaPlayback: true
    });
    expect(finalPolicy).toEqual({ EnableAllFolders: false, EnabledFolders: ["target-folder"], EnableMediaPlayback: true });
  });
});

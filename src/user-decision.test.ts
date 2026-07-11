import { describe, expect, it } from "vitest";
import { parseUserDecisionKey } from "./user-decision.js";

describe("interactive user decision keys", () => {
  it.each([
    ["C", "create"],
    ["c", "create"],
    [" M ", "map"],
    ["s", "skip"]
  ] as const)("maps %j to %s", (input, expected) => {
    expect(parseUserDecisionKey(input)).toBe(expected);
  });

  it("rejects unsupported input", () => {
    expect(parseUserDecisionKey("")).toBeNull();
    expect(parseUserDecisionKey("create")).toBeNull();
    expect(parseUserDecisionKey("x")).toBeNull();
  });
});

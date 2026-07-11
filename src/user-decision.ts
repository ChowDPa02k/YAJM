export type UserDecisionAction = "create" | "map" | "skip";

export function parseUserDecisionKey(value: string): UserDecisionAction | null {
  switch (value.trim().toLowerCase()) {
    case "c":
      return "create";
    case "m":
      return "map";
    case "s":
      return "skip";
    default:
      return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function remapGuidsInValue(value: unknown, guidMap: Map<string, string>): unknown {
  if (typeof value === "string") {
    return remapString(value, guidMap);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => remapGuidsInValue(entry, guidMap));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, remapGuidsInValue(entry, guidMap)]));
  }
  return value;
}

function remapString(value: string, guidMap: Map<string, string>): string {
  const direct = guidMap.get(value) ?? guidMap.get(value.toLowerCase()) ?? guidMap.get(value.toUpperCase());
  if (direct) return direct;
  return value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (match) => {
    return guidMap.get(match) ?? guidMap.get(match.toLowerCase()) ?? guidMap.get(match.toUpperCase()) ?? match;
  });
}

export function addGuidMapping(map: Map<string, string>, oldId: string, newId: string): void {
  map.set(oldId, newId);
  map.set(oldId.toLowerCase(), newId);
  map.set(oldId.toUpperCase(), newId);
  const compact = oldId.replace(/-/g, "");
  map.set(compact, newId);
  map.set(compact.toLowerCase(), newId);
  map.set(compact.toUpperCase(), newId);
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

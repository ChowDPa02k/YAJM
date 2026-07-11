const IMAGE_METADATA_KEY = /image|backdrop|thumb|logo|artwork/i;

export function stripImageMetadata<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => stripImageMetadata(entry)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !IMAGE_METADATA_KEY.test(key))
      .map(([key, entry]) => [key, stripImageMetadata(entry)])
  ) as T;
}

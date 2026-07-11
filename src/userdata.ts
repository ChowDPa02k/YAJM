import type { UserItemData } from "./types.js";

export function hasMeaningfulUserData(userData: UserItemData | null | undefined): boolean {
  if (!userData) return false;
  return Boolean(
    userData.Played ||
      (userData.PlaybackPositionTicks ?? 0) > 0 ||
      (userData.PlayCount ?? 0) > 0 ||
      userData.IsFavorite ||
      userData.Likes !== null && userData.Likes !== undefined ||
      userData.Rating !== null && userData.Rating !== undefined ||
      userData.LastPlayedDate
  );
}

export function mergeUserData(left: UserItemData, right: UserItemData): UserItemData {
  const leftDate = dateValue(left.LastPlayedDate);
  const rightDate = dateValue(right.LastPlayedDate);
  const newer = rightDate > leftDate ? right : left;
  return {
    Rating: right.Rating ?? left.Rating,
    PlayedPercentage: right.PlayedPercentage ?? left.PlayedPercentage,
    UnplayedItemCount: right.UnplayedItemCount ?? left.UnplayedItemCount,
    PlaybackPositionTicks: Math.max(left.PlaybackPositionTicks ?? 0, right.PlaybackPositionTicks ?? 0),
    PlayCount: Math.max(left.PlayCount ?? 0, right.PlayCount ?? 0),
    IsFavorite: Boolean(left.IsFavorite || right.IsFavorite),
    Likes: right.Likes ?? left.Likes,
    LastPlayedDate: newer.LastPlayedDate ?? left.LastPlayedDate ?? right.LastPlayedDate,
    Played: Boolean(left.Played || right.Played),
    Key: newer.Key ?? left.Key ?? right.Key,
    ItemId: left.ItemId ?? right.ItemId
  };
}

function dateValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

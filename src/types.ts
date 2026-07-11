import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const ProviderIdsSchema = z.record(z.string(), z.string());

export const UserConfigurationSchema = z.record(z.string(), z.unknown());
export const UserPolicySchema = z.record(z.string(), z.unknown());

export const UserRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  configuration: UserConfigurationSchema.nullable(),
  policy: UserPolicySchema.nullable(),
  displayPreferences: z.array(z.record(z.string(), z.unknown())).default([]),
  raw: z.record(z.string(), z.unknown()).optional()
});

export const UserItemDataSchema = z.object({
  Rating: z.number().nullable().optional(),
  PlayedPercentage: z.number().nullable().optional(),
  UnplayedItemCount: z.number().nullable().optional(),
  PlaybackPositionTicks: z.number().nullable().optional(),
  PlayCount: z.number().nullable().optional(),
  IsFavorite: z.boolean().nullable().optional(),
  Likes: z.boolean().nullable().optional(),
  LastPlayedDate: z.string().nullable().optional(),
  Played: z.boolean().nullable().optional(),
  Key: z.string().optional(),
  ItemId: z.string().optional()
});

export const MediaRecordSchema = z.object({
  sourceItemId: z.string(),
  userId: z.string(),
  userName: z.string(),
  type: z.enum(["Movie", "Episode"]),
  name: z.string(),
  originalTitle: z.string().nullable().optional(),
  productionYear: z.number().nullable().optional(),
  providerIds: ProviderIdsSchema.default({}),
  seriesName: z.string().nullable().optional(),
  seasonName: z.string().nullable().optional(),
  parentIndexNumber: z.number().nullable().optional(),
  indexNumber: z.number().nullable().optional(),
  path: z.string().nullable().optional(),
  userData: UserItemDataSchema
});

export const LibraryItemKindSchema = z.enum(["Movie", "Series", "Season", "Episode", "CollectionFolder"]);

export const ImageRecordSchema = z.object({
  sourceItemId: z.string(),
  itemType: LibraryItemKindSchema,
  imageType: z.string(),
  imageIndex: z.number().int().nonnegative(),
  sourceTag: z.string().optional(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string(),
  file: z.string()
});

export const LibraryItemSchema = z.object({
  sourceItemId: z.string(),
  type: LibraryItemKindSchema,
  name: z.string(),
  originalTitle: z.string().nullable().optional(),
  sortName: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
  parentDirName: z.string().nullable().optional(),
  grandParentDirName: z.string().nullable().optional(),
  providerIds: ProviderIdsSchema.default({}),
  parentId: z.string().nullable().optional(),
  seriesId: z.string().nullable().optional(),
  seasonId: z.string().nullable().optional(),
  seriesName: z.string().nullable().optional(),
  seasonName: z.string().nullable().optional(),
  parentIndexNumber: z.number().nullable().optional(),
  indexNumber: z.number().nullable().optional(),
  productionYear: z.number().nullable().optional(),
  premiereDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  airTime: z.string().nullable().optional(),
  airDays: z.array(z.string()).nullable().optional(),
  displayOrder: z.string().nullable().optional(),
  runTimeTicks: z.number().nullable().optional(),
  overview: z.string().nullable().optional(),
  genres: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  studios: z.array(z.string()).default([]),
  people: z.array(z.record(z.string(), z.unknown())).default([]),
  officialRating: z.string().nullable().optional(),
  customRating: z.string().nullable().optional(),
  communityRating: z.number().nullable().optional(),
  taglines: z.array(z.string()).default([]),
  lockData: z.boolean().nullable().optional(),
  lockedFields: z.array(z.string()).default([]),
  raw: z.record(z.string(), z.unknown()).optional()
});

export const ManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  sourceType: z.enum(["api", "sqlite", "mixed"]),
  exportedAt: z.string(),
  source: z.object({
    serverUrl: z.string().optional(),
    dbPath: z.string().optional(),
    users: z
      .object({
        type: z.enum(["api", "sqlite"]),
        serverUrl: z.string().optional(),
        dbPath: z.string().optional()
      })
      .optional(),
    watch: z
      .object({
        type: z.enum(["api", "sqlite", "none"]),
        serverUrl: z.string().optional(),
        dbPath: z.string().optional()
      })
      .optional(),
    library: z
      .object({
        type: z.enum(["api", "sqlite"]),
        serverUrl: z.string().optional(),
        dbPath: z.string().optional()
      })
      .optional()
  }),
  stats: z.object({
    users: z.number(),
    userData: z.number(),
    library: z.number().default(0),
    images: z.number().default(0),
    imageBytes: z.number().default(0)
  })
});

export const SnapshotUsersSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  users: z.array(UserRecordSchema)
});

export const ConfigSchema = z.object({
  source: z
    .object({
      serverUrl: z.string().optional(),
      apiKey: z.string().optional(),
      sqlitePath: z.string().optional()
    })
    .default({}),
  target: z
    .object({
      serverUrl: z.string().optional(),
      apiKey: z.string().optional()
    })
    .default({}),
  displayPreferenceProfiles: z
    .array(
      z.object({
        displayPreferencesId: z.string(),
        client: z.string()
      })
    )
    .default([{ displayPreferencesId: "usersettings", client: "emby" }])
});

export type UserRecord = z.infer<typeof UserRecordSchema>;
export type UserItemData = z.infer<typeof UserItemDataSchema>;
export type MediaRecord = z.infer<typeof MediaRecordSchema>;
export type LibraryItem = z.infer<typeof LibraryItemSchema>;
export type ImageRecord = z.infer<typeof ImageRecordSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type SnapshotUsers = z.infer<typeof SnapshotUsersSchema>;
export type AppConfig = z.infer<typeof ConfigSchema>;

export type JellyfinUserDto = {
  Id: string;
  Name?: string | null;
  Configuration?: Record<string, unknown> | null;
  Policy?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type JellyfinItemDto = {
  Id: string;
  Name?: string | null;
  Type?: string | null;
  OriginalTitle?: string | null;
  ProductionYear?: number | null;
  ProviderIds?: Record<string, string> | null;
  SeriesName?: string | null;
  SeasonName?: string | null;
  ParentIndexNumber?: number | null;
  IndexNumber?: number | null;
  Path?: string | null;
  UserData?: UserItemData | null;
  People?: Array<Record<string, unknown>> | null;
  Genres?: string[] | null;
  Tags?: string[] | null;
  Studios?: Array<{ Name?: string | null } & Record<string, unknown>> | null;
  Overview?: string | null;
  SortName?: string | null;
  PremiereDate?: string | null;
  EndDate?: string | null;
  Status?: string | null;
  AirTime?: string | null;
  AirDays?: string[] | null;
  DisplayOrder?: string | null;
  RunTimeTicks?: number | null;
  OfficialRating?: string | null;
  CustomRating?: string | null;
  CommunityRating?: number | null;
  Taglines?: string[] | null;
  LockData?: boolean | null;
  LockedFields?: string[] | null;
  ParentId?: string | null;
  SeriesId?: string | null;
  SeasonId?: string | null;
  ImageTags?: Record<string, string> | null;
  BackdropImageTags?: string[] | null;
  [key: string]: unknown;
};

export type UserMapping =
  | { action: "map"; oldUserId: string; oldUserName: string; newUserId: string; newUserName: string }
  | { action: "create"; oldUserId: string; oldUserName: string; newUserId?: string; newUserName?: string }
  | { action: "skip"; oldUserId: string; oldUserName: string; reason: string };

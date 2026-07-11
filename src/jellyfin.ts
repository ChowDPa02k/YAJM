import type { JellyfinItemDto, JellyfinUserDto, UserItemData } from "./types.js";

type QueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>;

export class JellyfinApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
  }
}

export class JellyfinClient {
  readonly serverUrl: string;
  readonly apiKey: string;

  constructor(serverUrl: string, apiKey: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  async getUsers(): Promise<JellyfinUserDto[]> {
    return this.request<JellyfinUserDto[]>("/Users");
  }

  async createUser(name: string, password: string): Promise<JellyfinUserDto> {
    return this.request<JellyfinUserDto>("/Users/New", {
      method: "POST",
      body: { Name: name, Password: password }
    });
  }

  async updateUserConfiguration(userId: string, configuration: Record<string, unknown>): Promise<void> {
    await this.request<void>("/Users/Configuration", {
      method: "POST",
      query: { userId },
      body: configuration,
      expectNoContent: true
    });
  }

  async updateUserPolicy(userId: string, policy: Record<string, unknown>): Promise<void> {
    await this.request<void>(`/Users/${encodeURIComponent(userId)}/Policy`, {
      method: "POST",
      body: policy,
      expectNoContent: true
    });
  }

  async getDisplayPreferences(
    userId: string,
    displayPreferencesId: string,
    client: string
  ): Promise<Record<string, unknown> | null> {
    try {
      return await this.request<Record<string, unknown>>(`/DisplayPreferences/${encodeURIComponent(displayPreferencesId)}`, {
        query: { userId, client }
      });
    } catch (error) {
      if (error instanceof JellyfinApiError && (error.status === 404 || error.status === 403)) {
        return null;
      }
      throw error;
    }
  }

  async updateDisplayPreferences(
    userId: string,
    displayPreferencesId: string,
    client: string,
    preferences: Record<string, unknown>
  ): Promise<void> {
    await this.request<void>(`/DisplayPreferences/${encodeURIComponent(displayPreferencesId)}`, {
      method: "POST",
      query: { userId, client },
      body: preferences,
      expectNoContent: true
    });
  }

  async getItems(
    query: Record<string, QueryValue>,
    onPage?: (progress: { fetched: number; total?: number; pageSize: number }) => void
  ): Promise<JellyfinItemDto[]> {
    const items: JellyfinItemDto[] = [];
    const limit = 500;
    let startIndex = 0;
    while (true) {
      const page = await this.request<{ Items?: JellyfinItemDto[]; TotalRecordCount?: number }>("/Items", {
        query: { enableTotalRecordCount: false, ...query, startIndex, limit }
      });
      const pageItems = page.Items ?? [];
      items.push(...pageItems);
      startIndex += pageItems.length;
      onPage?.({ fetched: items.length, pageSize: pageItems.length });
      if (pageItems.length < limit) {
        break;
      }
    }
    return items;
  }

  async getMovieAndEpisodeItemsForUser(
    userId: string,
    onPage?: (progress: { fetched: number; total?: number; pageSize: number }) => void
  ): Promise<JellyfinItemDto[]> {
    return this.getItems({
      userId,
      recursive: true,
      includeItemTypes: ["Movie", "Episode"],
      enableUserData: true,
      fields: ["ProviderIds", "Path", "OriginalTitle"]
    }, onPage);
  }

  async getTargetCatalog(): Promise<JellyfinItemDto[]> {
    return this.getItems({
      recursive: true,
      includeItemTypes: ["Movie", "Episode"],
      enableUserData: false,
      fields: ["ProviderIds", "Path", "OriginalTitle"]
    });
  }

  async getLogicalLibraryItems(onPage?: (progress: { fetched: number; total?: number; pageSize: number }) => void): Promise<JellyfinItemDto[]> {
    return this.getItems(
      {
        recursive: true,
        includeItemTypes: ["Movie", "Series", "Season", "Episode"],
        enableUserData: false,
        enableImages: false,
        fields: ["ProviderIds", "Path", "OriginalTitle", "People", "Genres", "Studios", "Taglines", "Overview", "ParentId", "SortName", "AirTime"]
      },
      onPage
    );
  }

  async getLogicalLibraryItemsWithImages(onPage?: (progress: { fetched: number; total?: number; pageSize: number }) => void): Promise<JellyfinItemDto[]> {
    return this.getItems(
      {
        recursive: true,
        includeItemTypes: ["Movie", "Series", "Season", "Episode"],
        enableUserData: false,
        enableImages: true,
        imageTypeLimit: 100,
        fields: ["ProviderIds", "Path"]
      },
      onPage
    );
  }

  async downloadItemImage(itemId: string, imageType: string, imageIndex: number): Promise<{ data: Uint8Array; contentType: string }> {
    const response = await fetch(
      `${this.serverUrl}/Items/${encodeURIComponent(itemId)}/Images/${encodeURIComponent(imageType)}/${imageIndex}`,
      { headers: { "X-Emby-Token": this.apiKey } }
    );
    if (!response.ok) {
      throw new JellyfinApiError(`GET image failed with ${response.status}`, response.status, await response.text());
    }
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type")?.split(";", 1)[0] ?? "application/octet-stream"
    };
  }

  async getItemImages(itemId: string): Promise<Array<{ ImageType: string; ImageIndex?: number | null }>> {
    return this.request(`/Items/${encodeURIComponent(itemId)}/Images`);
  }

  async deleteItemImage(itemId: string, imageType: string, imageIndex?: number | null): Promise<void> {
    const suffix = imageIndex === undefined || imageIndex === null ? "" : `/${imageIndex}`;
    await this.request<void>(`/Items/${encodeURIComponent(itemId)}/Images/${encodeURIComponent(imageType)}${suffix}`, {
      method: "DELETE",
      expectNoContent: true
    });
  }

  async uploadItemImage(itemId: string, imageType: string, imageIndex: number, contentType: string, data: Uint8Array): Promise<void> {
    const response = await fetch(
      `${this.serverUrl}/Items/${encodeURIComponent(itemId)}/Images/${encodeURIComponent(imageType)}/${imageIndex}`,
      {
        method: "POST",
        headers: { "X-Emby-Token": this.apiKey, "Content-Type": contentType },
        body: Buffer.from(data).toString("base64")
      }
    );
    if (!response.ok) {
      throw new JellyfinApiError(`POST image failed with ${response.status}`, response.status, await response.text());
    }
  }

  async getVirtualFolders(): Promise<JellyfinItemDto[]> {
    const folders = await this.request<Array<Record<string, unknown>>>("/Library/VirtualFolders");
    return folders
      .filter((folder) => typeof folder.ItemId === "string")
      .map((folder) => ({
        ...folder,
        Id: String(folder.ItemId),
        Type: "CollectionFolder",
        Name: typeof folder.Name === "string" ? folder.Name : null,
        Path: Array.isArray(folder.Locations) && typeof folder.Locations[0] === "string" ? folder.Locations[0] : null
      }));
  }

  async getItem(itemId: string): Promise<JellyfinItemDto> {
    return this.request<JellyfinItemDto>(`/Items/${encodeURIComponent(itemId)}`, {
      query: {
        fields: ["ProviderIds", "Path", "OriginalTitle", "People", "Genres", "Studios", "Taglines", "Overview", "ParentId", "SortName", "AirTime"]
      }
    });
  }

  async updateItem(itemId: string, body: Record<string, unknown>): Promise<void> {
    await this.request<void>(`/Items/${encodeURIComponent(itemId)}`, {
      method: "POST",
      body,
      expectNoContent: true
    });
  }

  async getItemUserData(userId: string, itemId: string): Promise<UserItemData | null> {
    try {
      return await this.request<UserItemData>(`/UserItems/${encodeURIComponent(itemId)}/UserData`, {
        query: { userId }
      });
    } catch (error) {
      if (error instanceof JellyfinApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async updateItemUserData(userId: string, itemId: string, userData: UserItemData): Promise<UserItemData> {
    return this.request<UserItemData>(`/UserItems/${encodeURIComponent(itemId)}/UserData`, {
      method: "POST",
      query: { userId },
      body: stripUndefined(userData)
    });
  }

  async markPlayed(userId: string, itemId: string, datePlayed?: string | null): Promise<UserItemData> {
    return this.request<UserItemData>(`/UserPlayedItems/${encodeURIComponent(itemId)}`, {
      method: "POST",
      query: { userId, datePlayed: datePlayed ?? undefined }
    });
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: string;
      query?: Record<string, QueryValue>;
      body?: unknown;
      expectNoContent?: boolean;
    } = {}
  ): Promise<T> {
    const url = new URL(`${this.serverUrl}${endpoint}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const entry of value) url.searchParams.append(key, String(entry));
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        "X-Emby-Token": this.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new JellyfinApiError(`${options.method ?? "GET"} ${url.pathname} failed with ${response.status}`, response.status, body);
    }
    if (response.status === 204 || options.expectNoContent) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

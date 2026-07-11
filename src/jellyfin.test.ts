import { afterEach, describe, expect, it, vi } from "vitest";
import { JellyfinClient } from "./jellyfin.js";

describe("JellyfinClient pagination", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fetches subsequent pages when the server omits TotalRecordCount", async () => {
    const fullPage = Array.from({ length: 500 }, (_, index) => ({ Id: `item-${index}` }));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ Items: fullPage, TotalRecordCount: 500 }))
      .mockResolvedValueOnce(jsonResponse({ Items: [{ Id: "item-500" }] }));

    const items = await new JellyfinClient("http://example.test", "test").getItems({ recursive: true });

    expect(items).toHaveLength(501);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(firstUrl.searchParams.get("enableTotalRecordCount")).toBe("false");
    expect(firstUrl.searchParams.get("startIndex")).toBe("0");
    expect(secondUrl.searchParams.get("startIndex")).toBe("500");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

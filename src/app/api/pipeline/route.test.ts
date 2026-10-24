import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AFFORDABILITY, autotraderItem, CREDIT, NEED, TEST_TOKEN } from "@/lib/apify/__tests__/fixtures";

// Credit, cash flow and ranking are other integrations; stub them so these tests cover listings only.
vi.mock("@/lib/providers/crs", () => ({ pullSoftCredit: vi.fn(async () => CREDIT) }));
vi.mock("@/lib/providers/nessie", () => ({ analyzeCashFlow: vi.fn(async () => AFFORDABILITY) }));

const { POST } = await import("./route");

const request = () =>
  new NextRequest("http://localhost/api/pipeline", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ need: NEED }),
  });

function goLive(response: Response) {
  vi.stubEnv("APIFY_MODE", "live");
  vi.stubEnv("APIFY_API_TOKEN", TEST_TOKEN);
  vi.stubEnv("APIFY_BASE_URL", "https://api.apify.test/v2");
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/pipeline — listings", () => {
  it("runs end to end on mock listings", async () => {
    vi.stubEnv("APIFY_MODE", "mock");
    const res = await POST(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listings.length).toBeGreaterThan(0);
    expect(body.rankedCars.length).toBeGreaterThan(0);
  });

  it("runs end to end on live listings", async () => {
    goLive(new Response(JSON.stringify([autotraderItem()]), { status: 201 }));
    const res = await POST(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listings.map((l: { id: string }) => l.id)).toEqual(["at_700000001"]);
    expect(body.rankedCars[0].listing.id).toBe("at_700000001");
  });

  it("answers 503 when APIFY_MODE is unset", async () => {
    vi.stubEnv("APIFY_MODE", undefined);
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/APIFY_MODE/);
  });

  it.each([
    [401, 502],
    [402, 503],
    [408, 504],
    [429, 503],
    [500, 502],
  ])("maps Apify HTTP %i to %i with a buyer-safe message", async (upstream, status) => {
    goLive(new Response(JSON.stringify({ error: { type: "x", message: TEST_TOKEN } }), { status: upstream }));
    const res = await POST(request());
    expect(res.status).toBe(status);
    const text = await res.text();
    expect(text).toContain("We couldn't load live car listings");
    expect(text).not.toContain(TEST_TOKEN);
  });

  it("answers 422 when no listing is usable, never with mock cars", async () => {
    goLive(new Response(JSON.stringify([]), { status: 201 }));
    const res = await POST(request());
    expect(res.status).toBe(422);
    expect((await res.json()).listings).toBeUndefined();
  });
});

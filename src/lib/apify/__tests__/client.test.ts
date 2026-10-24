import { afterEach, describe, expect, it, vi } from "vitest";
import { runListingsActor } from "@/lib/apify/client";
import { ApifyError, scrubDetail } from "@/lib/apify/errors";
import { buildSearchInput } from "@/lib/apify/search";
import { fakeApify } from "./fake-apify";
import { AFFORDABILITY, autotraderItem, CREDIT, LIVE_CFG, NEED, TEST_TOKEN } from "./fixtures";

const INPUT = buildSearchInput(NEED, AFFORDABILITY, CREDIT, LIVE_CFG);

async function failure(promise: Promise<unknown>): Promise<ApifyError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ApifyError);
    expect((err as ApifyError).message).not.toContain(TEST_TOKEN);
    return err as ApifyError;
  }
  throw new Error("expected an ApifyError");
}

/** Makes the client's clock jump `stepMs` on every read, so deadlines pass without waiting. */
function fastClock(stepMs: number) {
  let t = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => (t += stepMs));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runListingsActor", () => {
  it("starts a capped run, then reads its dataset; the token only in the header", async () => {
    const { calls } = fakeApify({ items: [autotraderItem()] });

    const result = await runListingsActor(LIVE_CFG, INPUT);

    expect(result).toEqual({ items: [autotraderItem()], partial: false, status: "SUCCEEDED" });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /acts/caffein.dev~autotrader-com-actor/runs",
      "GET /datasets/ds1/items",
    ]);
    const start = new URL(calls[0].url);
    expect(Object.fromEntries(start.searchParams)).toEqual({
      timeout: "120",
      maxItems: "25",
      maxTotalChargeUsd: "0.25",
      waitForFinish: "60",
    });
    expect(JSON.parse(calls[0].init.body as string)).toEqual(INPUT);
    expect(Object.fromEntries(new URL(calls[1].url).searchParams)).toEqual({ format: "json", clean: "true", limit: "25" });
    for (const call of calls) {
      expect(call.url).not.toContain(TEST_TOKEN);
      expect((call.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TEST_TOKEN}`);
    }
  });

  it("polls a running run until it finishes", async () => {
    const { calls } = fakeApify({ statuses: ["RUNNING", "RUNNING", "SUCCEEDED"], items: [autotraderItem()] });

    const result = await runListingsActor(LIVE_CFG, INPUT);

    expect(result.partial).toBe(false);
    expect(calls.filter((c) => c.path === "/actor-runs/run1")).toHaveLength(2);
    expect(new URL(calls[1].url).searchParams.get("waitForFinish")).toBe("60");
  });

  it("returns partial items when Apify's own run timeout hits", async () => {
    fakeApify({ statuses: ["RUNNING", "TIMED-OUT"], items: [autotraderItem()] });
    const result = await runListingsActor(LIVE_CFG, INPUT);
    expect(result).toMatchObject({ partial: true, status: "TIMED-OUT" });
    expect(result.items).toHaveLength(1);
  });

  it("aborts a run still going at the deadline, which stops charges, and keeps what it collected", async () => {
    fastClock(30_000);
    const { calls } = fakeApify({ statuses: ["RUNNING"], items: [autotraderItem()] });

    const result = await runListingsActor(LIVE_CFG, INPUT);

    expect(calls.some((c) => c.method === "POST" && c.path === "/actor-runs/run1/abort")).toBe(true);
    expect(result).toMatchObject({ partial: true, status: "ABORTED" });
  });

  it("still reads the dataset if the abort request itself fails", async () => {
    fastClock(30_000);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeApify({
      statuses: ["RUNNING"],
      items: [autotraderItem()],
      override: (method, path) => (path.endsWith("/abort") ? new Response("{}", { status: 500 }) : undefined),
    });
    expect((await runListingsActor(LIVE_CFG, INPUT)).partial).toBe(true);
  });

  it("fails with timeout when a timed-out run collected nothing", async () => {
    fakeApify({ statuses: ["TIMED-OUT"], items: [] });
    const err = await failure(runListingsActor(LIVE_CFG, INPUT));
    expect(err.kind).toBe("timeout");
    expect(err.userMessage).toMatch(/took too long/);
  });

  it("fails with upstream when the run failed or someone else aborted it", async () => {
    fakeApify({ statuses: ["FAILED"], items: [autotraderItem()] });
    expect((await failure(runListingsActor(LIVE_CFG, INPUT))).kind).toBe("upstream");

    fakeApify({ statuses: ["RUNNING", "ABORTED"], items: [autotraderItem()] });
    expect((await failure(runListingsActor(LIVE_CFG, INPUT))).kind).toBe("upstream");
  });

  it("starts exactly one run, even on failure", async () => {
    const { calls } = fakeApify({ startError: { status: 500, type: "internal-server-error" } });
    await failure(runListingsActor(LIVE_CFG, INPUT));
    expect(calls).toHaveLength(1);
  });

  it.each([
    [400, "upstream"],
    [401, "auth"],
    [403, "auth"],
    [402, "quota"],
    [404, "not_found"],
    [408, "timeout"],
    [429, "rate_limited"],
    [500, "upstream"],
    [503, "upstream"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    fakeApify({ startError: { status, type: "some-error", message: `token ${TEST_TOKEN} rejected` } });
    const err = await failure(runListingsActor(LIVE_CFG, INPUT));
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
    expect(err.message).toContain("some-error");
  });

  it("maps a non-JSON error body by status", async () => {
    fakeApify({ override: () => new Response("<html>bad gateway</html>", { status: 502 }) });
    expect((await failure(runListingsActor(LIVE_CFG, INPUT))).kind).toBe("upstream");
  });

  it("rejects a run object without id, status, or dataset id", async () => {
    fakeApify({ override: (m) => (m === "POST" ? new Response(JSON.stringify({ data: { id: "run1" } }), { status: 201 }) : undefined) });
    expect((await failure(runListingsActor(LIVE_CFG, INPUT))).kind).toBe("invalid_response");
  });

  it("rejects dataset items that aren't an array", async () => {
    fakeApify({ items: { items: [] } });
    expect((await failure(runListingsActor(LIVE_CFG, INPUT))).kind).toBe("invalid_response");
  });

  it("maps a request that gets no response to timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
    }));
    expect((await failure(runListingsActor(LIVE_CFG, INPUT))).kind).toBe("timeout");
  });

  it("maps a network error to upstream without leaking the URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError(`fetch failed for https://api.apify.test/v2/acts?token=${TEST_TOKEN}`);
    }));
    const err = await failure(runListingsActor(LIVE_CFG, INPUT));
    expect(err.kind).toBe("upstream");
    expect(err.message).not.toContain("api.apify.test");
  });
});

describe("scrubDetail", () => {
  it("removes URLs, token params, and token-shaped strings", () => {
    const out = scrubDetail(`bad ${TEST_TOKEN} at https://x.test/a?token=abc and ?token=def`);
    expect(out).not.toContain(TEST_TOKEN);
    expect(out).not.toContain("x.test");
    expect(out).not.toContain("def");
  });
});

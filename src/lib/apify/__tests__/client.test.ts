import { afterEach, describe, expect, it, vi } from "vitest";
import { runListingsActor } from "@/lib/apify/client";
import { ApifyError, scrubDetail } from "@/lib/apify/errors";
import { buildSearchInput } from "@/lib/apify/search";
import { AFFORDABILITY, autotraderItem, CREDIT, LIVE_CFG, NEED, TEST_TOKEN } from "./fixtures";

const INPUT = buildSearchInput(NEED, AFFORDABILITY, CREDIT, LIVE_CFG);

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (body: unknown, status = 201) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runListingsActor", () => {
  it("runs the Actor synchronously with caps, the token only in the header", async () => {
    const fetchMock = stubFetch(() => json([autotraderItem()]));

    const items = await runListingsActor(LIVE_CFG, INPUT);

    expect(items).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://api.apify.test/v2/acts/caffein.dev~autotrader-com-actor/run-sync-get-dataset-items",
    );
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      timeout: "120",
      maxItems: "25",
      maxTotalChargeUsd: "0.25",
      format: "json",
      clean: "true",
    });
    expect(url).not.toContain(TEST_TOKEN);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TEST_TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual(INPUT);
  });

  it("makes exactly one call, even on failure", async () => {
    const fetchMock = stubFetch(() => json({ error: { type: "internal-server-error" } }, 500));
    await failure(runListingsActor(LIVE_CFG, INPUT));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [402, "quota"],
    [404, "not_found"],
    [408, "timeout"],
    [429, "rate_limited"],
    [500, "upstream"],
    [503, "upstream"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    stubFetch(() => json({ error: { type: "some-error", message: `token ${TEST_TOKEN} rejected` } }, status));
    const err = await failure(runListingsActor(LIVE_CFG, INPUT));
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
    expect(err.message).toContain("some-error");
  });

  it("maps a non-JSON error body by status", async () => {
    stubFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    expect((await failure(runListingsActor(LIVE_CFG, INPUT))).kind).toBe("upstream");
  });

  it("rejects a 2xx body that isn't JSON or isn't an array", async () => {
    stubFetch(() => new Response("not json", { status: 201 }));
    expect((await failure(runListingsActor(LIVE_CFG, INPUT))).kind).toBe("invalid_response");

    stubFetch(() => json({ items: [] }));
    expect((await failure(runListingsActor(LIVE_CFG, INPUT))).kind).toBe("invalid_response");
  });

  it("maps an aborted request to timeout", async () => {
    stubFetch(() => {
      throw Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
    });
    expect((await failure(runListingsActor(LIVE_CFG, INPUT))).kind).toBe("timeout");
  });

  it("maps a network error to upstream without leaking the URL", async () => {
    stubFetch(() => {
      throw new TypeError(`fetch failed for https://api.apify.test/v2/acts?token=${TEST_TOKEN}`);
    });
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

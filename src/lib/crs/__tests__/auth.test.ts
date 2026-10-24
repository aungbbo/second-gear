import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetCrsAuthForTests, crsLoginAttempts, FALLBACK_TOKEN_TTL_MS, getCrsToken, parseExpires } from "@/lib/crs/auth";
import { CrsError } from "@/lib/crs/errors";
import { expectNoLeaks, liveConfig, SYNTH_PASSWORD, SYNTH_USERNAME } from "./fixtures";
import { startMockCrs, type MockCrs } from "./mock-crs-server";

let crs: MockCrs;

beforeEach(() => __resetCrsAuthForTests());
afterEach(async () => {
  await crs?.close();
});

async function rejection(promise: Promise<unknown>): Promise<CrsError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(CrsError);
    return err as CrsError;
  }
  throw new Error("expected a CrsError");
}

describe("getCrsToken", () => {
  it("logs in once and reuses the token", async () => {
    crs = await startMockCrs();
    const cfg = liveConfig(crs.baseUrl);
    const first = await getCrsToken(cfg);
    expect(await getCrsToken(cfg)).toBe(first);
    expect(await getCrsToken(cfg)).toBe(first);
    expect(crs.logins).toBe(1);
  });

  it("shares one login between concurrent callers", async () => {
    crs = await startMockCrs();
    const cfg = liveConfig(crs.baseUrl);
    const tokens = await Promise.all(Array.from({ length: 5 }, () => getCrsToken(cfg)));
    expect(new Set(tokens).size).toBe(1);
    expect(crs.logins).toBe(1);
  });

  it("never retries a failed login: later calls fail fast without touching the network", async () => {
    crs = await startMockCrs({ loginFails: true });
    const cfg = liveConfig(crs.baseUrl);
    const first = await rejection(getCrsToken(cfg));
    expect(first.kind).toBe("auth");
    expect(first.message).toContain("not retrying");
    for (let i = 0; i < 3; i++) expect((await rejection(getCrsToken(cfg))).kind).toBe("auth");
    expect(crs.logins, "exactly one login request, ever").toBe(1);
    expect(crsLoginAttempts()).toBe(1);
    expectNoLeaks(first.message, [SYNTH_PASSWORD, SYNTH_USERNAME, crs.baseUrl]);
  });

  it("latches a network failure during login too", async () => {
    crs = await startMockCrs();
    const cfg = liveConfig(crs.baseUrl);
    await crs.close();
    expect((await rejection(getCrsToken(cfg))).kind).toBe("auth");
    expect((await rejection(getCrsToken(cfg))).kind).toBe("auth");
    expect(crsLoginAttempts()).toBe(1);
  });

  it("does not refresh a token that is nowhere near expiry", async () => {
    crs = await startMockCrs();
    const cfg = liveConfig(crs.baseUrl);
    await getCrsToken(cfg);
    await getCrsToken(cfg);
    expect(crs.refreshes).toBe(0);
  });

  it("refreshes once when the token is within a minute of expiry", async () => {
    crs = await startMockCrs({ expires: () => new Date(Date.now() + 30_000).toISOString() });
    const cfg = liveConfig(crs.baseUrl);
    const first = await getCrsToken(cfg);
    const second = await getCrsToken(cfg);
    expect(second).not.toBe(first);
    expect(crs.refreshes).toBe(1);
    expect(crs.logins).toBe(1);
  });

  it("falls back to one fresh login when the refresh is refused", async () => {
    crs = await startMockCrs({ expires: () => new Date(Date.now() + 30_000).toISOString(), refreshPremature: true });
    const cfg = liveConfig(crs.baseUrl);
    await getCrsToken(cfg);
    await getCrsToken(cfg);
    expect(crs.refreshes).toBe(1);
    expect(crs.logins).toBe(2);
  });
});

describe("parseExpires", () => {
  const now = Date.UTC(2026, 9, 24, 12);
  it.each([
    ["ISO string", "2026-10-24T13:00:00Z", Date.UTC(2026, 9, 24, 13)],
    ["epoch ms", Date.UTC(2026, 9, 24, 13), Date.UTC(2026, 9, 24, 13)],
    ["epoch seconds", Date.UTC(2026, 9, 24, 13) / 1000, Date.UTC(2026, 9, 24, 13)],
    ["epoch seconds as string", String(Date.UTC(2026, 9, 24, 13) / 1000), Date.UTC(2026, 9, 24, 13)],
    ["TTL seconds", 3600, now + 3600_000],
    ["garbage", "soon", now + FALLBACK_TOKEN_TTL_MS],
    ["missing", undefined, now + FALLBACK_TOKEN_TTL_MS],
  ])("%s", (_label, input, expected) => {
    expect(parseExpires(input, now)).toBe(expected);
  });
});

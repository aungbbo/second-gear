import { describe, expect, it } from "vitest";
import { DEFAULT_APIFY_BASE_URL, DEFAULT_LISTINGS_ACTOR_ID, getApifyConfig } from "@/lib/apify/config";
import { ApifyError } from "@/lib/apify/errors";
import { TEST_TOKEN } from "./fixtures";

const live = (extra: Record<string, string> = {}) => ({ APIFY_MODE: "live", APIFY_API_TOKEN: TEST_TOKEN, ...extra });

function configError(env: Record<string, string | undefined>): ApifyError {
  try {
    getApifyConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ApifyError);
    expect((err as ApifyError).kind).toBe("config");
    return err as ApifyError;
  }
  throw new Error("expected a config error");
}

describe("getApifyConfig", () => {
  it("requires an explicit mode", () => {
    expect(configError({}).userMessage).toMatch(/APIFY_MODE=live or APIFY_MODE=mock/);
    configError({ APIFY_MODE: "demo" });
  });

  it("returns mock mode without needing a token", () => {
    expect(getApifyConfig({ APIFY_MODE: " Mock " })).toEqual({ mode: "mock" });
  });

  it("requires a token in live mode", () => {
    expect(configError({ APIFY_MODE: "live" }).userMessage).toMatch(/APIFY_API_TOKEN/);
  });

  it("applies safe defaults in live mode", () => {
    expect(getApifyConfig(live())).toEqual({
      mode: "live",
      token: TEST_TOKEN,
      actorId: DEFAULT_LISTINGS_ACTOR_ID,
      baseUrl: DEFAULT_APIFY_BASE_URL,
      searchRadius: "50",
      maxItems: 25,
      maxChargeUsd: 0.25,
      timeoutSecs: 120,
    });
  });

  it("reads overrides and trims the base URL", () => {
    const cfg = getApifyConfig(
      live({
        APIFY_LISTINGS_ACTOR_ID: "someone/other-actor",
        APIFY_BASE_URL: "https://proxy.test/v2/",
        APIFY_SEARCH_RADIUS_MILES: "100",
        APIFY_MAX_ITEMS: "10",
        APIFY_MAX_CHARGE_USD: "0.1",
        APIFY_RUN_TIMEOUT_SECS: "300",
      }),
    );
    expect(cfg).toMatchObject({
      actorId: "someone/other-actor",
      baseUrl: "https://proxy.test/v2",
      searchRadius: "100",
      maxItems: 10,
      maxChargeUsd: 0.1,
      timeoutSecs: 300,
    });
  });

  it.each([
    ["APIFY_SEARCH_RADIUS_MILES", "0"],
    ["APIFY_SEARCH_RADIUS_MILES", "60"],
    ["APIFY_MAX_ITEMS", "0"],
    ["APIFY_MAX_ITEMS", "101"],
    ["APIFY_MAX_ITEMS", "2.5"],
    ["APIFY_MAX_CHARGE_USD", "0"],
    ["APIFY_MAX_CHARGE_USD", "6"],
    ["APIFY_MAX_CHARGE_USD", "lots"],
    ["APIFY_RUN_TIMEOUT_SECS", "301"],
    ["APIFY_LISTINGS_ACTOR_ID", "not an actor"],
  ])("rejects %s=%s instead of falling back to a default", (name, value) => {
    expect(configError(live({ [name]: value })).userMessage).toContain(name);
  });

  it("never puts the token in an error message", () => {
    const err = configError(live({ APIFY_MAX_ITEMS: "nope" }));
    expect(err.message).not.toContain(TEST_TOKEN);
  });
});

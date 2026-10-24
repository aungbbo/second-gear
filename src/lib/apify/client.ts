import type { LiveApifyConfig } from "@/lib/apify/config";
import { ApifyError, LISTINGS_UNAVAILABLE } from "@/lib/apify/errors";
import type { AutotraderSearchInput } from "@/lib/apify/types";

/** Extra time on top of the Actor's own timeout for Apify to answer. */
const RESPONSE_GRACE_MS = 15_000;

/** Apify answers errors as `{ error: { type, message } }`. */
function errorType(json: unknown): string {
  const type = (json as { error?: { type?: unknown } })?.error?.type;
  return typeof type === "string" ? type : "unknown";
}

function statusError(status: number, type: string): ApifyError {
  const detail = `HTTP ${status} ${type}`;
  if (status === 401 || status === 403) return new ApifyError("auth", LISTINGS_UNAVAILABLE, { status, detail });
  if (status === 402) return new ApifyError("quota", LISTINGS_UNAVAILABLE, { status, detail });
  if (status === 404) return new ApifyError("not_found", LISTINGS_UNAVAILABLE, { status, detail });
  if (status === 408) return new ApifyError("timeout", LISTINGS_UNAVAILABLE, { status, detail });
  if (status === 429) return new ApifyError("rate_limited", LISTINGS_UNAVAILABLE, { status, detail });
  return new ApifyError("upstream", LISTINGS_UNAVAILABLE, { status, detail });
}

/**
 * Runs the listings Actor once and returns its dataset items, using Apify's
 * synchronous run endpoint. Item count, spend, and run time are capped on
 * every call. The token goes only in the Authorization header, never in the
 * URL, so it can't leak through logged request URLs. Never retried: each run
 * is billed.
 */
export async function runListingsActor(cfg: LiveApifyConfig, input: AutotraderSearchInput): Promise<unknown[]> {
  const query = new URLSearchParams({
    timeout: String(cfg.timeoutSecs),
    maxItems: String(cfg.maxItems),
    maxTotalChargeUsd: String(cfg.maxChargeUsd),
    format: "json",
    clean: "true",
  });
  const actor = encodeURIComponent(cfg.actorId.replace("/", "~"));

  let response: Response;
  try {
    response = await fetch(`${cfg.baseUrl}/acts/${actor}/run-sync-get-dataset-items?${query}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: AbortSignal.timeout(cfg.timeoutSecs * 1000 + RESPONSE_GRACE_MS),
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ApifyError("timeout", LISTINGS_UNAVAILABLE, { detail: `no response within ${cfg.timeoutSecs}s` });
    }
    throw new ApifyError("upstream", LISTINGS_UNAVAILABLE, { detail: `network error: ${(err as Error)?.message ?? "unknown"}` });
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    if (!response.ok) throw statusError(response.status, "unparsable body");
    throw new ApifyError("invalid_response", LISTINGS_UNAVAILABLE, { status: response.status, detail: "body is not JSON" });
  }

  if (!response.ok) throw statusError(response.status, errorType(json));
  if (!Array.isArray(json)) {
    throw new ApifyError("invalid_response", LISTINGS_UNAVAILABLE, { status: response.status, detail: "dataset items are not an array" });
  }
  return json;
}

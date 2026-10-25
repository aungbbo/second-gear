import type { LiveApifyConfig } from "@/lib/apify/config";
import { ApifyError, LISTINGS_TIMEOUT, LISTINGS_UNAVAILABLE } from "@/lib/apify/errors";
import type { CarfaxSearchInput } from "@/lib/apify/types";

/** Apify holds a start or status request open for at most 60 s. */
const MAX_WAIT_SECS = 60;
/** Extra time per HTTP call on top of the server-side wait. */
const REQUEST_GRACE_MS = 10_000;
/** Time allowed for the Actor's own timeout to land before the app aborts the run. */
const ABORT_GRACE_MS = 10_000;

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);

interface RunInfo {
  id: string;
  status: string;
  defaultDatasetId: string;
  statusMessage?: string;
}

export interface ActorRunResult {
  items: unknown[];
  /** True when the run timed out or was aborted and only the items collected so far came back. */
  partial: boolean;
  status: string;
}

/** Apify answers errors as `{ error: { type, message } }`. */
function errorType(json: unknown): string {
  const type = (json as { error?: { type?: unknown } })?.error?.type;
  return typeof type === "string" ? type : "unknown";
}

function statusError(status: number, type: string): ApifyError {
  const detail = `HTTP ${status} ${type}`;
  if (status === 401 || status === 403) return new ApifyError("auth", "Apify rejected the API token or access to the CARFAX Actor. Check the token and Actor permissions.", { status, detail });
  if (status === 402) return new ApifyError("quota", "Apify couldn't start the listing search because of an account usage or billing limit.", { status, detail });
  if (status === 404) return new ApifyError("not_found", "Apify couldn't find the configured Actor or its dataset. Check the Actor ID and latest run.", { status, detail });
  if (status === 408) return new ApifyError("timeout", LISTINGS_TIMEOUT, { status, detail });
  if (status === 429) return new ApifyError("rate_limited", "Apify rate-limited the live search. Wait a little before trying again.", { status, detail });
  const message = status === 400
    ? "Apify rejected the Actor input or dataset request. Check the latest CARFAX run and its input in your Apify console."
    : `Apify returned HTTP ${status} while starting the search or reading listings. Check the latest CARFAX run in your Apify console.`;
  return new ApifyError("upstream", message, { status, detail });
}

/**
 * One Apify API call. The token goes only in the Authorization header, never
 * in the URL, so it can't leak through logged request URLs.
 */
async function request(cfg: LiveApifyConfig, method: "GET" | "POST", path: string, timeoutMs: number, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${cfg.token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ApifyError("timeout", LISTINGS_TIMEOUT, { detail: `${method} gave no response in ${Math.round(timeoutMs / 1000)}s` });
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
  return json;
}

function runInfo(json: unknown): RunInfo {
  const data = (json as { data?: Record<string, unknown> })?.data;
  if (typeof data?.id !== "string" || typeof data.status !== "string" || typeof data.defaultDatasetId !== "string") {
    throw new ApifyError("invalid_response", LISTINGS_UNAVAILABLE, { detail: "run object is missing id, status, or defaultDatasetId" });
  }
  return {
    id: data.id,
    status: data.status,
    defaultDatasetId: data.defaultDatasetId,
    statusMessage: typeof data.statusMessage === "string" ? data.statusMessage.slice(0, 500) : undefined,
  };
}

/**
 * Runs the listings Actor once and returns its dataset items.
 *
 * Uses the asynchronous run API so the app always knows the run's fate:
 * start (waiting up to 60 s), poll until it finishes, and abort it if it is
 * still going past the deadline, which stops further charges. A run that
 * timed out or was aborted still returns whatever it collected. Item count,
 * spend, and run time are capped on Apify's side on every run. Never
 * retried: each run is billed.
 */
export async function runListingsActor(cfg: LiveApifyConfig, input: CarfaxSearchInput): Promise<ActorRunResult> {
  const deadline = Date.now() + cfg.timeoutSecs * 1000 + ABORT_GRACE_MS;
  const waitFor = () => Math.max(0, Math.min(MAX_WAIT_SECS, Math.ceil((deadline - Date.now()) / 1000)));

  const query = new URLSearchParams({
    timeout: String(cfg.timeoutSecs),
    maxItems: String(cfg.maxItems),
    maxTotalChargeUsd: String(cfg.maxChargeUsd),
    waitForFinish: String(waitFor()),
  });
  const actor = encodeURIComponent(cfg.actorId.replace("/", "~"));
  let run = runInfo(await request(cfg, "POST", `/acts/${actor}/runs?${query}`, waitFor() * 1000 + REQUEST_GRACE_MS, input));

  let abortedByApp = false;
  while (!TERMINAL.has(run.status)) {
    const wait = waitFor();
    if (wait === 0) {
      try {
        run = runInfo(await request(cfg, "POST", `/actor-runs/${encodeURIComponent(run.id)}/abort`, REQUEST_GRACE_MS));
      } catch (err) {
        // Apify's own run timeout still stops it; read whatever it has so far.
        console.warn(`[apify] abort failed: ${err instanceof ApifyError ? err.kind : "unknown"}`);
      }
      abortedByApp = true;
      break;
    }
    run = runInfo(await request(cfg, "GET", `/actor-runs/${encodeURIComponent(run.id)}?waitForFinish=${wait}`, wait * 1000 + REQUEST_GRACE_MS));
  }

  if (run.status === "FAILED" || (run.status === "ABORTED" && !abortedByApp)) {
    const detail = [`run ${run.id} ${run.status}`, run.statusMessage].filter(Boolean).join(": ");
    throw new ApifyError(
      "upstream",
      "The CARFAX listings Actor failed in Apify. Check the latest run's Actor log in your Apify console, then try again.",
      { detail },
    );
  }

  const itemsQuery = new URLSearchParams({ format: "json", clean: "true", limit: String(cfg.maxItems) });
  const items = await request(cfg, "GET", `/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?${itemsQuery}`, REQUEST_GRACE_MS);
  if (!Array.isArray(items)) {
    throw new ApifyError("invalid_response", LISTINGS_UNAVAILABLE, { detail: "dataset items are not an array" });
  }

  const partial = run.status !== "SUCCEEDED";
  if (partial && items.length === 0) {
    throw new ApifyError("timeout", LISTINGS_TIMEOUT, { detail: `run ${abortedByApp ? "aborted at deadline" : run.status} with no items` });
  }
  return { items, partial, status: abortedByApp ? "ABORTED" : run.status };
}

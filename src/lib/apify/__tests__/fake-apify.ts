import { vi } from "vitest";

type Status = "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED-OUT" | "ABORTED";

export interface FakeApifyOptions {
  /** Statuses the run reports: on start, then on each poll. The last one repeats. */
  statuses?: Status[];
  items?: unknown;
  /** Status returned after an abort request. */
  abortStatus?: Status;
  /** Fail the start call with this HTTP status and Apify error body. */
  startError?: { status: number; type: string; message?: string };
  /** Replace a specific call's response. */
  override?: (method: string, path: string) => Response | undefined;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Stubs global fetch with the parts of the Apify v2 API the client uses:
 * start a run, poll it, abort it, read its dataset. Records every call.
 */
export function fakeApify(options: FakeApifyOptions = {}) {
  const statuses = options.statuses ?? ["SUCCEEDED"];
  let poll = 0;
  let current: Status = statuses[0];
  const calls: { method: string; path: string; url: string; init: RequestInit }[] = [];
  const run = () => json({ data: { id: "run1", status: current, defaultDatasetId: "ds1" } }, 201);

  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const path = parsed.pathname.replace(/^\/v2/, "");
    calls.push({ method, path, url, init });

    const overridden = options.override?.(method, path);
    if (overridden) return overridden;

    if (method === "POST" && /^\/acts\/[^/]+\/runs$/.test(path)) {
      if (options.startError) {
        const { status, type, message } = options.startError;
        return json({ error: { type, message: message ?? type } }, status);
      }
      return run();
    }
    if (method === "GET" && path === "/actor-runs/run1") {
      poll = Math.min(poll + 1, statuses.length - 1);
      current = statuses[poll];
      return run();
    }
    if (method === "POST" && path === "/actor-runs/run1/abort") {
      current = options.abortStatus ?? "ABORTED";
      return run();
    }
    if (method === "GET" && path === "/datasets/ds1/items") return json(options.items ?? []);
    return json({ error: { type: "record-not-found" } }, 404);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

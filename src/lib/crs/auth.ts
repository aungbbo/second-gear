import type { LiveCrsConfig } from "@/lib/crs/config";
import { CRS_UNAVAILABLE, CrsError } from "@/lib/crs/errors";

export const AUTH_TIMEOUT_MS = 10_000;
/** Refresh only this close to expiry; earlier refreshes fail with CRS117. */
export const REFRESH_WINDOW_MS = 60_000;
/** Used when the login response's `expires` can't be parsed. */
export const FALLBACK_TOKEN_TTL_MS = 10 * 60_000;

interface Session {
  token: string;
  refreshToken?: string;
  expiresAt: number;
}

/**
 * Process-wide auth state, in memory only. Never logged, persisted, or sent to
 * the browser. A failed login latches: CRS disables an account after repeated
 * failed logins (CRS113 then CRS114), so this process never tries again.
 */
interface AuthState {
  session: Session | null;
  inflight: Promise<Session> | null;
  loginFailure: CrsError | null;
  loginAttempts: number;
}

const store = globalThis as typeof globalThis & { __secondGearCrsAuth?: AuthState };
const auth = (): AuthState =>
  (store.__secondGearCrsAuth ??= { session: null, inflight: null, loginFailure: null, loginAttempts: 0 });

/** Test hook: forget the session and any login latch. */
export function __resetCrsAuthForTests() {
  store.__secondGearCrsAuth = { session: null, inflight: null, loginFailure: null, loginAttempts: 0 };
}

export function crsLoginAttempts(): number {
  return auth().loginAttempts;
}

/**
 * Parses the login response's `expires`. The spec leaves its format open, so
 * ISO strings, epoch seconds/milliseconds, and small TTLs in seconds are all
 * accepted; anything else gets a short fallback lifetime.
 */
export function parseExpires(expires: unknown, now: number): number {
  const numeric = typeof expires === "number" ? expires : typeof expires === "string" && /^\d+$/.test(expires.trim()) ? Number(expires) : NaN;
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric < 1e9) return now + numeric * 1000; // TTL in seconds
    if (numeric < 1e12) return numeric * 1000; // epoch seconds
    return numeric; // epoch milliseconds
  }
  if (typeof expires === "string") {
    const ms = Date.parse(expires);
    if (Number.isFinite(ms)) return ms;
  }
  return now + FALLBACK_TOKEN_TTL_MS;
}

async function postJson(url: string, body: unknown): Promise<{ status: number; ok: boolean; json: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, json };
}

/** Error codes only — never the response text, which may echo the username. */
function codesOf(json: unknown): string {
  const codes = (json as { codes?: unknown })?.codes;
  return Array.isArray(codes) ? codes.filter((c) => typeof c === "string").join(",") : "";
}

function sessionFrom(json: unknown, now: number): Session | null {
  const body = json as { token?: unknown; refreshToken?: unknown; expires?: unknown };
  if (typeof body?.token !== "string" || body.token.length === 0) return null;
  return {
    token: body.token,
    refreshToken: typeof body.refreshToken === "string" ? body.refreshToken : undefined,
    expiresAt: parseExpires(body.expires, now),
  };
}

async function login(cfg: LiveCrsConfig, now: number): Promise<Session> {
  const state = auth();
  state.loginAttempts++;
  let result: Awaited<ReturnType<typeof postJson>>;
  try {
    result = await postJson(`${cfg.baseUrl}/users/login`, { username: cfg.username, password: cfg.password });
  } catch (err) {
    const timedOut = (err as { name?: string })?.name === "TimeoutError";
    state.loginFailure = new CrsError("auth", CRS_UNAVAILABLE, {
      detail: `CRS login ${timedOut ? "timed out" : "network error"}; not retrying in this process`,
    });
    throw state.loginFailure;
  }
  const session = result.ok ? sessionFrom(result.json, now) : null;
  if (!session) {
    const codes = codesOf(result.json);
    state.loginFailure = new CrsError("auth", CRS_UNAVAILABLE, {
      status: result.status,
      detail: `CRS login failed: HTTP ${result.status}${codes ? ` ${codes}` : ""}; not retrying in this process — check CRS_USERNAME/CRS_PASSWORD and restart`,
    });
    throw state.loginFailure;
  }
  return session;
}

async function refresh(cfg: LiveCrsConfig, session: Session, now: number): Promise<Session | null> {
  if (!session.refreshToken) return null;
  try {
    const result = await postJson(`${cfg.baseUrl}/users/refresh-token`, { refreshToken: session.refreshToken });
    return result.ok ? sessionFrom(result.json, now) : null;
  } catch {
    return null;
  }
}

/**
 * Returns a bearer token, logging in at most once per process. Concurrent
 * callers share one login; a failed login is never retried.
 */
export async function getCrsToken(cfg: LiveCrsConfig, now: number = Date.now()): Promise<string> {
  const state = auth();
  if (state.loginFailure) throw state.loginFailure;
  if (state.session && now < state.session.expiresAt - REFRESH_WINDOW_MS) return state.session.token;
  if (state.inflight) return (await state.inflight).token;

  const current = state.session;
  state.inflight = (async () => {
    // Near or past expiry: try the refresh token once, then fall back to one fresh login.
    const refreshed = current ? await refresh(cfg, current, now) : null;
    return refreshed ?? login(cfg, now);
  })();
  try {
    state.session = await state.inflight;
    return state.session.token;
  } catch (err) {
    state.session = null;
    throw err;
  } finally {
    state.inflight = null;
  }
}

/** Drop the cached token after a 401 so the next request re-authenticates once. */
export function invalidateCrsToken() {
  auth().session = null;
}

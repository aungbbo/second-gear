import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { syntheticP05Report } from "./fixtures";

/**
 * In-memory stand-in for the CRS sandbox on 127.0.0.1, shaped after the
 * CalHacks OpenAPI spec: login/refresh, and the CRS Standard Format report
 * route. It returns SYNTHETIC data and mimics the documented behaviours —
 * outcomes in the body with HTTP 200, 401 CRS111, 429 CRS962 with Retry-After.
 */

export type ReportMode = "ok" | "E1005" | "freeze" | "nohit" | "hard" | "noscore" | "401" | "429" | "500" | "html";

export interface MockCrsOptions {
  /** Answer every login with 401 CRS113. */
  loginFails?: boolean;
  /** Value of `expires` in the login response (default: one hour from now, ISO). */
  expires?: () => unknown;
  /** Refresh answers 400 CRS117 (premature). */
  refreshPremature?: boolean;
  report?: ReportMode;
  /** Mutate the synthetic report before it is sent. */
  editReport?: (report: Record<string, unknown>) => void;
}

export interface MockCrs {
  baseUrl: string;
  logins: number;
  refreshes: number;
  reports: number;
  /** Bodies and auth headers the report route received. */
  reportRequests: { path: string; authorization?: string; body: Record<string, unknown> }[];
  /** Every token the server issued — none may ever surface in output. */
  issuedTokens: string[];
  options: MockCrsOptions;
  close(): Promise<void>;
}

export async function startMockCrs(options: MockCrsOptions = {}): Promise<MockCrs> {
  let seq = 0;
  const mint = (kind: string) => {
    const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(`${kind}-${++seq}`).toString("base64url")}.c2ln`;
    state.issuedTokens.push(token);
    return token;
  };

  const state: MockCrs = {
    baseUrl: "",
    logins: 0,
    refreshes: 0,
    reports: 0,
    reportRequests: [],
    issuedTokens: [],
    options,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const valid = new Set<string>();

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(typeof body === "string" ? body : JSON.stringify(body));
      };
      const body = (() => {
        try {
          return raw ? JSON.parse(raw) : {};
        } catch {
          return {};
        }
      })();
      const path = new URL(req.url ?? "/", "http://mock").pathname;

      if (req.method === "POST" && path === "/users/login") {
        state.logins++;
        if (state.options.loginFails) return send(401, { timestamp: "now", codes: ["CRS113"], messages: [`Access Denied for ${body.username}`] });
        const token = mint("access");
        valid.add(token);
        return send(200, {
          token,
          refreshToken: mint("refresh"),
          expires: state.options.expires ? state.options.expires() : new Date(Date.now() + 3600_000).toISOString(),
        });
      }
      if (req.method === "POST" && path === "/users/refresh-token") {
        state.refreshes++;
        if (state.options.refreshPremature) return send(400, { codes: ["CRS117"], messages: ["Refresh Token Premature"] });
        const token = mint("access");
        valid.add(token);
        return send(200, { token, refreshToken: mint("refresh"), expires: new Date(Date.now() + 3600_000).toISOString() });
      }

      const match = /^\/(experian|transunion|equifax)\/credit-report\/standard\/([\w-]+)$/.exec(path);
      if (req.method === "POST" && match) {
        state.reports++;
        const authorization = req.headers.authorization;
        state.reportRequests.push({ path, authorization, body });
        const bearer = authorization?.replace(/^Bearer /, "");
        const mode = state.options.report ?? "ok";
        if (!bearer || !valid.has(bearer) || mode === "401") return send(401, { codes: ["CRS111"], messages: ["Unauthorized"] });
        if (mode === "429") return send(429, { codes: ["CRS962"], messages: ["Too many requests"] }, { "retry-after": "7" });
        if (mode === "500") return send(500, { codes: ["CRS500"], messages: [`internal error for ssn ${body.ssn}`] });
        if (mode === "html") return send(200, "<html>gateway</html>");

        const report = syntheticP05Report() as Record<string, unknown> & ReturnType<typeof syntheticP05Report>;
        if (mode === "E1005") report.errorMessages = [{ creditErrorMessageCode: "E1005", creditErrorMessageText: "User configuration not found" }];
        if (mode === "freeze") report.creditFiles = [{ creditFileDetail: { creditFileResultStatusType: "NoFileReturnedCreditFreeze" } }];
        if (mode === "nohit") report.creditFiles = [{ creditFileDetail: { creditFileResultStatusType: "NoFileReturnedNoHit" } }];
        if (mode === "hard") report.responseDetail = { ...report.responseDetail, creditPullType: "Hard" };
        if (mode === "noscore") report.scores = [{ modelName: "VantageScore4.0", scoreValue: undefined, noScoreReasonType: "NotScoredInsufficientCredit" }];
        state.options.editReport?.(report);
        return send(200, report, { RequestID: "REQ-SYNTH-42" });
      }
      return send(404, { codes: ["CRS404"], messages: ["Not found"] });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return state;
}

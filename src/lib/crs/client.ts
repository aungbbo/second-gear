import type { VerifiedConsent } from "@/lib/consent";
import { getCrsToken, invalidateCrsToken } from "@/lib/crs/auth";
import type { LiveCrsConfig } from "@/lib/crs/config";
import { CRS_UNAVAILABLE, CrsError } from "@/lib/crs/errors";
import type { CrsCreditReportResponse } from "@/lib/crs/types";

export const REPORT_TIMEOUT_MS = 20_000;

export type PullTypeVerification = "reported" | "documented-prequal-config";

interface ReportValidationContext {
  bureau: LiveCrsConfig["bureau"];
  configName: string;
}

/** "POST /experian/credit-report/standard/:config" — never the host, config value, or ids. */
export const describeReportEndpoint = (cfg: LiveCrsConfig) => `POST /${cfg.bureau}/credit-report/standard/:config`;

/**
 * Exactly the persona's documented sandbox body, fields at the root as the
 * guide requires. Consent metadata (IP, user agent) stays on the server: adding
 * fields could stop the request matching the sandbox persona and make it billable.
 */
export function buildReportBody(cfg: LiveCrsConfig) {
  const { persona } = cfg;
  return {
    firstName: persona.firstName,
    lastName: persona.lastName,
    ssn: persona.ssn,
    addresses: [{ ...persona.address, borrowerResidencyType: "Current" }],
  };
}

const codesOf = (json: unknown): string => {
  const codes = (json as { codes?: unknown })?.codes;
  return Array.isArray(codes) ? codes.filter((c) => typeof c === "string").join(",") : "";
};

/**
 * Orders one prequalification credit report. `consent` must already be
 * verified; requiring it here keeps every caller honest. Never retried.
 */
export async function orderCreditReport(cfg: LiveCrsConfig, consent: VerifiedConsent): Promise<CrsCreditReportResponse> {
  if (!consent?.issuedAt) throw new CrsError("config", CRS_UNAVAILABLE, { detail: "credit report requested without verified consent" });

  const endpoint = describeReportEndpoint(cfg);
  const token = await getCrsToken(cfg);

  let response: Response;
  try {
    response = await fetch(`${cfg.baseUrl}/${cfg.bureau}/credit-report/standard/${encodeURIComponent(cfg.configName)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(buildReportBody(cfg)),
      cache: "no-store",
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = (err as { name?: string })?.name === "TimeoutError";
    throw new CrsError(timedOut ? "timeout" : "upstream", CRS_UNAVAILABLE, { detail: `${endpoint}: ${timedOut ? "timed out" : "network error"}` });
  }

  const json = await response.json().catch(() => undefined);

  if (response.status === 401) {
    invalidateCrsToken();
    throw new CrsError("auth", CRS_UNAVAILABLE, { status: 401, detail: `${endpoint}: HTTP 401 ${codesOf(json)}`.trim() });
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new CrsError("rate_limited", "The credit service is busy. Try again shortly.", {
      status: 429,
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
      detail: `${endpoint}: HTTP 429 ${codesOf(json)}`.trim(),
    });
  }
  if (!response.ok) {
    throw new CrsError("upstream", CRS_UNAVAILABLE, { status: response.status, detail: `${endpoint}: HTTP ${response.status} ${codesOf(json)}`.trim() });
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new CrsError("invalid_response", CRS_UNAVAILABLE, { detail: `${endpoint}: body is not a report object` });
  }

  return checkReportOutcome(json as CrsCreditReportResponse, endpoint, cfg);
}

/**
 * The guide's rule: read the outcome from the body, never the status. No
 * file, frozen file, validation errors, and a wrong config all arrive as 200.
 */
export function checkReportOutcome(
  report: CrsCreditReportResponse,
  endpoint = "credit report",
  context?: ReportValidationContext,
): CrsCreditReportResponse {
  const errors = report.errorMessages ?? [];
  if (errors.length > 0) {
    const codes = errors.map((e) => e?.creditErrorMessageCode).filter(Boolean).join(",");
    if (errors.some((e) => e?.creditErrorMessageCode === "E1005")) {
      throw new CrsError("config", "Credit provider not configured.", {
        detail: `${endpoint}: E1005 user configuration not found — wrong CRS_CONFIG or no access to this bureau`,
      });
    }
    throw new CrsError("bureau_error", CRS_UNAVAILABLE, { detail: `${endpoint}: bureau errors ${codes || "(no codes)"}` });
  }

  const statuses = (report.creditFiles ?? []).map((f) => f?.creditFileDetail?.creditFileResultStatusType).filter(Boolean) as string[];
  if (statuses.length === 0) {
    throw new CrsError("invalid_response", CRS_UNAVAILABLE, { detail: `${endpoint}: no creditFiles status` });
  }
  if (!statuses.includes("FileReturned")) {
    if (statuses.includes("NoFileReturnedCreditFreeze")) {
      throw new CrsError("frozen", "Your credit file is frozen, so we couldn't read it. Lift the freeze and try again.", {
        detail: `${endpoint}: ${statuses.join(",")}`,
      });
    }
    throw new CrsError("no_file", "No credit file was found.", { detail: `${endpoint}: ${statuses.join(",")}` });
  }

  const pullType = report.responseDetail?.creditPullType;
  const pullTypeVerification: PullTypeVerification | undefined = pullType === "Soft" ? "reported" : undefined;
  if (pullTypeVerification) return report;

  const missingPullType = pullType === undefined || pullType === null;
  const documentedPrequalConfig =
    missingPullType && context?.bureau === "experian" && context.configName === "exp-prequal-vantage4";
  const fallbackVerification: PullTypeVerification | undefined = documentedPrequalConfig ? "documented-prequal-config" : undefined;
  if (fallbackVerification) {
    // The CalHacks sandbox omits creditPullType for this documented soft-pull config.
    // Keep this warning free of response, identity, and request identifiers.
    console.warn("[crs] creditPullType missing; accepted documented Experian prequalification config");
    return report;
  }

  if (pullType !== "Soft") {
    console.error(`[crs] refused a report whose creditPullType was ${pullType ?? "missing"}; nothing was used`);
    throw new CrsError("not_soft_pull", "We stopped: the credit check wasn't a soft pull.", {
      detail: `${endpoint}: creditPullType=${pullType ?? "missing"}`,
    });
  }

  return report;
}

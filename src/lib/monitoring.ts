const SECURITY_EVENT_PREFIX = "[security]";

export type SecurityEvent =
  | "consent_request"
  | "pipeline_request"
  | "rate_limit_blocked"
  | "crs_pull_attempt"
  | "crs_pull_succeeded"
  | "crs_pull_failed"
  | "crs_billable_activity"
  | "crs_quota_blocked"
  | "crs_kill_switch_blocked";

/** Emits fixed-shape, PII-free events suitable for Vercel log ingestion. */
export function recordSecurityEvent(event: SecurityEvent, outcome: "accepted" | "blocked" | "failed" = "accepted"): void {
  console.info(SECURITY_EVENT_PREFIX, event, outcome);
}

export type CrsErrorKind =
  | "config"
  | "auth"
  | "rate_limited"
  | "quota"
  | "timeout"
  | "upstream"
  | "invalid_response"
  | "bureau_error"
  | "no_file"
  | "frozen"
  | "no_score"
  | "not_soft_pull";

/**
 * Strips anything that could identify the buyer or unlock the account before
 * text reaches an error message or log: URLs, bearer tokens and JWTs,
 * credential fields, SSN-shaped numbers, and id-shaped tokens.
 */
export function scrubCrsDetail(text: string): string {
  return String(text)
    .replace(/\bhttps?:\/\/\S+/gi, "<url>")
    .replace(/\bBearer\s+[\w.~+/=-]+/gi, "Bearer ***")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "<jwt>")
    .replace(/("?(?:password|token|refreshToken|ssn)"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)/gi, "$1***")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "<ssn>")
    .replace(/\b\d{9}\b/g, "<ssn>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b[0-9a-f]{24,64}\b/gi, "<id>");
}

/**
 * Every failure on the live CRS path. `userMessage` is a fixed, buyer-safe
 * string; `message` adds a scrubbed detail for server logs only.
 */
export class CrsError extends Error {
  readonly kind: CrsErrorKind;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly userMessage: string;

  constructor(
    kind: CrsErrorKind,
    userMessage: string,
    options: { status?: number; detail?: string; retryAfterSeconds?: number } = {},
  ) {
    super(options.detail ? `${userMessage} (${scrubCrsDetail(options.detail)})` : userMessage);
    this.name = "CrsError";
    this.kind = kind;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.userMessage = userMessage;
  }
}

export const CRS_UNAVAILABLE = "We couldn't complete the credit check right now.";

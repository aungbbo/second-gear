export type ApifyErrorKind =
  | "config"
  | "auth"
  | "not_found"
  | "quota"
  | "rate_limited"
  | "timeout"
  | "upstream"
  | "invalid_response"
  | "no_listings"
  /** The app's own cost guard refused to start another paid run. */
  | "budget";

/** Apify API tokens start with `apify_api_`; strip them wherever they appear. */
const TOKEN = /\bapify_api_[A-Za-z0-9]+/g;

/**
 * Last line of defence for anything that ends up in an error message or log:
 * strips URLs (which can carry `?token=`), token query values, and anything
 * shaped like an Apify API token.
 */
export function scrubDetail(text: string): string {
  return text
    .replace(/\bhttps?:\/\/\S+/gi, "<url>")
    .replace(/([?&]token=)[^&\s)]*/gi, "$1***")
    .replace(TOKEN, "<redacted>");
}

/**
 * Every failure on the live Apify path surfaces as one of these.
 * `userMessage` is a fixed, buyer-safe string; `message` adds a scrubbed
 * detail for logs and never contains the token or request URLs.
 */
export class ApifyError extends Error {
  readonly kind: ApifyErrorKind;
  readonly status?: number;
  readonly userMessage: string;
  readonly retryAfterSeconds?: number;

  constructor(
    kind: ApifyErrorKind,
    userMessage: string,
    options: { status?: number; detail?: string; retryAfterSeconds?: number } = {},
  ) {
    super(options.detail ? `${userMessage} (${scrubDetail(options.detail)})` : userMessage);
    this.name = "ApifyError";
    this.kind = kind;
    this.status = options.status;
    this.userMessage = userMessage;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export const LISTINGS_UNAVAILABLE = "We couldn't load live car listings right now. Try again in a few minutes.";
export const LISTINGS_TIMEOUT = "The live car search took too long. Try again in a few minutes.";
export const LISTINGS_BUSY = "Live car search is busy right now. Try again in a little while.";

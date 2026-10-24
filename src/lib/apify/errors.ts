export type ApifyErrorKind =
  | "config"
  | "auth"
  | "not_found"
  | "quota"
  | "rate_limited"
  | "timeout"
  | "upstream"
  | "invalid_response"
  | "no_listings";

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

  constructor(kind: ApifyErrorKind, userMessage: string, options: { status?: number; detail?: string } = {}) {
    super(options.detail ? `${userMessage} (${scrubDetail(options.detail)})` : userMessage);
    this.name = "ApifyError";
    this.kind = kind;
    this.status = options.status;
    this.userMessage = userMessage;
  }
}

export const LISTINGS_UNAVAILABLE = "We couldn't load live car listings right now. Try again in a few minutes.";

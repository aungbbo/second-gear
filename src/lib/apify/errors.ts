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
  /** The run finished but returned nothing, which can't tell "no cars" from a broken scraper. Never cached. */
  | "empty_result"
  /** The search plan names no single make, so no paid run was started. */
  | "missing_make"
  /** The assessment leaves no price above the minimum search price, so no paid run was started. */
  | "no_affordable_price"
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
export const LISTINGS_EMPTY =
  "We didn't get any listings back for this search, so we can't tell yet whether matching cars are for sale. Try again in a few minutes, or widen your price range or search radius.";
export const LISTINGS_MISSING_MAKE =
  "Tell us which make you're shopping for (for example, \"a used Toyota Corolla\" or \"a Honda SUV\") so we can search live listings. Name one make at a time.";
export const LISTINGS_NO_AFFORDABLE_PRICE =
  "Your cash flow doesn't leave room for a car priced above $3,000 right now, after essentials, existing debt, ownership costs, and an emergency reserve, so we didn't search live listings.";

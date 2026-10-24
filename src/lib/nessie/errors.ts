export type NessieErrorKind =
  | "config"
  | "auth"
  | "not_found"
  | "upstream"
  | "timeout"
  | "invalid_response"
  | "insufficient_data";

const KEY_PARAM = /([?&]key=)[^&\s)]*/gi;

/**
 * Last line of defence for anything that ends up in an error message or log:
 * strips URLs, `key=` values, and id/key-shaped tokens. The 32-hex rule runs
 * before the 24-hex one so a key is never partially matched.
 */
export function scrubDetail(text: string): string {
  return text
    .replace(/\bhttps?:\/\/\S+/gi, "<url>")
    .replace(KEY_PARAM, "$1***")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b[0-9a-f]{32}\b/gi, "<redacted>")
    .replace(/\b[0-9a-f]{24}\b/gi, "<id>");
}

/**
 * Every failure on the live Nessie path surfaces as one of these.
 * `userMessage` is a fixed, buyer-safe string; `message` adds a scrubbed
 * detail for logs and never contains the key, ids, or request URLs.
 */
export class NessieError extends Error {
  readonly kind: NessieErrorKind;
  readonly status?: number;
  readonly userMessage: string;

  constructor(kind: NessieErrorKind, userMessage: string, options: { status?: number; detail?: string } = {}) {
    super(options.detail ? `${userMessage} (${scrubDetail(options.detail)})` : userMessage);
    this.name = "NessieError";
    this.kind = kind;
    this.status = options.status;
    this.userMessage = userMessage;
  }
}

/** Masks the `key` query parameter so URLs can be logged safely. */
export function redactKey(url: string): string {
  return url.replace(KEY_PARAM, "$1***");
}

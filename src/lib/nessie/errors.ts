export type NessieErrorKind =
  | "config"
  | "auth"
  | "not_found"
  | "upstream"
  | "timeout"
  | "invalid_response"
  | "insufficient_data";

/**
 * Every failure on the live Nessie path surfaces as one of these. The
 * message is safe to show the buyer and never contains the API key.
 */
export class NessieError extends Error {
  readonly kind: NessieErrorKind;
  readonly status?: number;
  readonly userMessage: string;

  constructor(kind: NessieErrorKind, userMessage: string, options: { status?: number; detail?: string } = {}) {
    super(options.detail ? `${userMessage} (${options.detail})` : userMessage);
    this.name = "NessieError";
    this.kind = kind;
    this.status = options.status;
    this.userMessage = userMessage;
  }
}

/** Masks the `key` query parameter so URLs can be logged safely. */
export function redactKey(url: string): string {
  return url.replace(/([?&]key=)[^&]*/gi, "$1***");
}

import { describe, expect, it } from "vitest";
import { NessieError, redactKey, scrubDetail } from "@/lib/nessie/errors";
import { REAL_FORMAT_ACCOUNT_ID, REAL_FORMAT_CUSTOMER_ID, REAL_FORMAT_KEY, expectNoLeaks } from "./fixtures";

const SECRETS = [REAL_FORMAT_CUSTOMER_ID, REAL_FORMAT_ACCOUNT_ID, REAL_FORMAT_KEY, "api.nessieisreal.com"];

describe("scrubDetail", () => {
  it("removes URLs, key params, and id- or key-shaped tokens", () => {
    const raw =
      `fetch https://api.nessieisreal.com/customers/${REAL_FORMAT_CUSTOMER_ID}/accounts?key=${REAL_FORMAT_KEY} ` +
      `then /accounts/${REAL_FORMAT_ACCOUNT_ID}/deposits?key=abc and token ${REAL_FORMAT_KEY.toUpperCase()}`;
    const scrubbed = scrubDetail(raw);
    expectNoLeaks(scrubbed, [...SECRETS, REAL_FORMAT_KEY.toUpperCase(), "key=abc"]);
    expect(scrubbed).toContain("<url>");
    expect(scrubbed).toContain("/accounts/<id>/deposits?key=***");
    expect(scrubbed).toContain("token <redacted>");
  });

  it("leaves ordinary diagnostic text alone", () => {
    const text = "HTTP 401 from GET /customers/:id/accounts — 2 account record(s) failed validation";
    expect(scrubDetail(text)).toBe(text);
  });

  it("keeps redactKey's behaviour for URLs", () => {
    expect(redactKey("http://x.test/a?key=s3cret&b=1")).toBe("http://x.test/a?key=***&b=1");
  });
});

describe("NessieError", () => {
  it("scrubs the detail it puts in the message but keeps userMessage verbatim", () => {
    const err = new NessieError("auth", "The bank data service rejected our credentials.", {
      detail: `https://api.nessieisreal.com/customers/${REAL_FORMAT_CUSTOMER_ID}?key=${REAL_FORMAT_KEY} account ${REAL_FORMAT_ACCOUNT_ID}`,
    });
    expectNoLeaks(err.message, SECRETS);
    expectNoLeaks(String(err.stack), SECRETS);
    expect(err.userMessage).toBe("The bank data service rejected our credentials.");
  });
});

import { NextRequest, NextResponse } from "next/server";
import { assertConsentRuntime, ConsentError, issueConsentToken } from "@/lib/consent";
import { ConsentConfigurationError, ConsentStorageError } from "@/lib/consent-store";

/**
 * Records the buyer's approval of a soft credit check and returns a
 * short-lived, single-use token stamped with the server's clock. The pipeline
 * refuses to run without one.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  try {
    assertConsentRuntime();
    return NextResponse.json(issueConsentToken(body), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ConsentError) return NextResponse.json({ error: err.userMessage }, { status: 400 });
    if (err instanceof ConsentConfigurationError || err instanceof ConsentStorageError) {
      return NextResponse.json({ error: err.userMessage }, { status: 503 });
    }
    throw err;
  }
}

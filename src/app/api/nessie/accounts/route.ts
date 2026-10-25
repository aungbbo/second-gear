import { NextResponse } from "next/server";
import { readAccountsView } from "@/lib/nessie/actions";
import { NessieError, NESSIE_ERROR_STATUS } from "@/lib/nessie/errors";

/** Current snapshot of the demo customer's accounts, for the Banking tab. */
export async function GET() {
  try {
    return NextResponse.json(await readAccountsView());
  } catch (err) {
    console.error(
      "Nessie accounts read failure",
      err instanceof NessieError ? `${err.name}[${err.kind}]: ${err.message}` : err,
    );
    if (err instanceof NessieError) {
      return NextResponse.json({ error: err.userMessage }, { status: NESSIE_ERROR_STATUS[err.kind] });
    }
    return NextResponse.json({ error: "Couldn't load account data. Try again." }, { status: 500 });
  }
}

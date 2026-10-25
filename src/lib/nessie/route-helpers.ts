import { NextResponse } from "next/server";
import { NessieError, NESSIE_ERROR_STATUS } from "@/lib/nessie/errors";
import type { AccountsView } from "@/lib/nessie/account-view";

/** Shared NessieError → HTTP response mapping for the account write routes. */
export async function handleAccountWrite(label: string, run: () => Promise<AccountsView>) {
  try {
    return NextResponse.json(await run());
  } catch (err) {
    console.error(`Nessie ${label} failure`, err instanceof NessieError ? `${err.name}[${err.kind}]: ${err.message}` : err);
    if (err instanceof NessieError) {
      return NextResponse.json({ error: err.userMessage }, { status: NESSIE_ERROR_STATUS[err.kind] });
    }
    return NextResponse.json({ error: "That didn't go through. Try again." }, { status: 500 });
  }
}

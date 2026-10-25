import { NextRequest, NextResponse } from "next/server";
import { postTransfer } from "@/lib/nessie/actions";
import { handleAccountWrite } from "@/lib/nessie/route-helpers";

/** Transfers from the demo customer's checking account into savings. */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { amount, description } = (body ?? {}) as Record<string, unknown>;
  return handleAccountWrite("transfer", () => postTransfer({ amount, description }));
}

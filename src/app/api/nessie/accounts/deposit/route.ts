import { NextRequest, NextResponse } from "next/server";
import { postDeposit } from "@/lib/nessie/actions";
import { handleAccountWrite } from "@/lib/nessie/route-helpers";

/** Posts a deposit to the demo customer's checking account (live or mock). */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { amount, description } = (body ?? {}) as Record<string, unknown>;
  return handleAccountWrite("deposit", () => postDeposit({ amount, description }));
}

import { NextRequest, NextResponse } from "next/server";
import { postBill } from "@/lib/nessie/actions";
import { handleAccountWrite } from "@/lib/nessie/route-helpers";

/** Posts a recurring bill to the demo customer's checking account. */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { amount, nickname, payee, dayOfMonth } = (body ?? {}) as Record<string, unknown>;
  return handleAccountWrite("bill", () => postBill({ amount, nickname, payee, dayOfMonth }));
}

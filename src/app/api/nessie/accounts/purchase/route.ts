import { NextRequest, NextResponse } from "next/server";
import { postPurchase } from "@/lib/nessie/actions";
import { handleAccountWrite } from "@/lib/nessie/route-helpers";

/** Spends on the demo customer's credit card. */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { amount, description } = (body ?? {}) as Record<string, unknown>;
  return handleAccountWrite("purchase", () => postPurchase({ amount, description }));
}

import { NessieError } from "@/lib/nessie/errors";

export const DEFAULT_NESSIE_BASE_URL = "http://api.nessieisreal.com";

export type NessieConfig =
  | { mode: "mock" }
  | { mode: "live"; apiKey: string; customerId: string; baseUrl: string };

/**
 * Reads the Nessie settings from the environment on every call. The mode
 * must be chosen explicitly — there is no default, so a missing setting can
 * never quietly turn into mock data.
 */
export function getNessieConfig(env: Record<string, string | undefined> = process.env): NessieConfig {
  const mode = env.NESSIE_MODE?.trim().toLowerCase();

  if (mode === "mock") return { mode: "mock" };

  if (mode !== "live") {
    throw new NessieError(
      "config",
      "Cash-flow provider not configured: set NESSIE_MODE=live or NESSIE_MODE=mock.",
    );
  }

  const apiKey = env.NESSIE_API_KEY?.trim();
  const customerId = env.NESSIE_CUSTOMER_ID?.trim();
  const missing = [!apiKey && "NESSIE_API_KEY", !customerId && "NESSIE_CUSTOMER_ID"].filter(Boolean);

  if (missing.length > 0) {
    throw new NessieError("config", `Cash-flow provider not configured: missing ${missing.join(" and ")}.`);
  }

  const baseUrl = (env.NESSIE_BASE_URL?.trim() || DEFAULT_NESSIE_BASE_URL).replace(/\/+$/, "");

  return { mode: "live", apiKey: apiKey!, customerId: customerId!, baseUrl };
}

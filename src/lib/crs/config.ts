import { CrsError } from "@/lib/crs/errors";
import { SANDBOX_PERSONAS, type SandboxPersona } from "@/lib/crs/personas";

export const DEFAULT_CRS_BASE_URL = "https://api-sandbox.stitchcredit.com/api";

export type CrsBureau = "experian" | "transunion" | "equifax";

/** Prequalification (soft-pull) configs the CalHacks sandbox documents for each bureau. */
export const PREQUAL_CONFIGS: Record<CrsBureau, string> = {
  experian: "exp-prequal-vantage4",
  transunion: "tu-prequal-fico9",
  equifax: "efx-prequal-vantage4",
};

export const BUREAU_LABELS: Record<CrsBureau, string> = {
  experian: "Experian",
  transunion: "TransUnion",
  equifax: "Equifax",
};

export interface LiveCrsConfig {
  mode: "live";
  username: string;
  password: string;
  baseUrl: string;
  bureau: CrsBureau;
  configName: string;
  persona: SandboxPersona & { ssn: string };
}

export type CrsConfig = { mode: "mock" } | LiveCrsConfig;

const NOT_CONFIGURED = "Credit provider not configured.";

/**
 * Reads CRS settings from the environment on every call. The mode must be
 * chosen explicitly, so a missing setting can never quietly become mock data.
 */
export function getCrsConfig(env: Record<string, string | undefined> = process.env): CrsConfig {
  const mode = env.CRS_MODE?.trim().toLowerCase();
  if (mode === "mock") return { mode: "mock" };
  if (mode !== "live") {
    throw new CrsError("config", NOT_CONFIGURED, { detail: "set CRS_MODE=live or CRS_MODE=mock" });
  }

  const username = env.CRS_USERNAME?.trim();
  const password = env.CRS_PASSWORD;
  const personaId = env.CRS_TEST_PERSONA?.trim().toUpperCase();
  const ssn = env.CRS_PERSONA_SSN?.trim();
  const missing = [
    !username && "CRS_USERNAME",
    !password && "CRS_PASSWORD",
    !personaId && "CRS_TEST_PERSONA",
    !ssn && "CRS_PERSONA_SSN",
  ].filter(Boolean);
  if (missing.length > 0) throw new CrsError("config", NOT_CONFIGURED, { detail: `missing ${missing.join(", ")}` });

  const persona = SANDBOX_PERSONAS[personaId!];
  if (!persona) {
    throw new CrsError("config", NOT_CONFIGURED, {
      detail: `CRS_TEST_PERSONA must be one of ${Object.keys(SANDBOX_PERSONAS).join(", ")}`,
    });
  }
  if (!/^\d{9}$/.test(ssn!)) throw new CrsError("config", NOT_CONFIGURED, { detail: "CRS_PERSONA_SSN must be 9 digits" });

  const bureau = (env.CRS_BUREAU?.trim().toLowerCase() || "experian") as CrsBureau;
  if (!(bureau in PREQUAL_CONFIGS)) {
    throw new CrsError("config", NOT_CONFIGURED, { detail: "CRS_BUREAU must be experian, transunion, or equifax" });
  }
  const configName = env.CRS_CONFIG?.trim() || PREQUAL_CONFIGS[bureau];
  if (!/^[\w-]+$/.test(configName)) throw new CrsError("config", NOT_CONFIGURED, { detail: "CRS_CONFIG has invalid characters" });

  const baseUrl = (env.CRS_BASE_URL?.trim() || DEFAULT_CRS_BASE_URL).replace(/\/+$/, "");

  return { mode: "live", username: username!, password: password!, baseUrl, bureau, configName, persona: { ...persona, ssn: ssn! } };
}

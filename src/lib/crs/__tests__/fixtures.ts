import { expect } from "vitest";
import type { LiveCrsConfig } from "@/lib/crs/config";
import { SANDBOX_PERSONAS } from "@/lib/crs/personas";
import type { CrsCreditReportResponse } from "@/lib/crs/types";

// Synthetic test values only — not the real sandbox SSN or credentials.
export const SYNTH_SSN = "900112222";
export const SYNTH_USERNAME = "synthetic-user";
export const SYNTH_PASSWORD = "synthetic-p@ss#word";
export const SYNTH_DOB = "1985-03-14";

export function liveConfig(baseUrl: string): LiveCrsConfig {
  return {
    mode: "live",
    username: SYNTH_USERNAME,
    password: SYNTH_PASSWORD,
    baseUrl,
    bureau: "experian",
    configName: "exp-prequal-vantage4",
    persona: { ...SANDBOX_PERSONAS.P05, ssn: SYNTH_SSN },
  };
}

export function liveConfigWith(baseUrl: string, overrides: Partial<Pick<LiveCrsConfig, "bureau" | "configName">>): LiveCrsConfig {
  return { ...liveConfig(baseUrl), ...overrides };
}

/** Identity and account details that must never leave the server. */
export const PII = [
  SYNTH_SSN,
  SYNTH_DOB,
  "RICKY",
  "DALTON",
  "7031 SUNSET RIDGE",
  "ORLANDO",
  "32819",
  "ACCT-SYNTH",
  "SYNTH BANK",
  "REF-SYNTH",
  "FILE-SYNTH",
  "REQ-SYNTH",
];

/** Asserts none of the values appear, reporting only a count so failures never print them. */
export function expectNoLeaks(text: string, values: string[]) {
  const leaked = values.filter((v) => v && text.includes(v)).length;
  expect(leaked, "sensitive values leaked (count)").toBe(0);
}

/**
 * A SYNTHETIC P05-like CRS Standard Format report: the schema follows the
 * CalHacks OpenAPI spec (numbers as strings), the values are invented to match
 * P05's documented profile (540, maxed cards, lates, two collections, recent
 * shopping). It is not a captured sandbox response.
 */
export function syntheticP05Report(): CrsCreditReportResponse & Record<string, unknown> {
  return {
    responseDetail: { dateRequested: "2026-10-24", creditPullType: "Soft", referenceNumber: "REF-SYNTH-0001", fileNumber: "FILE-SYNTH-9" } as never,
    errorMessages: null,
    creditFiles: [
      {
        creditFileDetail: { creditFileResultStatusType: "FileReturned", sourceType: "Experian" },
        aliases: [{ firstName: "RICKY", lastName: "DALTON" }],
        ssns: [{ ssn: SYNTH_SSN }],
        dobs: [{ dob: SYNTH_DOB }],
        addresses: [{ addressLine1: "7031 SUNSET RIDGE RD", city: "ORLANDO", state: "FL", postalCode: "32819" }],
      } as never,
    ],
    scores: [
      {
        modelName: "VantageScore4.0",
        sourceType: "Experian",
        scoreValue: "540",
        scoreMinimumValue: "300",
        scoreMaximumValue: "850",
        scoreFactors: [
          { scoreFactorCode: "68", scoreFactorText: "Proportion of balances to credit limits is too high" },
          { scoreFactorCode: "04", scoreFactorText: "Number of accounts with delinquency" },
          { scoreFactorCode: "08", scoreFactorText: "Too many inquiries last 12 months" },
        ],
      },
    ],
    tradelines: [
      tradeline({ accountType: "Revolving", currentBalanceAmount: "4,950.00", creditLimitAmount: "5000", _30DayLates: "2", _60DayLates: "1", _90DayLates: "1", accountOpenedDate: "2019-06-01" }),
      tradeline({ accountType: "Revolving", currentBalanceAmount: "2940", creditLimitAmount: "3,000.00", _30DayLates: "1", _60DayLates: "0", _90DayLates: "0", accountOpenedDate: "2021-02-10" }),
      tradeline({ accountType: "Installment", currentBalanceAmount: "8200", creditLimitAmount: "", accountOpenedDate: "2022-08-15" }),
      tradeline({ accountType: "Unknown", currentRatingType: "Collection", currentBalanceAmount: "640", accountOpenedDate: "2024-03-01" }),
      tradeline({ accountType: "Unknown", currentRatingType: "Collection", currentBalanceAmount: "310", accountOpenedDate: "2024-11-20" }),
    ],
    inquiries: [
      { inquiryDate: "2026-09-30" },
      { inquiryDate: "2026-09-02" },
      { inquiryDate: "08/15/2026" },
      { inquiryDate: "2026-06-01" },
      { inquiryDate: "2025-12-01" },
    ],
    publicRecords: [],
    summaries: {
      tradeSummary: { revolvingCreditUtilization: "98", oldestTradelineDate: "2019-06-01" },
      derogatorySummary: { collectionsCount: "2", chargeOffsCount: "0", publicRecordsCount: "0", _30DayLates: "3", _60DayLates: "1", _90DayLates: "1" },
    },
  };
}

let accountSeq = 0;
function tradeline(fields: Record<string, string>) {
  accountSeq++;
  return {
    accountStatusType: "Open",
    currentRatingType: "AsAgreed",
    accountIdentifier: `ACCT-SYNTH-${accountSeq}`,
    creditorName: `SYNTH BANK ${accountSeq}`,
    ...fields,
  };
}

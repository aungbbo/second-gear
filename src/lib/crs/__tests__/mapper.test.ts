import { describe, expect, it } from "vitest";
import { mapCrsReport, MAX_FACTORS, num, parseCrsDate } from "@/lib/crs/mapper";
import { CrsError } from "@/lib/crs/errors";
import { expectNoLeaks, PII, syntheticP05Report } from "./fixtures";

const map = (report = syntheticP05Report()) => mapCrsReport(report, { bureau: "experian" });

describe("mapCrsReport — synthetic P05", () => {
  it("maps score 540 to deep subprime and the app's estimated APR band", () => {
    const credit = map();
    expect(credit).toMatchObject({
      score: 540,
      tier: "deep-subprime",
      tierLabel: "Deep subprime",
      scoreRangeLabel: "300–579",
      estimatedApr: { min: 18, max: 24 },
    });
    expect(credit.summary).toContain("Experian soft-pull VantageScore4.0 of 540");
    expect(credit.summary).toContain("our estimate, not a lender offer or approval");
  });

  it("never invents a hard-inquiry count", () => {
    expect(map().hardInquiriesLast6mo).toBeNull();
  });

  it("leads with up to two bureau reason codes, then derived factors, capped", () => {
    const { factors } = map();
    expect(factors).toHaveLength(MAX_FACTORS);
    expect(factors.slice(0, 2).map((f) => f.label)).toEqual(["Bureau score factor", "Bureau score factor"]);
    expect(factors.slice(2).map((f) => f.label)).toEqual([
      "Revolving utilization",
      "Payment history",
      "Collections and charge-offs",
      "Public records",
    ]);
    expect(factors[2]).toMatchObject({ impact: "negative", detail: expect.stringContaining("98%") });
    expect(factors[3]).toMatchObject({ impact: "negative", detail: expect.stringContaining("3 payment(s) 30 days late, 1 60 days late, 1 90+ days late") });
    expect(factors[4]).toMatchObject({ impact: "negative", detail: "2 collection(s) and 0 charge-off(s) on file." });
  });

  it("puts no identity, account, creditor, or request ids in the result", () => {
    expectNoLeaks(JSON.stringify(map()), PII);
  });
});

describe("mapCrsReport — fallbacks and gaps", () => {
  it("derives utilization, lates, and collections from tradelines when summaries are absent", () => {
    const report = syntheticP05Report();
    report.summaries = null;
    report.scores = [{ ...report.scores![0], scoreFactors: [] }];
    const labels = Object.fromEntries(map(report).factors.map((f) => [f.label, f.detail]));
    expect(labels["Revolving utilization"]).toContain("99%"); // (4950 + 2940) / (5000 + 3000)
    expect(labels["Payment history"]).toContain("3 payment(s) 30 days late, 1 60 days late, 1 90+ days late");
    expect(labels["Collections and charge-offs"]).toBe("2 collection(s) and 0 charge-off(s) on file.");
    expect(labels["Credit history length"]).toContain("7 years");
  });

  it("counts inquiries in the last 6 months without calling them hard", () => {
    const report = syntheticP05Report();
    report.scores = [{ ...report.scores![0], scoreFactors: [] }];
    report.summaries = { tradeSummary: {} };
    report.tradelines = [];
    report.publicRecords = null;
    const inquiries = map(report).factors.find((f) => f.label === "Credit inquiries, last 6 months");
    expect(inquiries).toMatchObject({ impact: "negative", detail: expect.stringContaining("4 inquiries in the last 6 months") });
    expect(inquiries?.detail).toContain("doesn't say which were hard pulls");
  });

  it("treats a utilization ratio and a percent the same way", () => {
    const ratio = syntheticP05Report();
    ratio.summaries!.tradeSummary!.revolvingCreditUtilization = "0.98";
    expect(map(ratio).factors.find((f) => f.label === "Revolving utilization")?.detail).toContain("98%");
  });

  it("omits a factor whose data is missing instead of inventing it", () => {
    const report = syntheticP05Report();
    report.summaries = null;
    report.tradelines = [];
    report.inquiries = null;
    report.publicRecords = null;
    report.scores = [{ ...report.scores![0], scoreFactors: [] }];
    expect(map(report).factors).toEqual([]);
  });

  it("throws no_score instead of inventing a score", () => {
    for (const scoreValue of [undefined, "", "N/A", "0"]) {
      const report = syntheticP05Report();
      report.scores = [{ modelName: "VantageScore4.0", scoreValue, noScoreReasonType: "NotScoredInsufficientCredit" }];
      expect(() => map(report)).toThrowError(CrsError);
      try {
        map(report);
      } catch (err) {
        expect((err as CrsError).kind).toBe("no_score");
      }
    }
    const none = syntheticP05Report();
    none.scores = null;
    expect(() => map(none)).toThrowError(/couldn't be scored/);
  });

  it("prefers the borrower's score over a co-borrower's", () => {
    const report = syntheticP05Report();
    report.scores = [
      { borrowerSourceType: "Coborrower", scoreValue: "720" },
      { borrowerSourceType: "Borrower", scoreValue: "540" },
    ];
    expect(map(report).score).toBe(540);
  });
});

describe("parsing helpers", () => {
  it.each([
    ["540", 540],
    ["1,250.00", 1250],
    ["$4,950.00", 4950],
    ["85%", 85],
    [12, 12],
    ["", undefined],
    ["N/A", undefined],
    [null, undefined],
  ])("num(%j) = %j", (input, expected) => {
    expect(num(input)).toBe(expected);
  });

  it("parses both date shapes and rejects others", () => {
    expect(parseCrsDate("2026-09-30")).toBe(Date.UTC(2026, 8, 30));
    expect(parseCrsDate("2026-09-30T10:00:00Z")).toBe(Date.UTC(2026, 8, 30));
    expect(parseCrsDate("08/15/2026")).toBe(Date.UTC(2026, 7, 15));
    expect(parseCrsDate("Aug 15")).toBeUndefined();
  });

  it("uses dateRequested when dateOrdered is absent", () => {
    const report = syntheticP05Report();
    report.responseDetail = { dateRequested: "2026-10-24", creditPullType: "Soft" };
    report.scores = [{ ...report.scores![0], scoreFactors: [] }];
    const credit = mapCrsReport(report, { bureau: "experian", now: Date.UTC(2030, 0, 1) });
    expect(credit.factors.find((factor) => factor.label === "Credit inquiries, last 6 months")?.detail).toContain("4 inquiries");
  });
});

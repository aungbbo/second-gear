import { classify } from "@/lib/crs/classify";
import { BUREAU_LABELS, type CrsBureau } from "@/lib/crs/config";
import { CrsError, scrubCrsDetail } from "@/lib/crs/errors";
import type { CrsCreditReportResponse, CrsScore, CrsTradeline } from "@/lib/crs/types";
import type { CreditFactor, CreditReport } from "@/lib/types";

export const MAX_FACTORS = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

/** CRS sends numbers as strings ("540", "1,250.00", "85%"); anything unparseable is unknown. */
export function num(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[$,%\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined;
  return Number(cleaned);
}

/** Accepts yyyy-MM-dd(…) and MM/dd/yyyy; the spec doesn't fix a date format. */
export function parseCrsDate(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2]);
  return undefined;
}

function chooseScore(scores: CrsScore[]): { value: number; score: CrsScore } {
  const usable = scores
    .map((score) => ({ score, value: num(score.scoreValue) }))
    .filter((s): s is { score: CrsScore; value: number } => s.value !== undefined && s.value > 0)
    .sort((a, b) => Number(a.score.borrowerSourceType === "Coborrower") - Number(b.score.borrowerSourceType === "Coborrower"));
  if (usable.length === 0) {
    const reasons = scores.map((s) => s.noScoreReasonType).filter(Boolean).join(",");
    throw new CrsError("no_score", "Your credit file couldn't be scored.", { detail: `no numeric scoreValue${reasons ? `; ${reasons}` : ""}` });
  }
  return usable[0];
}

const sum = (values: (number | undefined)[]) => values.reduce<number>((total, v) => total + (v ?? 0), 0);
const isOpen = (t: CrsTradeline) => !t.accountStatusType || t.accountStatusType === "Open";

function utilizationFactor(report: CrsCreditReportResponse, tradelines: CrsTradeline[]): CreditFactor | null {
  const percent = revolvingUtilizationPercent(report, tradelines);
  if (percent === undefined) return null;
  const rounded = Math.round(percent);
  return {
    label: "Revolving utilization",
    impact: rounded > 30 ? "negative" : rounded < 10 ? "positive" : "neutral",
    detail: `Using ${rounded}% of available revolving credit — lenders prefer under 30%.`,
  };
}

function revolvingUtilizationPercent(report: CrsCreditReportResponse, tradelines: CrsTradeline[]): number | undefined {
  const reported = num(report.summaries?.tradeSummary?.revolvingCreditUtilization);
  if (reported !== undefined) return reported <= 1.5 ? reported * 100 : reported;
  const revolving = tradelines.filter((t) => t.accountType === "Revolving" && isOpen(t));
  const limit = sum(revolving.map((t) => num(t.creditLimitAmount)));
  return limit > 0 ? (sum(revolving.map((t) => num(t.currentBalanceAmount))) / limit) * 100 : undefined;
}

function recentInquiryCount(report: CrsCreditReportResponse, asOf: number): number | undefined {
  if (!report.inquiries) return undefined;
  const sixMonthsAgo = asOf - 183 * DAY_MS;
  return report.inquiries.filter((inquiry) => {
    const date = parseCrsDate(inquiry.inquiryDate);
    return date !== undefined && date >= sixMonthsAgo && date <= asOf + DAY_MS;
  }).length;
}

function paymentHistoryFactor(report: CrsCreditReportResponse, tradelines: CrsTradeline[]): CreditFactor | null {
  const derog = report.summaries?.derogatorySummary;
  const fromSummary = [num(derog?._30DayLates), num(derog?._60DayLates), num(derog?._90DayLates)];
  const lates =
    fromSummary.some((v) => v !== undefined)
      ? fromSummary
      : [
          sum(tradelines.map((t) => num(t._30DayLates))),
          sum(tradelines.map((t) => num(t._60DayLates))),
          sum(tradelines.map((t) => num(t._90DayLates))) + sum(tradelines.map((t) => num(t._120DayLates))),
        ];
  const onTime = report.summaries?.offersIQSummary?.onTimePaymentPercentage;
  if (tradelines.length === 0 && fromSummary.every((v) => v === undefined) && typeof onTime !== "number") return null;
  const [l30, l60, l90] = lates.map((v) => v ?? 0);
  const total = l30 + l60 + l90;
  const onTimeText = typeof onTime === "number" && Number.isFinite(onTime) ? ` ${Math.round(onTime <= 1 ? onTime * 100 : onTime)}% of payments on time.` : "";
  return {
    label: "Payment history",
    impact: total > 0 ? "negative" : "positive",
    detail:
      total > 0
        ? `${l30} payment(s) 30 days late, ${l60} 60 days late, ${l90} 90+ days late.${onTimeText}`
        : `No late payments reported.${onTimeText}`,
  };
}

function collectionsFactor(report: CrsCreditReportResponse, tradelines: CrsTradeline[]): CreditFactor | null {
  const derog = report.summaries?.derogatorySummary;
  let collections = num(derog?.collectionsCount);
  let chargeOffs = num(derog?.chargeOffsCount);
  if (collections === undefined && chargeOffs === undefined) {
    if (tradelines.length === 0) return null;
    collections = tradelines.filter((t) => t.currentRatingType === "Collection" || t.currentRatingType === "CollectionOrChargeOff").length;
    chargeOffs = tradelines.filter((t) => t.currentRatingType === "ChargeOff").length;
  }
  const c = collections ?? 0;
  const co = chargeOffs ?? 0;
  return {
    label: "Collections and charge-offs",
    impact: c + co > 0 ? "negative" : "neutral",
    detail: c + co > 0 ? `${c} collection(s) and ${co} charge-off(s) on file.` : "No collections or charge-offs reporting.",
  };
}

function publicRecordsFactor(report: CrsCreditReportResponse): CreditFactor | null {
  const records = report.publicRecords ?? [];
  const count = records.length > 0 ? records.length : num(report.summaries?.derogatorySummary?.publicRecordsCount);
  if (count === undefined) return null;
  if (count === 0) return { label: "Public records", impact: "neutral", detail: "No bankruptcies, liens, or judgments reporting." };
  const types = [...new Set(records.map((r) => r.publicRecordType).filter(Boolean))].join(", ");
  return { label: "Public records", impact: "negative", detail: `${count} public record(s)${types ? `: ${types}` : ""}.` };
}

function inquiriesFactor(report: CrsCreditReportResponse, asOf: number): CreditFactor | null {
  const recent = recentInquiryCount(report, asOf);
  if (recent === undefined) return null;
  return {
    label: "Credit inquiries, last 6 months",
    impact: recent >= 3 ? "negative" : "neutral",
    // The report doesn't mark inquiries hard or soft, so none are counted as hard.
    detail: `${recent} inquir${recent === 1 ? "y" : "ies"} in the last 6 months (the report doesn't say which were hard pulls).`,
  };
}

function historyFactor(report: CrsCreditReportResponse, tradelines: CrsTradeline[], asOf: number): CreditFactor | null {
  const oldest =
    parseCrsDate(report.summaries?.tradeSummary?.oldestTradelineDate) ??
    tradelines.map((t) => parseCrsDate(t.accountOpenedDate)).filter((v): v is number => v !== undefined).sort((a, b) => a - b)[0];
  if (oldest === undefined) return null;
  const years = Math.max(0, Math.floor((asOf - oldest) / (365.25 * DAY_MS)));
  return {
    label: "Credit history length",
    impact: years >= 7 ? "positive" : "neutral",
    detail: `Oldest account opened about ${years} year${years === 1 ? "" : "s"} ago.`,
  };
}

function mixFactor(tradelines: CrsTradeline[]): CreditFactor | null {
  const open = tradelines.filter(isOpen);
  if (open.length === 0) return null;
  const count = (type: string) => open.filter((t) => t.accountType === type).length;
  const revolving = count("Revolving");
  const installment = count("Installment");
  const mortgage = count("Mortgage");
  const kinds = [revolving, installment, mortgage].filter((n) => n > 0).length;
  return {
    label: "Account mix",
    impact: kinds >= 2 ? "positive" : "neutral",
    detail: `${open.length} open account(s): ${revolving} revolving, ${installment} installment, ${mortgage} mortgage.`,
  };
}

/**
 * Maps a checked CRS Standard Format report (see checkReportOutcome) into the
 * pipeline's CreditReport. Pure. Reads identity, creditor, and account fields
 * only to compute aggregates — none of them are copied into the result.
 */
export function mapCrsReport(
  report: CrsCreditReportResponse,
  context: { bureau: CrsBureau; now?: number },
): CreditReport {
  const scores = report.scores ?? [];
  const { value: score, score: chosen } = chooseScore(scores);
  const { tier, tierLabel, scoreRangeLabel, aprMin, aprMax } = classify(score);

  const tradelines = report.tradelines ?? [];
  const asOf =
    parseCrsDate(report.responseDetail?.dateOrdered) ??
    parseCrsDate(report.responseDetail?.dateRequested) ??
    context.now ??
    Date.now();
  const tradeSummary = report.summaries?.tradeSummary;
  const derogatorySummary = report.summaries?.derogatorySummary;
  const reportedThirtyDayLates = num(derogatorySummary?._30DayLates);
  const reportedSixtyDayLates = num(derogatorySummary?._60DayLates);
  const reportedNinetyDayLates = num(derogatorySummary?._90DayLates);
  const hasLatePaymentData =
    reportedThirtyDayLates !== undefined ||
    reportedSixtyDayLates !== undefined ||
    reportedNinetyDayLates !== undefined ||
    tradelines.length > 0;
  const collectionsFromTradelines = tradelines.filter((line) =>
    line.currentRatingType === "Collection" || line.currentRatingType === "CollectionOrChargeOff",
  ).length;
  const chargeOffsFromTradelines = tradelines.filter((line) => line.currentRatingType === "ChargeOff").length;
  const insights = {
    bureau: BUREAU_LABELS[context.bureau],
    scoreModel: chosen.modelName?.trim() || "Credit score model",
    scorePercentile: num(chosen.scoreRankPercentileValue),
    reportDate: Number.isFinite(asOf) ? new Date(asOf).toISOString().slice(0, 10) : undefined,
    revolvingUtilizationPercent: revolvingUtilizationPercent(report, tradelines),
    accountCount: num(tradeSummary?.tradesCount) ?? (tradelines.length || undefined),
    latePayments: hasLatePaymentData
      ? {
          thirtyDays: reportedThirtyDayLates ?? sum(tradelines.map((t) => num(t._30DayLates))),
          sixtyDays: reportedSixtyDayLates ?? sum(tradelines.map((t) => num(t._60DayLates))),
          ninetyPlusDays: (reportedNinetyDayLates ?? sum(tradelines.map((t) => num(t._90DayLates)))) + sum(tradelines.map((t) => num(t._120DayLates))),
        }
      : undefined,
    collections: num(derogatorySummary?.collectionsCount) ?? (tradelines.length ? collectionsFromTradelines : undefined),
    chargeOffs: num(derogatorySummary?.chargeOffsCount) ?? (tradelines.length ? chargeOffsFromTradelines : undefined),
    publicRecords: num(derogatorySummary?.publicRecordsCount) ?? (report.publicRecords ? report.publicRecords.length : undefined),
    pastDueBalance: num(tradeSummary?.pastDueTotal) ?? (tradelines.length ? sum(tradelines.map((t) => num(t.pastDueAmount))) : undefined),
    inquiriesLast6Months: recentInquiryCount(report, asOf),
    creditHistoryYears: (() => {
      const oldest = parseCrsDate(tradeSummary?.oldestTradelineDate) ??
        tradelines.map((t) => parseCrsDate(t.accountOpenedDate)).filter((date): date is number => date !== undefined).sort((a, b) => a - b)[0];
      return oldest === undefined ? undefined : Math.max(0, Math.floor((asOf - oldest) / (365.25 * DAY_MS)));
    })(),
  };

  const bureauScoreFactors = (chosen.scoreFactors ?? [])
    .map((f) => f?.scoreFactorText?.trim())
    .filter((text): text is string => Boolean(text))
    .slice(0, MAX_FACTORS)
    .map(scrubCrsDetail);
  const bureauFactors: CreditFactor[] = bureauScoreFactors
    .map((text) => ({ label: "Bureau score factor", impact: "negative", detail: scrubCrsDetail(text) }));

  const derived = [
    utilizationFactor(report, tradelines),
    paymentHistoryFactor(report, tradelines),
    collectionsFactor(report, tradelines),
    publicRecordsFactor(report),
    inquiriesFactor(report, asOf),
    historyFactor(report, tradelines, asOf),
    mixFactor(tradelines),
  ].filter((f): f is CreditFactor => f !== null);

  const model = chosen.modelName?.trim() || "credit score";
  return {
    score,
    tier,
    tierLabel,
    scoreRangeLabel,
    factors: [...bureauFactors, ...derived].slice(0, MAX_FACTORS),
    bureauScoreFactors,
    insights,
    estimatedApr: { min: aprMin, max: aprMax },
    hardInquiriesLast6mo: null,
    summary: `${BUREAU_LABELS[context.bureau]} soft-pull ${scrubCrsDetail(model)} of ${score} puts you in ${tierLabel.toLowerCase()} territory. For this score band, Second Gear estimates auto loans at ${aprMin}% to ${aprMax}% APR — our estimate, not a lender offer or approval.`,
  };
}

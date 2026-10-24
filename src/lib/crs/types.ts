/**
 * Subsets of the CRS Standard Format response (CalHacks sandbox OpenAPI v1,
 * `com.crstech.mware.crs_standard_format.models.*`). Only fields the app reads
 * are typed. The spec types nearly every number as a string, so they are
 * strings here and parsed defensively by the mapper.
 */

export interface CrsErrorMessage {
  creditErrorMessageCode?: string;
  creditErrorMessageSourceType?: string;
  creditErrorMessageText?: string;
}

export interface CrsResponseDetail {
  dateOrdered?: string;
  dateRequested?: string;
  creditPullType?: string; // "Soft" | "Hard"
}

export interface CrsCreditFile {
  creditFileDetail?: { creditFileResultStatusType?: string; sourceType?: string };
}

export interface CrsScore {
  borrowerSourceType?: string;
  modelName?: string;
  sourceType?: string;
  noScoreReasonType?: string;
  scoreValue?: string;
  scoreMinimumValue?: string;
  scoreMaximumValue?: string;
  scoreFactors?: { scoreFactorCode?: string; scoreFactorText?: string }[];
}

export interface CrsTradeline {
  accountType?: string; // CreditLine | Installment | Mortgage | Open | Revolving | Unknown
  accountStatusType?: string; // Closed | Frozen | Open | Paid | Refinanced | Transferred
  accountOpenedDate?: string;
  currentBalanceAmount?: string;
  creditLimitAmount?: string;
  highBalanceAmount?: string;
  pastDueAmount?: string;
  currentRatingType?: string;
  _30DayLates?: string;
  _60DayLates?: string;
  _90DayLates?: string;
  _120DayLates?: string;
}

export interface CrsInquiry {
  inquiryDate?: string;
}

export interface CrsPublicRecord {
  publicRecordType?: string;
}

export interface CrsSummaries {
  tradeSummary?: {
    revolvingCreditUtilization?: string;
    oldestTradelineDate?: string;
  };
  derogatorySummary?: {
    collectionsCount?: string;
    chargeOffsCount?: string;
    publicRecordsCount?: string;
    _30DayLates?: string;
    _60DayLates?: string;
    _90DayLates?: string;
  };
  offersIQSummary?: {
    onTimePaymentPercentage?: number;
  };
}

export interface CrsCreditReportResponse {
  responseDetail?: CrsResponseDetail;
  errorMessages?: CrsErrorMessage[] | null;
  creditFiles?: CrsCreditFile[] | null;
  tradelines?: CrsTradeline[] | null;
  scores?: CrsScore[] | null;
  inquiries?: CrsInquiry[] | null;
  publicRecords?: CrsPublicRecord[] | null;
  summaries?: CrsSummaries | null;
}

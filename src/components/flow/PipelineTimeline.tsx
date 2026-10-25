"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { Eyebrow } from "@/components/ui/Eyebrow";
import type { BuyerNeed, PipelineResult } from "@/lib/types";

interface PipelineTimelineProps {
  need: BuyerNeed;
  /** Server-issued, single-use soft-pull consent token from the consent step. */
  consentToken: string;
  onComplete: (result: PipelineResult) => void;
  onError: (message: string) => void;
}

const STEP_DEFS = [
  {
    label: "Reviewing credit information",
    provider: "CRS",
    whatItDoes: "Checks your credit range and debt profile.",
    working: "Pulling your soft-pull credit factors…",
  },
  {
    label: "Analyzing cash flow and affordability",
    provider: "Nessie",
    whatItDoes: "Reads your income, bills, and spending.",
    working: "Matching bank activity to a safe payment…",
  },
  {
    label: "Searching vehicle listings",
    provider: "Apify",
    whatItDoes: "Scans public inventory near you.",
    working: "Scanning public inventory near you…",
  },
  {
    label: "Comparing loan and ownership costs",
    provider: "Calculator",
    whatItDoes: "Runs amortization across loan terms.",
    working: "Running amortization across loan terms…",
  },
  {
    label: "Ranking and explaining results",
    provider: "Bitdeer AI",
    whatItDoes: "Ranks the cars against your budget, credit profile, and preferences, then explains the tradeoffs.",
    working: "Comparing the returned cars against your budget and credit profile…",
  },
];

type Status = "pending" | "active" | "done";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function PipelineTimeline({ need, consentToken, onComplete, onError }: PipelineTimelineProps) {
  const [status, setStatus] = useState<Status[]>(Array(5).fill("pending"));
  const [notes, setNotes] = useState<(string | null)[]>(Array(5).fill(null));
  const startedRef = useRef(false);

  useEffect(() => {
    // Guards against React Strict Mode's dev-only mount→cleanup→mount cycle
    // firing this twice. The run below is intentionally not abortable on
    // cleanup: it's a one-shot sequence meant to finish once started.
    if (startedRef.current) return;
    startedRef.current = true;

    const setOne = (i: number, s: Status, note?: string) => {
      setStatus((prev) => prev.map((v, idx) => (idx === i ? s : v)));
      if (note !== undefined) {
        setNotes((prev) => prev.map((v, idx) => (idx === i ? note : v)));
      }
    };

    async function run() {
      const resultPromise = fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ need, consentToken }),
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "The pipeline hit a snag.");
        }
        return (await res.json()) as PipelineResult;
      });

      // The pipeline endpoint returns one completed response, so these early
      // steps are a short visual sequence. Keep the AI step active while the
      // slower upstream work (including ranking) finishes.
      for (let i = 0; i < 3; i++) {
        setOne(i, "active");
        await sleep(700);
        setOne(i, "done", `${STEP_DEFS[i].label} complete.`);
      }

      setOne(3, "active");
      await sleep(200);
      setOne(3, "done", "Payment and ownership cost estimates calculated.");
      setOne(4, "active");

      let data: PipelineResult;
      try {
        data = await resultPromise;
      } catch (err) {
        onError(err instanceof Error ? err.message : "The pipeline hit a snag.");
        return;
      }

      const realNotes = [
        `Score ${data.credit.score} · ${data.credit.tierLabel} · avg. used-car APR ${data.credit.estimatedApr.min === data.credit.estimatedApr.max ? `${data.credit.estimatedApr.min.toFixed(2)}%` : `${data.credit.estimatedApr.min.toFixed(2)}–${data.credit.estimatedApr.max.toFixed(2)}%`} (estimate)`,
        `Safe ceiling $${data.affordability.recommendedPayment}/mo, read from real cash flow`,
        `${data.listings.length} live listings found near ${need.zip}`,
        `${data.listings.length} cars priced across 4 loan terms each`,
        `Top pick: ${data.rankedCars[0]?.listing.year} ${data.rankedCars[0]?.listing.make} ${data.rankedCars[0]?.listing.model}`,
      ];

      for (let i = 0; i < 5; i++) {
        setOne(i, "done", realNotes[i]);
        await sleep(120);
      }

      await sleep(700);
      onComplete(data);
    }

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doneCount = status.filter((s) => s === "done").length;
  const percent = Math.round((doneCount / STEP_DEFS.length) * 100);

  return (
    <div className="max-w-2xl mx-auto text-center">
      <span className="mx-auto w-16 h-16 rounded-full bg-teal-paper flex items-center justify-center">
        <Sparkles className="w-7 h-7 text-teal" />
      </span>
      <div className="mt-4 flex justify-center">
        <Eyebrow icon={<Sparkles className="w-3.5 h-3.5" />}>Transparent analysis</Eyebrow>
      </div>
      <h1 className="font-display font-extrabold text-[2rem] sm:text-[2.5rem] leading-tight mt-2">
        Here is how your plan is built.
      </h1>

      <div className="mt-8 flex items-center justify-between text-sm font-medium">
        <span>{percent === 100 ? "Analysis complete" : "Analyzing…"}</span>
        <span className="tabular">{percent}%</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-paper-high overflow-hidden">
        <div className="h-full bg-teal transition-all duration-500" style={{ width: `${percent}%` }} />
      </div>

      <div className="mt-6 space-y-3 text-left">
        {STEP_DEFS.map((def, i) => (
          <div key={def.label} className="bg-card border border-line rounded-2xl p-5">
            <div className="flex items-center gap-4">
              <div
                className={`shrink-0 w-7 h-7 rounded-full border flex items-center justify-center transition-colors duration-300 ${
                  status[i] === "done"
                    ? "bg-teal border-teal text-cream"
                    : status[i] === "active"
                      ? "bg-paper border-gold text-gold-deep"
                      : "bg-paper border-line text-ink-soft"
                }`}
              >
                {status[i] === "done" ? (
                  <Check className="w-4 h-4" />
                ) : status[i] === "active" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <span className="font-display text-xs">{i + 1}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[0.95rem]">{def.label}</p>
                <p className="text-xs text-ink-soft mt-0.5">{def.provider}</p>
              </div>
              <span className={`text-xs font-medium shrink-0 ${status[i] === "done" ? "text-teal" : "text-ink-soft"}`}>
                {status[i] === "done" ? "Complete" : status[i] === "active" ? "Working…" : "Pending"}
              </span>
            </div>
            {status[i] !== "pending" && (
              <div className="mt-3 pl-11 grid sm:grid-cols-2 gap-3">
                <div className="bg-teal-paper/60 rounded-xl p-3">
                  <p className="text-xs font-semibold text-teal-deep">What it does</p>
                  <p className="text-xs text-ink-soft mt-0.5">{def.whatItDoes}</p>
                </div>
                <div className="bg-teal-paper/60 rounded-xl p-3">
                  <p className="text-xs font-semibold text-teal-deep">Finding</p>
                  <p className="text-xs text-ink-soft mt-0.5 min-h-[1.5em]">
                    {status[i] === "done" && notes[i] ? notes[i] : def.working}
                  </p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

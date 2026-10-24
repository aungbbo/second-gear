"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { BuyerNeed, PipelineResult } from "@/lib/types";

interface PipelineTimelineProps {
  need: BuyerNeed;
  /** Server-issued, single-use soft-pull consent token from the consent step. */
  consentToken: string;
  onComplete: (result: PipelineResult) => void;
  onError: (message: string) => void;
}

const STEP_DEFS = [
  { label: "Reading your credit report", working: "Pulling your soft-pull credit factors…" },
  { label: "Sizing up what you can afford", working: "Matching bank activity to a safe payment…" },
  { label: "Searching live listings", working: "Scanning public inventory near you…" },
  { label: "Pricing every loan option", working: "Running amortization across loan terms…" },
  { label: "Ranking and writing it up", working: "Weighing cost, risk, and fit…" },
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

      for (let i = 0; i < 4; i++) {
        setOne(i, "active");
        await sleep(620);
      }

      let data: PipelineResult;
      try {
        data = await resultPromise;
      } catch (err) {
        onError(err instanceof Error ? err.message : "The pipeline hit a snag.");
        return;
      }

      const realNotes = [
        `Score ${data.credit.score} · ${data.credit.tierLabel} · est. APR ${data.credit.estimatedApr.min}–${data.credit.estimatedApr.max}% (our estimate)`,
        `Safe ceiling $${data.affordability.recommendedPayment}/mo, read from real cash flow`,
        `${data.listings.length} live listings found near ${need.zip}`,
        `${data.listings.length} cars priced across 4 loan terms each`,
        `Top pick: ${data.rankedCars[0]?.listing.year} ${data.rankedCars[0]?.listing.make} ${data.rankedCars[0]?.listing.model}`,
      ];

      for (let i = 0; i < 5; i++) {
        setOne(i, "done", realNotes[i]);
        await sleep(200);
      }

      await sleep(700);
      onComplete(data);
    }

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-xl">
      <h1 className="font-display text-[2rem] sm:text-[2.4rem] leading-tight">Working on it.</h1>
      <p className="mt-3 text-ink-soft">Five steps, no further input needed. This usually takes a few seconds.</p>

      <ol className="mt-12 relative">
        <div className="absolute left-[15px] top-2 bottom-2 w-px bg-line" aria-hidden="true" />
        {STEP_DEFS.map((def, i) => (
          <li key={def.label} className="relative flex gap-6 pb-9 last:pb-0">
            <div
              className={`relative z-10 shrink-0 w-8 h-8 rounded-full border flex items-center justify-center transition-colors duration-300 ${
                status[i] === "done"
                  ? "bg-moss border-moss text-cream"
                  : status[i] === "active"
                    ? "bg-paper border-gold text-gold-deep"
                    : "bg-paper border-line text-ink-soft"
              }`}
            >
              {status[i] === "done" ? (
                <Check className="w-4 h-4" />
              ) : status[i] === "active" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <span className="font-display text-sm">{i + 1}</span>
              )}
            </div>
            <div className="pt-0.5">
              <h3 className={`font-medium text-[1.05rem] ${status[i] === "pending" ? "text-ink-soft" : "text-ink"}`}>
                {def.label}
              </h3>
              <p className="mt-1 text-sm text-ink-soft leading-relaxed min-h-[1.25rem]">
                {status[i] === "done" && notes[i] ? notes[i] : status[i] === "active" ? def.working : " "}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

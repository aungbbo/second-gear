"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

const NEED_OPTIONS = [
  "a reliable car to commute",
  "a car for a new job",
  "a family car that won't break down",
  "a first car for my kid",
  "a car to replace one that just died",
];

const TIMEFRAME_OPTIONS: { label: string; weeks: number }[] = [
  { label: "2 weeks", weeks: 2 },
  { label: "a month", weeks: 4 },
  { label: "6 weeks", weeks: 6 },
  { label: "2 months", weeks: 8 },
];

export function HeroIntake() {
  const router = useRouter();
  const [need, setNeed] = useState(NEED_OPTIONS[0]);
  const [budget, setBudget] = useState(400);
  const [timeframe, setTimeframe] = useState(TIMEFRAME_OPTIONS[1]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams({
      desc: need,
      budget: String(budget),
      weeks: String(timeframe.weeks),
    });
    router.push(`/start?${params.toString()}`);
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl">
      <p className="font-display text-[1.55rem] sm:text-[2.6rem] leading-[1.3] sm:leading-[1.25] text-ink">
        I need{" "}
        <span className="relative inline-block max-w-[13ch] sm:max-w-none align-bottom">
          <select
            value={need}
            onChange={(e) => setNeed(e.target.value)}
            className="appearance-none bg-transparent border-b-2 border-gold pb-0.5 pr-7 cursor-pointer focus:outline-none w-full truncate"
          >
            {NEED_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          <ChevronDown className="w-5 h-5 absolute right-0.5 top-1/2 -translate-y-1/2 pointer-events-none text-ink-soft" />
        </span>
        , under{" "}
        <span className="relative inline-block border-b-2 border-gold pb-0.5">
          <span className="pl-0.5">$</span>
          <input
            type="number"
            min={100}
            max={2000}
            step={10}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            className="bg-transparent w-[4.5ch] focus:outline-none tabular"
          />
        </span>{" "}
        a month, ready within{" "}
        <span className="relative inline-block">
          <select
            value={timeframe.label}
            onChange={(e) =>
              setTimeframe(TIMEFRAME_OPTIONS.find((t) => t.label === e.target.value) ?? TIMEFRAME_OPTIONS[1])
            }
            className="appearance-none bg-transparent border-b-2 border-gold pb-0.5 pr-7 cursor-pointer focus:outline-none"
          >
            {TIMEFRAME_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.label}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="w-5 h-5 absolute right-0.5 top-1/2 -translate-y-1/2 pointer-events-none text-ink-soft" />
        </span>
        .
      </p>

      <button
        type="submit"
        className="mt-9 inline-flex items-center gap-2.5 bg-ink text-cream px-7 py-3.5 text-base font-medium hover:bg-gold-deep transition-colors duration-150"
      >
        Find out what fits
      </button>
      <p className="mt-3 text-sm text-ink-soft">
        No login. A soft credit check happens later, only with your say-so.
      </p>
    </form>
  );
}

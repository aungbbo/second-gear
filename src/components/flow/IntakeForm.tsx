"use client";

import { useState } from "react";
import { Car, Compass } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { PillOption } from "@/components/ui/PillOption";
import { Slider } from "@/components/ui/Slider";
import type { BuyerNeed } from "@/lib/types";

interface IntakeFormProps {
  initial: BuyerNeed;
  onSubmit: (need: BuyerNeed) => void;
}

const CAR_TYPES = ["Sedan", "SUV", "Hatchback", "No preference"] as const;
const TIMEFRAMES: { label: string; weeks: number }[] = [
  { label: "Within 2 weeks", weeks: 2 },
  { label: "Within 1 month", weeks: 4 },
  { label: "Within 3 months", weeks: 12 },
  { label: "Flexible", weeks: 8 },
];
const COMMUTES = ["Under 10 miles", "10–25 miles", "25–50 miles", "50+ miles"];
const PRIORITIES = [
  "Best deal first",
  "Price: low to high",
  "Price: high to low",
  "Mileage: low to high",
  "Year: newest first",
  "Distance: nearest first",
];
const PRIORITY_SORT: Record<(typeof PRIORITIES)[number], NonNullable<BuyerNeed["searchSortBy"]>> = {
  "Best deal first": "deal_score",
  "Price: low to high": "price_asc",
  "Price: high to low": "price_desc",
  "Mileage: low to high": "mileage_asc",
  "Year: newest first": "year_desc",
  "Distance: nearest first": "distance",
};

export function IntakeForm({ initial, onSubmit }: IntakeFormProps) {
  const [budget, setBudget] = useState(initial.maxMonthlyPayment);
  const [carType, setCarType] = useState<(typeof CAR_TYPES)[number]>("Sedan");
  const [timeframe, setTimeframe] = useState(TIMEFRAMES[1]);
  const [commute, setCommute] = useState(COMMUTES[1]);
  const [priority, setPriority] = useState(PRIORITIES[0]);
  // Keep the editable text separate from its numeric value so users can clear
  // the field while replacing the default.
  const [downPayment, setDownPayment] = useState(String(initial.downPayment));
  const [zip, setZip] = useState(initial.zip);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const carPhrase = carType === "No preference" ? "a reliable car" : `a reliable ${carType.toLowerCase()}`;
    onSubmit({
      description: `${carPhrase} for a ${commute.toLowerCase()} commute, prioritizing ${priority.toLowerCase()}.`,
      maxMonthlyPayment: budget,
      timeframeWeeks: timeframe.weeks,
      downPayment: Number(downPayment) || 0,
      zip,
      searchSortBy: PRIORITY_SORT[priority],
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
      <div className="text-center">
        <Eyebrow icon={<Compass className="w-3.5 h-3.5" />}>Start with what you need</Eyebrow>
        <h1 className="font-display font-extrabold text-[2.25rem] sm:text-[2.75rem] leading-tight mt-3">
          Find a car that fits
          <br />
          <span className="font-accent text-teal text-[2.5rem] sm:text-[3rem] leading-tight">your budget</span>
        </h1>
        <p className="mt-3 text-ink-soft">Set a starting point. Second Gear will check the loan and the full cost of ownership.</p>
      </div>

      <div className="mt-8 bg-card border border-line rounded-2xl p-6 sm:p-8 space-y-8">
        <Slider
          label="Monthly total cost target"
          value={budget}
          min={100}
          max={2000}
          step={10}
          onChange={setBudget}
          formatValue={(v) => `$${v}`}
          hint="We also check insurance, fuel, and maintenance."
        />

        <div>
          <p className="text-sm font-medium mb-3">What kind of car feels right?</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {CAR_TYPES.map((type) => (
              <PillOption
                key={type}
                label={type}
                selected={carType === type}
                onClick={() => setCarType(type)}
                icon={<Car className="w-5 h-5" />}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium mb-3">When do you need your car?</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {TIMEFRAMES.map((tf) => (
              <PillOption key={tf.label} label={tf.label} selected={timeframe.label === tf.label} onClick={() => setTimeframe(tf)} />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5">
          <label className="block">
            <span className="text-sm font-medium">Daily commute</span>
            <div className="mt-2 border border-line rounded-xl px-4 py-3 focus-within:border-teal">
              <select value={commute} onChange={(e) => setCommute(e.target.value)} className="w-full bg-transparent focus:outline-none">
                {COMMUTES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Top priority</span>
            <div className="mt-2 border border-line rounded-xl px-4 py-3 focus-within:border-teal">
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full bg-transparent focus:outline-none">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-5 pt-6 border-t border-line">
          <label className="block">
            <span className="text-sm font-medium">Cash for a down payment</span>
            <div className="mt-2 flex items-center border border-line rounded-xl px-4 py-3 focus-within:border-teal">
              <span className="text-ink-soft mr-1">$</span>
              <input
                type="number"
                min={0}
                max={20000}
                step={50}
                value={downPayment}
                onChange={(e) => setDownPayment(e.target.value)}
                className="w-full bg-transparent focus:outline-none tabular"
              />
            </div>
            <span className="text-xs text-ink-soft mt-1 block">Optional — 0 is fine.</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">ZIP code</span>
            <div className="mt-2 border border-line rounded-xl px-4 py-3 focus-within:border-teal">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{5}"
                required
                value={zip}
                onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
                placeholder="43215"
                className="w-full bg-transparent focus:outline-none tabular"
              />
            </div>
            <span className="text-xs text-ink-soft mt-1 block">For listings near you.</span>
          </label>
        </div>

        <Button type="submit" size="lg" className="w-full justify-center">
          Build my plan →
        </Button>
        <p className="text-center text-xs text-ink-soft">No impact to your credit. You control every step.</p>
      </div>
    </form>
  );
}

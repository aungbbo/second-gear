"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { BuyerNeed } from "@/lib/types";

interface IntakeFormProps {
  initial: BuyerNeed;
  onSubmit: (need: BuyerNeed) => void;
}

export function IntakeForm({ initial, onSubmit }: IntakeFormProps) {
  const [need, setNeed] = useState<BuyerNeed>(initial);

  function update<K extends keyof BuyerNeed>(key: K, value: BuyerNeed[K]) {
    setNeed((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(need);
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl">
      <h1 className="font-display text-[2rem] sm:text-[2.4rem] leading-tight">What are we solving for?</h1>
      <p className="mt-3 text-ink-soft">
        A couple of details, then we&apos;ll ask you to approve a soft credit check before anything runs.
      </p>

      <div className="mt-10 space-y-7">
        <label className="block">
          <span className="text-sm font-medium">What you need a car for</span>
          <textarea
            required
            value={need.description}
            onChange={(e) => update("description", e.target.value)}
            rows={2}
            maxLength={200}
            placeholder="A reliable car to commute, nothing fancy."
            className="mt-2 w-full bg-paper-raised/60 border border-line px-4 py-3 text-[0.98rem] focus:outline-none focus:border-ink/60 resize-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-5">
          <label className="block">
            <span className="text-sm font-medium">Most you can pay monthly</span>
            <div className="mt-2 flex items-center border border-line bg-paper-raised/60 px-4 py-3 focus-within:border-ink/60">
              <span className="text-ink-soft mr-1">$</span>
              <input
                type="number"
                required
                min={100}
                max={2000}
                step={10}
                value={need.maxMonthlyPayment}
                onChange={(e) => update("maxMonthlyPayment", Number(e.target.value))}
                className="w-full bg-transparent focus:outline-none tabular"
              />
              <span className="text-ink-soft ml-1 text-sm">/mo</span>
            </div>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Ready to buy within</span>
            <div className="mt-2 border border-line bg-paper-raised/60 px-4 py-3 focus-within:border-ink/60">
              <select
                value={need.timeframeWeeks}
                onChange={(e) => update("timeframeWeeks", Number(e.target.value))}
                className="w-full bg-transparent focus:outline-none"
              >
                <option value={2}>2 weeks</option>
                <option value={4}>a month</option>
                <option value={6}>6 weeks</option>
                <option value={8}>2 months</option>
              </select>
            </div>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-5">
          <label className="block">
            <span className="text-sm font-medium">Cash for a down payment</span>
            <div className="mt-2 flex items-center border border-line bg-paper-raised/60 px-4 py-3 focus-within:border-ink/60">
              <span className="text-ink-soft mr-1">$</span>
              <input
                type="number"
                min={0}
                max={20000}
                step={50}
                value={need.downPayment}
                onChange={(e) => update("downPayment", Number(e.target.value))}
                className="w-full bg-transparent focus:outline-none tabular"
              />
            </div>
            <span className="text-xs text-ink-soft mt-1 block">Optional — 0 is fine.</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium">ZIP code</span>
            <div className="mt-2 border border-line bg-paper-raised/60 px-4 py-3 focus-within:border-ink/60">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{5}"
                required
                value={need.zip}
                onChange={(e) => update("zip", e.target.value.replace(/\D/g, "").slice(0, 5))}
                placeholder="43215"
                className="w-full bg-transparent focus:outline-none tabular"
              />
            </div>
            <span className="text-xs text-ink-soft mt-1 block">For listings near you.</span>
          </label>
        </div>
      </div>

      <Button type="submit" size="lg" className="mt-10">
        Continue
      </Button>
    </form>
  );
}

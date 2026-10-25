"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/Logo";
import type { PipelineResult } from "@/lib/types";

interface DealerPacketViewProps {
  result: PipelineResult;
  onBack: () => void;
}

export function DealerPacketView({ result, onBack }: DealerPacketViewProps) {
  const { dealerPacket, credit } = result;
  const generated = new Date(dealerPacket.generatedAt);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="no-print flex items-center gap-4 mb-8">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="w-4 h-4" />
          Print
        </Button>
      </div>

      <div className="border border-ink/30 bg-cream rounded-2xl p-8 sm:p-10">
        <div className="flex items-start justify-between pb-6 border-b border-ink/20">
          <Logo />
          <div className="text-right">
            <p className="text-xs text-ink-soft">Dealer packet</p>
            <p className="text-xs text-ink-soft tabular">
              {generated.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
        </div>

        <section className="pt-6">
          <h2 className="font-display text-lg">Credit summary</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{dealerPacket.creditSummary}</p>
          <p className="mt-2 text-sm">
            Tier: <span className="font-medium">{dealerPacket.tierLabel}</span> · Max APR to accept:{" "}
            <span className="font-medium">{credit.estimatedApr.max.toFixed(2)}%</span>{" "}
            <span className="text-ink-soft">(our estimate for your score band, not a lender offer or approval)</span>
          </p>
        </section>

        <section className="pt-8 mt-8 border-t border-ink/20 grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs text-ink-soft">Maximum payment</p>
            <p className="font-display text-2xl tabular mt-1">${dealerPacket.maxApprovedPayment}/mo</p>
          </div>
          <div>
            <p className="text-xs text-ink-soft">Down payment on hand</p>
            <p className="font-display text-2xl tabular mt-1">${dealerPacket.recommendedDownPayment}</p>
          </div>
        </section>

        <section className="pt-8 mt-8 border-t border-ink/20">
          <h2 className="font-display text-lg">Target cars &amp; walk-away price</h2>
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-left text-ink-soft border-b border-ink/20">
                <th className="font-normal py-2">Car</th>
                <th className="font-normal py-2 text-right">Walk-away price</th>
              </tr>
            </thead>
            <tbody>
              {dealerPacket.targets.map((t) => (
                <tr key={`${t.year}-${t.make}-${t.model}`} className="border-b border-ink/10">
                  <td className="py-2.5">
                    {t.year} {t.make} {t.model} {t.trim}
                  </td>
                  <td className="py-2.5 text-right tabular">${t.walkAwayPrice.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="pt-8 mt-8 border-t border-ink/20">
          <h2 className="font-display text-lg">Walking in</h2>
          <ul className="mt-3 space-y-2.5">
            {dealerPacket.negotiationTips.map((tip) => (
              <li key={tip} className="text-sm leading-relaxed flex gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-gold mt-[0.45rem] shrink-0" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

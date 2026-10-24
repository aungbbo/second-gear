import { SiteHeader } from "@/components/SiteHeader";
import { HeroIntake } from "@/components/HeroIntake";
import { Logo } from "@/components/Logo";

const CHECKS = [
  {
    title: "Your real credit picture",
    detail:
      "A soft pull that won't ding your score, explained in plain terms instead of a number you have to guess the meaning of.",
  },
  {
    title: "What you can actually afford",
    detail:
      "Read from your real deposits and bills, not a lender's idea of what you qualify for.",
  },
  {
    title: "Listings from the whole market",
    detail: "Live inventory pulled from public listings, not just whatever one dealer has on the lot.",
  },
  {
    title: "The true cost of every loan",
    detail: "Total interest, not just the monthly number — and a flag when a loan outlives the car's value.",
  },
];

const ROUTE_STEPS = [
  { n: 1, label: "Tell it what you need", detail: "One sentence about the car and the payment you can live with." },
  { n: 2, label: "Approve a soft credit check", detail: "One tap. It doesn't affect your score." },
  { n: 3, label: "It does the research", detail: "Credit, cash flow, live listings, and loan math — no further input." },
  { n: 4, label: "Review the real numbers", detail: "Ranked cars with total cost, not just payment." },
  { n: 5, label: "Walk in ready", detail: "A dealer packet with your ceiling and your walk-away price." },
];

export default function LandingPage() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 pt-20 pb-24 sm:pt-28 sm:pb-32">
          <HeroIntake />
        </section>

        <section className="border-t border-line bg-paper-raised/60">
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
            <h2 className="font-display text-2xl sm:text-3xl max-w-xl">
              Four things most buyers never get to see before they sign.
            </h2>
            <div className="mt-12 grid sm:grid-cols-2 gap-x-10 gap-y-10">
              {CHECKS.map((item) => (
                <div key={item.title} className="border-t border-ink/20 pt-4">
                  <h3 className="font-medium text-[1.05rem]">{item.title}</h3>
                  <p className="mt-2 text-ink-soft leading-relaxed">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <h2 className="font-display text-2xl sm:text-3xl max-w-xl">One run. No dealer in the room.</h2>
          <p className="mt-3 text-ink-soft max-w-md">
            Everything after step 2 happens on its own — the kind of research most buyers skip because it takes
            hours and ends in a spreadsheet.
          </p>

          <ol className="mt-14 relative">
            <div
              className="absolute left-[15px] top-2 bottom-2 w-px bg-line sm:left-[15px]"
              aria-hidden="true"
            />
            {ROUTE_STEPS.map((step) => (
              <li key={step.n} className="relative flex gap-6 pb-10 last:pb-0">
                <div className="relative z-10 shrink-0 w-8 h-8 rounded-full bg-paper border border-ink/30 flex items-center justify-center font-display text-sm">
                  {step.n}
                </div>
                <div className="pt-0.5">
                  <h3 className="font-medium text-[1.05rem]">{step.label}</h3>
                  <p className="mt-1 text-ink-soft leading-relaxed max-w-md">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-line">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28 text-center">
            <h2 className="font-display text-3xl sm:text-4xl max-w-2xl mx-auto leading-tight">
              The loan is where subprime buyers lose the most money. That&apos;s what this looks at first.
            </h2>
            <a
              href="/start"
              className="mt-10 inline-flex items-center gap-2.5 bg-ink text-cream px-7 py-3.5 text-base font-medium hover:bg-gold-deep transition-colors duration-150"
            >
              Start my search
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-sm text-ink-soft">
          <Logo className="text-ink-soft" />
          <p>Built on mock credit, bank, and listings data for demonstration.</p>
        </div>
      </footer>
    </>
  );
}

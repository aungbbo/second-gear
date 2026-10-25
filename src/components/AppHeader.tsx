"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp } from "lucide-react";
import { Logo } from "@/components/Logo";

const TABS = [
  { href: "/find-my-car", label: "Find My Car" },
  { href: "/credit-profile", label: "Credit Profile" },
  { href: "/banking", label: "Banking" },
];

const STEPS = [
  { label: "Tell it what you need", detail: "One sentence about the car and the payment you can live with." },
  { label: "Approve a soft credit check", detail: "One tap. It doesn't affect your score." },
  { label: "It does the research", detail: "Credit, cash flow, live listings, and loan math, with no further input." },
  { label: "Review the real numbers", detail: "Ranked cars with total cost, not just the monthly payment." },
  { label: "Walk in ready", detail: "A dealer packet with your ceiling and your walk-away price." },
];

export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 sm:py-0 sm:h-16 flex flex-col gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-4">
        <div className="flex items-center justify-between">
          <Link href="/find-my-car">
            <Logo />
          </Link>
          <div className="sm:hidden">
            <HowItWorks />
          </div>
        </div>

        <nav className="flex items-center justify-center gap-1 overflow-x-auto max-w-full">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`shrink-0 whitespace-nowrap px-3 sm:px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  active ? "bg-teal-paper text-teal-deep" : "text-ink-soft hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden sm:flex justify-end">
          <HowItWorks />
        </div>
      </div>
    </header>
  );
}

function HowItWorks() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-full transition-colors ${
          open ? "bg-teal-paper text-teal-deep" : "text-ink-soft hover:text-ink"
        }`}
      >
        <CircleHelp className="w-4 h-4" aria-hidden="true" />
        How it works
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="How it works"
          className="absolute right-0 top-full mt-2 z-50 w-[min(22rem,calc(100vw-2rem))] bg-card border border-line rounded-2xl shadow-lg p-5"
        >
          <p className="font-display font-bold text-base">One run. No dealer in the room.</p>
          <p className="mt-1 text-xs text-ink-soft">Everything after step 2 happens on its own.</p>
          <ol className="mt-4 space-y-3">
            {STEPS.map((step, i) => (
              <li key={step.label} className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full border border-ink/30 flex items-center justify-center font-display text-xs">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium">{step.label}</p>
                  <p className="text-xs text-ink-soft mt-0.5">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

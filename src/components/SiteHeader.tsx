import Link from "next/link";
import { Logo } from "@/components/Logo";

export function SiteHeader() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto max-w-6xl px-6 flex items-center justify-between h-16">
        <Link href="/" className="text-ink">
          <Logo />
        </Link>
        <nav className="flex items-center gap-6 text-[0.92rem] text-ink-soft">
          <a href="#how-it-works" className="hidden sm:inline hover:text-ink transition-colors">
            How it works
          </a>
          <Link
            href="/start"
            className="text-ink font-medium border-b border-gold hover:border-ink transition-colors"
          >
            Start my search
          </Link>
        </nav>
      </div>
    </header>
  );
}

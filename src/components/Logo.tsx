interface LogoProps {
  className?: string;
  mark?: boolean;
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <line x1="7" y1="24" x2="25" y2="8" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
      <circle cx="7" cy="24" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="3.6" fill="var(--gold)" stroke="var(--gold)" />
      <circle cx="25" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function Logo({ className }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <LogoMark className="w-6 h-6 text-ink shrink-0" />
      <span className="font-display text-[1.2rem] leading-none tracking-tight">Second Gear</span>
    </span>
  );
}

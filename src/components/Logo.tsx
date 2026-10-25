interface LogoProps {
  className?: string;
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--teal)" />
      <path
        d="M20.8 11.6c-.9-1.1-2.4-1.7-4.3-1.7-2.9 0-4.7 1.3-4.7 3.3 0 2.2 2 2.8 4.4 3.3 2.9.6 5.3 1.3 5.3 4 0 2.6-2.3 4.1-5.4 4.1-2.5 0-4.5-.8-5.7-2.3"
        stroke="var(--cream)"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function Logo({ className }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <LogoMark className="w-7 h-7 shrink-0" />
      <span className="font-display font-bold text-[1.15rem] leading-none tracking-tight text-ink">Second Gear</span>
    </span>
  );
}

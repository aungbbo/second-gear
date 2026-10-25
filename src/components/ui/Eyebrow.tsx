import type { ReactNode } from "react";

export function Eyebrow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-teal uppercase">
      {icon}
      {children}
    </span>
  );
}

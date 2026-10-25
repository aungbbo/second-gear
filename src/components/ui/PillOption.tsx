import { Check } from "lucide-react";
import type { ReactNode } from "react";

interface PillOptionProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  icon?: ReactNode;
}

export function PillOption({ label, selected, onClick, icon }: PillOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`relative flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-sm font-medium transition-colors ${
        selected ? "border-teal bg-teal-paper text-teal-deep" : "border-line bg-card text-ink-soft hover:border-ink/30"
      }`}
    >
      {selected && (
        <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-teal flex items-center justify-center">
          <Check className="w-2.5 h-2.5 text-cream" strokeWidth={3} />
        </span>
      )}
      {icon && <span className={selected ? "text-teal-deep" : "text-ink-soft"}>{icon}</span>}
      {label}
    </button>
  );
}

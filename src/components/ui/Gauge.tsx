interface GaugeProps {
  value: number;
  min: number;
  max: number;
  label: string;
  sublabel?: string;
}

const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function scoreColor(score: number): string {
  if (score < 580) return "var(--rust)";
  if (score < 620) return "var(--gold-deep)";
  if (score < 660) return "var(--gold)";
  if (score < 700) return "#4f8872";
  return "var(--teal-deep)";
}

export function Gauge({ value, min, max, label, sublabel }: GaugeProps) {
  const fraction = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const offset = CIRCUMFERENCE * (1 - fraction);
  const color = scoreColor(value);

  return (
    <div className="relative w-36 h-36 mx-auto">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--paper-high)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-extrabold text-3xl tabular">{value}</span>
        <span className="text-xs font-medium" style={{ color }}>{label}</span>
      </div>
      {sublabel && (
        <p className="mt-2 text-center text-xs text-ink-soft absolute -bottom-6 left-0 right-0">{sublabel}</p>
      )}
    </div>
  );
}

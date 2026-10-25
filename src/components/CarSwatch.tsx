import { Car } from "lucide-react";

interface CarSwatchProps {
  make: string;
  model: string;
  hue: number;
  size?: "sm" | "md" | "listing";
}

export function CarSwatch({ make, model, hue, size = "md" }: CarSwatchProps) {
  const initials = `${make[0]}${model[0]}`.toUpperCase();
  const gradient = `linear-gradient(155deg, hsl(${hue} 38% 34%), hsl(${(hue + 28) % 360} 42% 24%))`;

  if (size === "listing") {
    return (
      <div
        className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 px-5 py-6 text-center"
        style={{ background: gradient }}
        aria-hidden="true"
      >
        <Car className="h-14 w-14 text-cream/80" strokeWidth={1.4} />
        <span className="font-display text-sm font-semibold tracking-wide text-cream/90">{make} {model}</span>
      </div>
    );
  }

  const dim = size === "sm" ? "w-10 h-10 text-xs" : "w-14 h-14 text-base";

  return (
    <div
      className={`${dim} shrink-0 rounded-lg flex items-center justify-center font-display text-cream border border-ink/15`}
      style={{ background: gradient }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

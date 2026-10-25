import { Car } from "lucide-react";

interface CarSwatchProps {
  make: string;
  model: string;
  hue: number;
  size?: "sm" | "md" | "banner";
}

export function CarSwatch({ make, model, hue, size = "md" }: CarSwatchProps) {
  const initials = `${make[0]}${model[0]}`.toUpperCase();
  const gradient = `linear-gradient(155deg, hsl(${hue} 38% 34%), hsl(${(hue + 28) % 360} 42% 24%))`;

  if (size === "banner") {
    return (
      <div
        className="w-full h-36 rounded-t-2xl flex items-center justify-center"
        style={{ background: gradient }}
        aria-hidden="true"
      >
        <Car className="w-12 h-12 text-cream/70" strokeWidth={1.5} />
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

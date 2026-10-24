interface CarSwatchProps {
  make: string;
  model: string;
  hue: number;
  size?: "sm" | "md";
}

export function CarSwatch({ make, model, hue, size = "md" }: CarSwatchProps) {
  const initials = `${make[0]}${model[0]}`.toUpperCase();
  const dim = size === "sm" ? "w-10 h-10 text-xs" : "w-14 h-14 text-base";

  return (
    <div
      className={`${dim} shrink-0 flex items-center justify-center font-display text-cream border border-ink/15`}
      style={{
        background: `linear-gradient(155deg, hsl(${hue} 38% 34%), hsl(${(hue + 28) % 360} 42% 24%))`,
      }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

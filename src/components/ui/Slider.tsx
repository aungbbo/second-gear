interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  hint?: string;
}

export function Slider({ label, value, min, max, step = 1, onChange, formatValue, hint }: SliderProps) {
  const display = formatValue ? formatValue(value) : String(value);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-display font-bold text-2xl text-teal tabular">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 w-full h-2 rounded-full appearance-none bg-paper-high accent-teal cursor-pointer"
      />
      <div className="mt-1.5 flex justify-between text-xs text-ink-soft tabular">
        <span>{formatValue ? formatValue(min) : min}</span>
        <span>{formatValue ? formatValue(max) : max}</span>
      </div>
      {hint && <p className="mt-2 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Decimals implied by the step, so 0.996 never renders as 0.9960000000001. */
function decimalsOf(step: number) {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Slider plus an editable readout. A slider alone cannot land on an exact
 * value — 0.996 with a 0.001 step is three careful drags — and a bare number
 * field gives no feel for the range, so every tunable parameter offers both.
 */
export function SliderField({
  label,
  suffix,
  value,
  min,
  max,
  step,
  disabled,
  hint,
  onChange,
  className,
}: {
  label: string;
  /** Short note under the row: what the value does, or its usual range. */
  hint?: string;
  suffix?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  className?: string;
}) {
  const decimals = decimalsOf(step);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string) => {
    setDraft(text);
    const parsed = Number(text);
    if (text.trim() !== "" && Number.isFinite(parsed))
      onChange(clamp(parsed, min, max));
  };

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">
          {label}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <input
            inputMode="decimal"
            disabled={disabled}
            value={draft ?? value.toFixed(decimals)}
            aria-label={label}
            onFocus={() => setDraft(String(value))}
            onBlur={() => setDraft(null)}
            onChange={(event) => commit(event.target.value)}
            className="h-6 w-[62px] rounded-md border border-transparent bg-transparent px-1 text-right font-mono text-[11.5px] tabular-nums text-muted-foreground transition-colors outline-none hover:border-border focus-visible:border-border-strong focus-visible:bg-background focus-visible:text-foreground disabled:opacity-60"
          />
          {suffix && (
            <span className="font-mono text-[10.5px] text-muted-foreground/70">
              {suffix}
            </span>
          )}
        </span>
      </div>
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={clamp(value, min, max)}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && (
        <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground/80">
          {hint}
        </p>
      )}
    </div>
  );
}

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn("block text-xs font-medium text-foreground", className)}
      {...props}
    />
  );
}

/**
 * Label + optional hint tooltip + control. Every form row in the console uses
 * this so spacing and hint affordances stay identical.
 */
export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-1">
        <span className="truncate">{label}</span>
        {hint && (
          <span
            title={hint}
            aria-label={hint}
            className="cursor-help text-[10px] text-muted-foreground/70 select-none"
          >
            ⓘ
          </span>
        )}
      </Label>
      {children}
    </div>
  );
}

export function CheckboxField({
  label,
  hint,
  className,
  ...props
}: ComponentProps<"input"> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 text-[12.5px] text-foreground",
        props.disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <input
        type="checkbox"
        className="size-[15px] shrink-0 rounded border-border"
        {...props}
      />
      <span className="min-w-0">{label}</span>
      {hint && (
        <span className="truncate text-[11.5px] text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}

/** Segmented control (theme picker, tabs, think_type toggle). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className,
  size = "default",
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "flex overflow-hidden rounded-lg border border-border",
        size === "sm" ? "h-8" : "h-[34px]",
        disabled && "opacity-60",
        className,
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex-1 px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed",
              index > 0 && "border-l border-border",
              active
                ? "bg-accent text-foreground"
                : "bg-transparent text-muted-foreground hover:bg-muted",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

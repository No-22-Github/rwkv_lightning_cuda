import { Check } from "lucide-react";
import { StatusDot } from "@/components/ui/badge";
import { basename } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { ProcessStatus, TuningConfig } from "@/lib/api/types";

/** One of the 01–04 pipeline cards: glyph + step name + live value. */
function StepCard({
  step,
  label,
  value,
  done,
  running,
}: {
  step: string;
  label: string;
  value: string;
  done: boolean;
  running?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
      {running ? (
        <StatusDot tone="warn" pulse />
      ) : (
        <span
          aria-hidden
          className="flex size-[18px] shrink-0 items-center justify-center rounded-full border border-border"
        >
          {done && <Check className="size-3 text-success" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-muted-foreground">
          {step} {label}
        </div>
        <div className="truncate font-mono text-[11.5px]" title={value}>
          {value}
        </div>
      </div>
    </div>
  );
}

/** The pipeline row: which of files → dataset → parameters → trainer is done. */
export function TrainingSteps({
  config,
  samples,
  numbersValid,
  trainerText,
  tuning,
}: {
  config: TuningConfig;
  samples: number | null;
  numbersValid: boolean;
  trainerText: string;
  tuning?: ProcessStatus;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StepCard
        step="01"
        label={t("training.stepFiles")}
        value={config.model ? basename(config.model) : "—"}
        done={Boolean(config.model)}
      />
      <StepCard
        step="02"
        label={t("training.stepDataset")}
        value={
          samples === null ? "—" : t("training.validated", { count: samples })
        }
        done={samples !== null}
      />
      <StepCard
        step="03"
        label={t("training.stepParameters")}
        value={`${config.ctx} ctx · batch ${config.batch_size}`}
        done={numbersValid}
      />
      <StepCard
        step="04"
        label={t("training.stepTrainer")}
        value={trainerText}
        done={tuning?.status === "completed"}
        running={Boolean(tuning?.running)}
      />
    </div>
  );
}

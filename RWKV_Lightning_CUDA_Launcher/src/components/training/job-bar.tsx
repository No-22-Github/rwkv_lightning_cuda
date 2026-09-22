import { Play, ScrollText, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/field";
import type { TuningMethod } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n";
import { useLogDock } from "@/stores/ui";

/**
 * The page's only job controls. They live here, under the pipeline row and
 * away from the app header's runtime Start / Stop, and every label says
 * "训练" so the two pairs can never read as one switch.
 */
export function TrainingJobBar({
  method,
  onMethod,
  canStart,
  blocker,
  running,
  statusText,
  onStart,
  onStop,
}: {
  method: TuningMethod;
  onMethod: (method: TuningMethod) => void;
  canStart: boolean;
  /** Why Start is unavailable, already localised; empty when it is available. */
  blocker: string;
  running: boolean;
  statusText: string;
  onStart: () => void;
  onStop: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3">
      <span className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground">
        {t("training.jobControls")}
      </span>
      <Segmented<TuningMethod>
        size="sm"
        value={method}
        onChange={onMethod}
        options={[
          { value: "state", label: t("training.stateTab") },
          { value: "miss", label: t("training.missTab") },
        ]}
      />
      <Button
        variant="default"
        size="sm"
        disabled={!canStart}
        title={blocker || undefined}
        onClick={onStart}
      >
        <Play className="size-3.5" />
        {t("training.start")}
      </Button>
      <Button size="sm" disabled={!running} onClick={onStop}>
        <Square className="size-3.5" />
        {t("training.stop")}
      </Button>
      <Button size="sm" onClick={() => useLogDock.getState().show("tuning")}>
        <ScrollText className="size-3.5" />
        {t("training.logs")}
      </Button>
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
        {running
          ? t("training.running")
          : blocker
            ? t("training.cannotStart", { reason: blocker })
            : statusText}
      </span>
    </div>
  );
}

import { Loader2, Play, RotateCcw, Square } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/badge";
import { applyDevice } from "@/lib/api/launcher";
import { useI18n } from "@/lib/i18n";
import { useCurrent } from "@/app/use-current";
import { useRuntimeForm } from "@/stores/forms";
import { useNodes } from "@/stores/nodes";
import { toast } from "@/stores/ui";
import { runtimeLabel, runtimeTone } from "@/components/node-status";

function useActions() {
  const { t } = useI18n();
  const { backendId, hasAgent, runtime, backend, busy } = useCurrent();
  const form = useRuntimeForm((s) => s.config);
  const devices = useRuntimeForm((s) => s.devices);
  const start = useNodes((s) => s.startRuntime);
  const stop = useNodes((s) => s.stopRuntime);
  const restart = useNodes((s) => s.restartRuntime);

  const run = async (action: () => Promise<void>, message: string) => {
    try {
      await action();
      toast.success(message);
    } catch (error) {
      toast.error(
        t("toast.failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  return {
    t,
    busy,
    running: Boolean(runtime?.running),
    // An inference-only or unreachable node cannot be controlled at all.
    disabled: !backendId || !hasAgent || !backend?.reachable,
    canStart: Boolean(form.model_path.trim()),
    start: () =>
      run(
        () => start(backendId, applyDevice({ ...form }, devices)),
        t("runtime.started"),
      ),
    stop: () => run(() => stop(backendId), t("runtime.stopped")),
    restart: () => run(() => restart(backendId), t("runtime.restarted")),
  };
}

export function RuntimeControls({
  size = "sm",
  className,
}: {
  size?: ButtonProps["size"];
  className?: string;
}) {
  const actions = useActions();
  return (
    <div className={className} data-testid="runtime-controls">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="default"
          size={size}
          disabled={actions.disabled || actions.busy || actions.running || !actions.canStart}
          onClick={() => void actions.start()}
        >
          <Play className="size-3.5" />
          {actions.t("common.start")}
        </Button>
        <Button
          size={size}
          disabled={actions.disabled || actions.busy || !actions.running}
          onClick={() => void actions.stop()}
        >
          <Square className="size-3.5" />
          {actions.t("common.stop")}
        </Button>
        <Button
          size={size}
          disabled={actions.disabled || actions.busy || !actions.running}
          onClick={() => void actions.restart()}
        >
          <RotateCcw className="size-3.5" />
          {actions.t("common.restart")}
        </Button>
      </div>
    </div>
  );
}

export function RuntimeBadge() {
  const { t } = useI18n();
  const { runtime, backend } = useCurrent();
  const label = !backend?.reachable
    ? t("status.unreachable")
    : runtimeLabel(t, runtime);
  const tone = !backend?.reachable ? "bad" : runtimeTone(runtime);
  const spinning =
    runtime?.status === "starting" || runtime?.status === "stopping";
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 text-[11.5px] text-muted-foreground">
      {spinning ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <StatusPill tone={tone} label="" />
      )}
      {label}
    </span>
  );
}

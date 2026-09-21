import { ChevronsUpDown, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { StatusDot, StatusPill, type StatusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  gpuUnavailableReason,
  GpuMiniRows,
  nodeTone,
  runtimeLabel,
} from "@/components/node-status";
import { useI18n } from "@/lib/i18n";
import { backendKindLabel, backendLabel, useBackends } from "@/stores/backends";
import { useNodes } from "@/stores/nodes";
import { useUI } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";

/**
 * Runtime status line under the switcher card. Mockup semantics: a bare
 * inference node is "inference only" (n/a), not offline; only a failed probe
 * reads as unreachable.
 */
export function runtimeStatus(
  reachable: boolean,
  kind: string,
  status: string | undefined,
): { tone: StatusTone; key: "unreachable" | "inferenceOnly" | "runtime" } {
  if (!reachable) return { tone: "bad", key: "unreachable" };
  if (kind === "inference_only") return { tone: "info", key: "inferenceOnly" };
  return { tone: status === "ready" ? "ok" : "idle", key: "runtime" };
}

/** Bottom-of-rail node card: shows the active backend and switches between them. */
export function BackendSwitcher() {
  const { t } = useI18n();
  const list = useBackends((s) => s.list);
  const currentId = useBackends((s) => s.currentId);
  const select = useBackends((s) => s.select);
  const snapshots = useNodes((s) => s.snapshots);
  const openAddBackend = useUI((s) => s.openAddBackend);

  const current = list.find((b) => b.id === currentId);
  const snapshot = snapshots[currentId];
  const runtime = snapshot?.runtime;
  const metrics = snapshot?.metrics;
  const tone = nodeTone(current, runtime);
  const status = current
    ? runtimeStatus(current.reachable, current.kind, runtime?.status)
    : undefined;
  const statusLabel = status
    ? status.key === "unreachable"
      ? t("status.unreachable")
      : status.key === "inferenceOnly"
        ? t("status.inferenceOnly")
        : runtimeLabel(t, runtime)
    : "";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="block w-full overflow-hidden rounded-t-xl border border-b-0 border-border bg-background text-left transition-colors hover:bg-muted"
        >
          <span className="flex items-center gap-2 px-3 pt-2.5">
            <StatusDot tone={tone} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.01em]">
              {current?.name ?? t("backend.emptyTitle")}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </span>
          <span className="block truncate px-3 pt-1.5 font-mono text-[10.5px] text-muted-foreground">
            {current?.base_url ?? "—"}
          </span>
          <span className="flex items-center gap-2 px-3 pt-1.5 pb-2.5">
            <span className="inline-flex h-[18px] items-center rounded-md bg-muted px-1.5 text-[10px] text-muted-foreground">
              {backendKindLabel(current?.kind ?? "") ||
                t("backend.kind.unknown")}
            </span>
            {status && (
              <StatusPill
                tone={status.tone}
                label={statusLabel}
                className="min-w-0"
              />
            )}
          </span>
        </button>
      </PopoverTrigger>

      {current && (
        <div className="overflow-hidden rounded-b-xl border border-t-0 border-border bg-background">
          {metrics?.available && metrics.gpus.length > 0 ? (
            // Multi-GPU boxes exist; cap the card so four rows cannot push
            // the footer off-screen.
            <div className="max-h-[172px] overflow-x-hidden overflow-y-auto px-3 py-2.5">
              <GpuMiniRows metrics={metrics} />
            </div>
          ) : (
            <p className="px-3 py-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
              {gpuUnavailableReason(
                t,
                metrics,
                snapshot?.metricsError,
                current,
              )}
            </p>
          )}
        </div>
      )}

      <PopoverContent side="top" align="start" className="w-[320px] p-1.5">
        <p className="px-2 py-1.5 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground">
          {t("backend.registered")}
        </p>
        {list.map((backend) => {
          const itemTone = nodeTone(backend, snapshots[backend.id]?.runtime);
          return (
            <button
              key={backend.id}
              type="button"
              onClick={() => select(backend.id)}
              className={cn(
                "grid w-full grid-cols-[8px_1fr_auto] items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted",
                backend.id === currentId && "bg-accent",
              )}
            >
              <StatusDot tone={itemTone} />
              <span className="block min-w-0">
                <span className="block truncate text-[13px] font-medium">
                  {backendLabel(t, backend)}
                </span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {backend.base_url}
                </span>
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {backend.reachable
                  ? formatRelativeTime(backend.last_probe)
                  : t("status.unreachable")}
              </span>
            </button>
          );
        })}
        <div className="mx-1 my-1.5 h-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={openAddBackend}
        >
          <Plus className="size-3.5" />
          {t("backend.add")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

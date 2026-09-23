import { ChevronsUpDown, PanelLeft, Plus, Server } from "lucide-react";
import { useCurrent } from "@/app/use-current";
import { NodeProcessList } from "@/components/node-processes";
import {
  GpuHeatGrid,
  GpuMiniRows,
  gpuUnavailableReason,
  nodeTone,
  runtimeHint,
  runtimeLabel,
  runtimeStatus,
} from "@/components/node-status";
import { StatusDot, StatusPill, type StatusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatRelativeTime } from "@/lib/format";
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { BackendView, MetricsResponse } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { backendKindLabel, backendLabel, useBackends } from "@/stores/backends";
import { useNodes } from "@/stores/nodes";
import { useRail, useUI } from "@/stores/ui";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * Bottom-of-rail node card. The rail renders this component in both states
 * instead of swapping in a collapsed variant: closing the rail narrows this
 * card and clips its right side, so the avatar and the heat grid keep the
 * exact position they have while it is open. The rows below the heat grid
 * are the exception — they are dropped, not clipped sideways, which is what
 * makes the collapse read as "the detail went away" rather than "the card
 * became something else".
 */
export function NodeCard({ collapsed }: { collapsed: boolean }) {
  const { t } = useI18n();
  const { backend, runtime, metrics, metricsError } = useCurrent();
  const list = useBackends((s) => s.list);
  const currentId = useBackends((s) => s.currentId);
  const select = useBackends((s) => s.select);
  const snapshots = useNodes((s) => s.snapshots);
  const openAddBackend = useUI((s) => s.openAddBackend);
  const setCollapsed = useRail((s) => s.setCollapsed);

  const tone = nodeTone(backend, runtime);
  const status = backend
    ? runtimeStatus(backend.reachable, backend.kind, runtime?.status)
    : undefined;
  const statusLabel = status
    ? status.key === "unreachable"
      ? t("status.unreachable")
      : status.key === "inferenceOnly"
        ? t("status.inferenceOnly")
        : runtimeLabel(t, runtime)
    : "";
  const kindLabel =
    backendKindLabel(backend?.kind ?? "") || t("backend.kind.unknown");

  // Same trap as the header badge: the status line below the node name
  // describes the inference server, not the box, so the tooltip says which
  // one is down.
  const hint =
    backend && !backend.reachable
      ? backend.probe_error || t("status.unreachable")
      : runtimeHint(t, runtime);

  const gpus = metrics?.available ? metrics.gpus : [];
  const average = gpus.length
    ? Math.round(
        gpus.reduce((sum, gpu) => sum + (gpu.utilization_percent ?? 0), 0) /
          gpus.length,
      )
    : 0;
  // The grid already counts the cards, so this line only has to add the
  // average — the one number a per-card colour cannot show. The older
  // "{count} GPUs · {avg}% average utilization" wording ran past the card's
  // 176px and truncated the percentage it existed to report.
  const gpuSummary =
    gpus.length > 1
      ? t("rail.gpuAverage", { avg: average })
      : gpus.length === 1
        ? t("rail.gpuSummaryOne", { avg: average })
        : gpuUnavailableReason(t, metrics, metricsError, backend);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <Popover>
        <PopoverTrigger asChild>
          {/* 9px of padding plus the card's 1px border puts this content on
              the same 20px column as every nav icon above it. */}
          <button
            type="button"
            title={hint}
            className="block w-full px-[9px] py-2.5 text-left transition-colors hover:bg-muted"
            aria-label={t("backend.registered")}
            aria-haspopup="dialog"
          >
            <span className="flex items-center gap-2">
              <NodeAvatar name={backend?.name} tone={tone} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.01em] transition-opacity",
                  collapsed && "opacity-0",
                )}
              >
                {backend?.name ?? t("backend.emptyTitle")}
              </span>
              <ChevronsUpDown
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-opacity",
                  collapsed && "opacity-0",
                )}
              />
            </span>

            <span
              className={cn(
                "mt-1.5 block truncate font-mono text-[10.5px] text-muted-foreground transition-opacity",
                collapsed && "opacity-0",
              )}
            >
              {backend?.base_url ?? "—"}
            </span>

            {/* The one block both rail states keep, so it is also the one
                block whose position must not depend on the rail width. */}
            <span className="mt-2 flex items-center gap-2">
              <GpuHeatGrid gpus={gpus} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground transition-opacity",
                  collapsed && "opacity-0",
                )}
              >
                {gpuSummary}
              </span>
            </span>

            {!collapsed && (
              <span className="mt-2 flex items-center gap-2">
                <span className="inline-flex h-[18px] items-center rounded-md bg-muted px-1.5 text-[10px] text-muted-foreground">
                  {kindLabel}
                </span>
                {status && (
                  <StatusPill
                    tone={status.tone}
                    label={statusLabel}
                    className="min-w-0"
                  />
                )}
              </span>
            )}
          </button>
        </PopoverTrigger>

        <PopoverContent
          side={collapsed ? "right" : "top"}
          align="start"
          className="w-[320px] p-1.5"
        >
          {/* Collapsed, the rail shows the avatar and nothing else, so the
              popover is where the rest of the card lives. It reuses the same
              rows, pills and list the open card is built from. */}
          {collapsed && (
            <div className="mb-1 rounded-lg border border-border bg-background">
              <div className="px-2.5 pt-2.5 pb-2">
                <div className="flex items-center gap-2">
                  <NodeAvatar name={backend?.name} tone={tone} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.01em]">
                    {backend?.name ?? t("backend.emptyTitle")}
                  </span>
                </div>
                <p className="mt-1.5 truncate font-mono text-[10.5px] text-muted-foreground">
                  {backend?.base_url ?? "—"}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="inline-flex h-[18px] items-center rounded-md bg-muted px-1.5 text-[10px] text-muted-foreground">
                    {kindLabel}
                  </span>
                  {status && (
                    <StatusPill
                      tone={status.tone}
                      label={statusLabel}
                      className="min-w-0"
                    />
                  )}
                </div>
              </div>
              <GpuRows
                metrics={metrics}
                metricsError={metricsError}
                backend={backend}
                t={t}
                className="max-h-[248px] overflow-x-hidden overflow-y-auto border-t border-border px-2.5 py-2.5"
              />
              {/* The same three process rows the header menu shows: one
                  implementation of "start this / stop that", wherever it is
                  reached from. */}
              <div className="border-t border-border">
                <NodeProcessList />
              </div>
            </div>
          )}

          <p className="px-2 py-1.5 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground">
            {t("backend.registered")}
          </p>
          {list.map((item) => {
            const itemTone = nodeTone(item, snapshots[item.id]?.runtime);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => select(item.id)}
                className={cn(
                  "grid w-full grid-cols-[8px_1fr_auto] items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted",
                  item.id === currentId && "bg-accent",
                )}
              >
                <StatusDot tone={itemTone} />
                <span className="block min-w-0">
                  <span className="block truncate text-[13px] font-medium">
                    {backendLabel(t, item)}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {item.base_url}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {item.reachable
                    ? formatRelativeTime(item.last_probe)
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

          {collapsed && (
            <div className="mt-1.5 flex border-t border-border p-2">
              <div className="flex-1" />
              <PopoverClose asChild>
                <Button
                  size="xs"
                  title={t("header.expandSidebar")}
                  onClick={() => setCollapsed(false)}
                >
                  <PanelLeft className="size-3" />
                </Button>
              </PopoverClose>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Below everything the two states share, so dropping it cannot move
          the avatar or the heat grid. */}
      {!collapsed && (
        <GpuRows
          metrics={metrics}
          metricsError={metricsError}
          backend={backend}
          t={t}
          className="max-h-[172px] overflow-x-hidden overflow-y-auto border-t border-border px-[9px] py-2.5"
        />
      )}
    </div>
  );
}

/**
 * The node's identity in one glyph: its initial in a tile, sized like the nav
 * icons above so the rail reads as a single icon column, with the node's tone
 * as the corner badge those icons use for their own badges.
 */
function NodeAvatar({ name, tone }: { name?: string; tone: StatusTone }) {
  return (
    <span className="relative shrink-0">
      <span className="flex size-4 items-center justify-center rounded-[5px] bg-muted text-[9.5px] font-semibold text-muted-foreground">
        {name ? (
          name.trim().slice(0, 1).toUpperCase()
        ) : (
          <Server className="size-2.5" />
        )}
      </span>
      <StatusDot
        tone={tone}
        className="absolute -top-1 -right-1 ring-2 ring-background"
      />
    </span>
  );
}

/** Per-GPU rows, or the reason there are none; never an all-zero list. */
function GpuRows({
  metrics,
  metricsError,
  backend,
  t,
  className,
}: {
  metrics: MetricsResponse | undefined;
  metricsError: string | undefined;
  backend: BackendView | undefined;
  t: TFn;
  className?: string;
}) {
  if (metrics?.available && metrics.gpus.length > 0) {
    return (
      <div className={className}>
        <GpuMiniRows metrics={metrics} />
      </div>
    );
  }
  return (
    <p
      className={cn(
        "text-[10.5px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      {gpuUnavailableReason(t, metrics, metricsError, backend)}
    </p>
  );
}

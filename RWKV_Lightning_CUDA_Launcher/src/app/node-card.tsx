import { ChevronsUpDown, PanelLeft, Plus, Server } from "lucide-react";
import { useCurrent } from "@/app/use-current";
import { NodeProcessList } from "@/components/node-processes";
import {
  GpuHeatGrid,
  GpuMiniRows,
  gpuUnavailableReason,
  nodeTone,
  ownedDevices,
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
import { formatGigabytePair, formatRelativeTime } from "@/lib/format";
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { BackendView, MetricsResponse } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { backendKindLabel, backendLabel, useBackends } from "@/stores/backends";
import { useNodes } from "@/stores/nodes";
import { useRail, useUI } from "@/stores/ui";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * Bottom-of-rail node card: one card at two rail widths.
 *
 * It holds exactly two rows in both states — the node avatar and the GPU heat
 * grid under it — because it hangs off the rail's bottom edge. A row that
 * appeared or disappeared with the collapse would push the settings row and
 * the card itself up and down again, which is the jump this card used to
 * have. Everything that does not fit at 44px wide, held or not — the URL, the
 * kind and runtime chips, the per-GPU rows, the process rows and the node
 * switcher — is in the popover, and the popover is the same one in both
 * states.
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
  const usedBytes = gpus.reduce(
    (sum, gpu) => sum + (gpu.memory_used_bytes ?? 0),
    0,
  );
  const totalBytes = gpus.reduce(
    (sum, gpu) => sum + (gpu.memory_total_bytes ?? 0),
    0,
  );
  // The grid already counts the cards, so these lines only have to add what a
  // per-card colour cannot show: the average, and the whole box's memory.
  // Whole gigabytes: eight cards summed to one decimal each is noise, and
  // "86 / 765 GB" is the reading that fits the rail.
  const gpuSummary =
    gpus.length > 1
      ? t("rail.gpuAverage", { avg: average })
      : gpus.length === 1
        ? t("rail.gpuSummaryOne", { avg: average })
        : gpuUnavailableReason(t, metrics, metricsError, backend);
  const memoryLine =
    totalBytes > 0
      ? t("rail.gpuMemory", {
          pair: formatGigabytePair(usedBytes, totalBytes, 0),
        })
      : "";
  const owned = ownedDevices(
    runtime,
    gpus.map((gpu) => gpu.index),
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <Popover>
        <PopoverTrigger asChild>
          {/* 9px of padding centres the card's 24px content column — the
              width of the heat block — in the 44px card. */}
          <button
            type="button"
            title={hint}
            className="block w-full overflow-hidden px-[9px] py-2.5 text-left transition-colors hover:bg-muted"
            aria-label={t("backend.registered")}
            aria-haspopup="dialog"
          >
            {/* The identity block: the node's tile spanning the name and the
                service state stacked beside it, tight against each other so
                the tile's height is exactly those two lines. */}
            <span className="flex items-stretch gap-2">
              <NodeAvatar name={backend?.name} tone={status?.tone} />
              <span className="flex min-w-0 flex-1 flex-col justify-center">
                <span
                  className={cn(
                    "truncate text-[13px] leading-tight font-semibold tracking-[-0.01em] transition-opacity",
                    collapsed && "opacity-0",
                  )}
                >
                  {backend?.name ?? t("backend.emptyTitle")}
                </span>
                <span
                  className={cn(
                    "truncate text-[11.5px] leading-tight text-muted-foreground transition-opacity",
                    collapsed && "opacity-0",
                  )}
                >
                  {statusLabel}
                </span>
              </span>
              <ChevronsUpDown
                className={cn(
                  "size-3.5 shrink-0 self-center text-muted-foreground transition-opacity",
                  collapsed && "opacity-0",
                )}
              />
            </span>

            {/* The heat block, with the numbers a per-cell colour cannot
                show. Same rows in both states: the collapse cuts the right
                side off, it does not take a row away. */}
            <span className="mt-2 flex items-center gap-2">
              {gpus.length > 0 ? (
                <GpuHeatGrid gpus={gpus} owned={owned} />
              ) : (
                // Keeps the block's footprint on a node whose metrics have not
                // arrived yet, so the card does not resize under the pointer.
                <span className="h-[66px] w-6" />
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    "truncate font-mono text-[10.5px] text-muted-foreground transition-opacity",
                    collapsed && "opacity-0",
                  )}
                >
                  {gpuSummary}
                </span>
                <span
                  className={cn(
                    "truncate font-mono text-[10.5px] text-muted-foreground transition-opacity",
                    collapsed && "opacity-0",
                  )}
                >
                  {memoryLine}
                </span>
              </span>
            </span>
          </button>
        </PopoverTrigger>

        <PopoverContent
          side={collapsed ? "right" : "top"}
          align="start"
          className="w-[320px] p-1.5"
        >
          {/* The card is two rows wide, so this is where the node's details
              live in both states: the same pills, the same rows and the same
              process list the card is built from. */}
          <div className="mb-1 rounded-lg border border-border bg-background">
            <div className="px-2.5 pt-2.5 pb-2">
              <div className="flex items-center gap-2">
                <NodeAvatar name={backend?.name} />
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
    </div>
  );
}

/**
 * The node's identity in one glyph: its initial in a tile. It stretches to
 * the height of the name and the service state beside it, so the tile reads
 * as one block with the two lines rather than as a 16px square floating in
 * front of them — and its width matches the heat block below. The status dot
 * rides this tile's corner in both rail states: it belongs to the node, and
 * while the rail is closed it is the only thing that carries the tone.
 */
function NodeAvatar({ name, tone }: { name?: string; tone?: StatusTone }) {
  return (
    <span className="relative w-6 shrink-0">
      <span className="flex h-full min-h-6 w-full items-center justify-center rounded-lg bg-muted text-[12px] font-semibold text-muted-foreground">
        {name ? (
          name.trim().slice(0, 1).toUpperCase()
        ) : (
          <Server className="size-3.5" />
        )}
      </span>
      {tone && (
        <StatusDot
          tone={tone}
          className="absolute -top-1 -right-1 ring-2 ring-background"
        />
      )}
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

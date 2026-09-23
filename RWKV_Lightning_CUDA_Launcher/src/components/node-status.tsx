import { Cpu } from "lucide-react";
import { Badge, StatusDot, type StatusTone } from "@/components/ui/badge";
import { Notice } from "@/components/ui/primitives";
import { formatGigabytePair, percent } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import type {
  BackendView,
  GpuMetric,
  MetricsResponse,
  RuntimeState,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * The rail rows only have ~170px; NVML reports "NVIDIA RTX … Workstation
 * Edition" in full. Drop the vendor prefix — every card on a box shares it —
 * and let truncate handle the rest.
 */
export function compactGpuName(name: string) {
  return name.replace(/^NVIDIA\s+/i, "");
}

/** `status` alone is not enough: an inference-only node is "n/a", not offline. */
export function runtimeTone(runtime?: RuntimeState): StatusTone {
  switch (runtime?.status) {
    case "ready":
      return "ok";
    case "starting":
    case "stopping":
    case "running":
      return "warn";
    case "error":
      return "bad";
    default:
      return "idle";
  }
}

/**
 * The state word alone, for rows that already name their subject (the node
 * card's "runtime" field, for instance).
 */
export function runtimeStateLabel(t: TFn, runtime?: RuntimeState) {
  if (runtime?.status === "ready") {
    // The Agent detects a runtime it did not spawn, but cannot manage it.
    return runtime.managed === false
      ? t("status.readyExternal")
      : t("status.ready");
  }
  switch (runtime?.status) {
    case "starting":
      return t("status.starting");
    case "stopping":
      return t("status.stopping");
    case "running":
      return t("status.running");
    case "error":
      return t("status.error");
    case "completed":
      return t("status.completed");
    default:
      return t("status.notStarted");
  }
}

/**
 * Subject + state, for chips that stand on their own. A bare "runtime
 * offline" in the header sat next to a node that answers every probe and read
 * as "the whole machine is down"; naming the subject keeps a not-yet-started
 * inference server distinct from an unreachable node.
 */
export function runtimeLabel(t: TFn, runtime?: RuntimeState) {
  return t("status.runtimeState", { state: runtimeStateLabel(t, runtime) });
}

/**
 * The tooltip that disambiguates the one status people misread: reachable
 * node, inference server simply not started yet.
 */
export function runtimeHint(t: TFn, runtime?: RuntimeState) {
  return !runtime || runtime.status === "offline"
    ? t("status.notStartedHint")
    : undefined;
}

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

/**
 * Overall node tone used by the rail dot and the node cards. Reachable but
 * not serving is "warn", never "idle": a grey dot next to a live node reads
 * as "no information", which is exactly the state a console exists to
 * disambiguate — the runtime text right below carries the detail.
 */
export function nodeTone(
  backend: BackendView | undefined,
  runtime?: RuntimeState,
  jobsRunning = false,
): StatusTone {
  if (!backend?.reachable) return "bad";
  if (runtime?.status === "ready") return "ok";
  if (runtime?.status === "error") return "bad";
  if (
    jobsRunning ||
    runtime?.status === "starting" ||
    runtime?.status === "stopping"
  )
    return "warn";
  if (backend.kind === "inference_only") return "info";
  return "warn";
}

/**
 * The loaded model name. `backend.model` is an untyped pass-through of the
 * native `/v1/server/status` payload, so every field is optional.
 */
export function modelName(runtime?: RuntimeState) {
  const raw = runtime?.backend?.model;
  if (raw && typeof raw === "object") {
    const model = raw as {
      name?: string;
      id?: string;
      path?: string;
      loaded?: boolean;
    };
    if (model.loaded === false) return "";
    return model.name || model.id || model.path || "";
  }
  // `config.model_path` is only what the process was *asked* to load, never
  // proof that something is serving it. Reporting it unconditionally is what
  // let an offline node render "runtime offline" and a loaded model name side
  // by side; the mockup shows "—" for that node instead. Fall back to the
  // configured path only while the runtime is actually up.
  if (runtime?.status !== "ready") return "";
  const path = runtime.config?.model_path;
  if (!path) return "";
  return (
    path
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .pop() ?? ""
  );
}

export function CapabilityBadges({
  capabilities,
  className,
}: {
  capabilities: string[];
  className?: string;
}) {
  if (capabilities.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {capabilities.map((capability) => (
        <Badge key={capability} variant="mono">
          {capability}
        </Badge>
      ))}
    </div>
  );
}

/**
 * One card per GPU, three lines tall and narrow enough that a 4- or 8-card
 * box tiles instead of scrolling: index + utilization on the headline, the
 * memory bar under it, temperature and power on the footer line. The full
 * NVML name only fits on wide cards, so it is the part allowed to truncate.
 */
export function GpuCard({ gpu }: { gpu: GpuMetric }) {
  const used = percent(gpu.memory_used_bytes, gpu.memory_total_bytes);
  const utilization = gpu.utilization_percent;
  const hot = utilization !== undefined && utilization > 85;
  return (
    <div className="rounded-lg border border-border bg-background px-2.5 py-2">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 font-mono text-[12px] font-semibold">
          #{gpu.index}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
          title={gpu.name}
        >
          {compactGpuName(gpu.name)}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] tabular-nums">
          <StatusDot tone={hot ? "warn" : "ok"} />
          {utilization !== undefined ? `${utilization}%` : "—"}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            used > 90 ? "bg-destructive" : hot ? "bg-warning" : "bg-success",
          )}
          style={{ width: `${used}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between gap-2 font-mono text-[10.5px] whitespace-nowrap tabular-nums text-muted-foreground">
        <span className="truncate">
          {formatGigabytePair(gpu.memory_used_bytes, gpu.memory_total_bytes)}
        </span>
        <span className="shrink-0">
          {gpu.temperature_c !== undefined ? `${gpu.temperature_c}°C` : "—"}
          {" · "}
          {gpu.power_watts !== undefined ? `${gpu.power_watts}W` : "—"}
        </span>
      </div>
    </div>
  );
}

/**
 * One compact per-GPU row: utilization headline, memory bar, memory/temp/
 * power line. Shared by the rail's collapsed peek and the expanded switcher
 * card (the mockup renders the identical block in both places).
 */
export function GpuMiniRows({ metrics }: { metrics: MetricsResponse }) {
  return (
    // minmax(0,1fr): an implicit auto column sizes to the nowrap name's
    // max-content and pushes the utilization/temp columns out of the card.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
      {metrics.gpus.map((gpu) => {
        const used = percent(gpu.memory_used_bytes, gpu.memory_total_bytes);
        const utilization = gpu.utilization_percent ?? 0;
        return (
          <div key={gpu.index}>
            <div className="flex justify-between gap-1.5 text-[10.5px] text-muted-foreground">
              {/* min-w-0 lets truncate win over flex's min-content size;
                  without it a long name pushes the utilization out of the card. */}
              <span className="min-w-0 truncate">
                #{gpu.index} {compactGpuName(gpu.name)}
              </span>
              <span className="shrink-0 font-mono">{utilization}%</span>
            </div>
            <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-[5px] rounded-full",
                  utilization > 85 ? "bg-warning" : "bg-success",
                )}
                style={{ width: `${used}%` }}
              />
            </div>
            {/* Both halves must stay on one line: ~158px of usable width in
                the rail leaves no room to wrap, and a wrapped row grows the
                card until it runs off the bottom of the viewport. nowrap +
                the single-unit pair keeps the worst case (3-digit watts on a
                100%-busy card) inside the box. */}
            <div className="mt-1 flex justify-between gap-1.5 font-mono text-[10px] whitespace-nowrap tabular-nums text-muted-foreground">
              <span className="truncate">
                {formatGigabytePair(
                  gpu.memory_used_bytes,
                  gpu.memory_total_bytes,
                )}
              </span>
              <span className="shrink-0">
                {gpu.temperature_c !== undefined
                  ? `${gpu.temperature_c}°C`
                  : "—"}{" "}
                · {gpu.power_watts !== undefined ? `${gpu.power_watts}W` : "—"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One cell per GPU, two to a row, so an eight-card box reads as a 2×4 grid.
 * Each cell is a gauge, not a square of colour:
 *
 * - the track (cell background) is the card's total memory, and the bar
 *   filling it from the bottom is what is allocated;
 * - the bar is solid while the card is computing and faded (~0.28) while it is
 *   only holding memory;
 * - colour is reserved for "needs handling": the outline turns amber near a
 *   limit and red at it. Nothing else in the cell is coloured, so a coloured
 *   cell always means the same thing.
 *
 * The legend also has a hatch for memory held by an outside process. The
 * metrics endpoint reports per-card totals only — nothing says who owns the
 * pages — and a 7px cell cannot resolve stripes anyway, so the channel is
 * left unused rather than guessed at.
 *
 * Two columns, not four: the block has to be exactly as wide as the node
 * avatar above it in the rail card. Matching widths is what makes the
 * collapsed card read as one centred badge instead of a tile with a wider bar
 * under it.
 *
 * The geometry is fixed on purpose: the rail card keeps this block in both
 * states, so cell size, column count and gap must not depend on rail width.
 */
export function GpuHeatGrid({
  gpus,
  owned,
}: {
  gpus: GpuMetric[];
  /** Cards whose memory belongs to the inference runtime; see ownedDevices. */
  owned: Set<number>;
}) {
  if (gpus.length === 0) return null;
  const alone = gpus.length === 1;
  return (
    <span className="grid shrink-0 grid-cols-2 auto-rows-[16px] gap-0.5">
      {gpus.map((gpu) => (
        <span
          key={gpu.index}
          title={gpuRowTitle(gpu)}
          className={cn(
            "relative overflow-hidden rounded-[2px] ring-1",
            // A single card would otherwise be one cell in the corner of the
            // block: let it fill the block, so a one-GPU node reads as one
            // gauge with the whole 70px of travel.
            alone ? "col-span-2 row-span-4 w-[26px]" : "h-4 w-3",
            attentionRing(gpu),
          )}
        >
          <span
            className={cn(
              "absolute inset-x-0 bottom-0",
              // Hatched = held by something that is not the inference service;
              // solid ink = ours. On a box whose runtime is not running, every
              // bar is hatched, which is exactly what the memory means there.
              owned.has(gpu.index) ? "bg-primary" : "hatch-foreign",
              isBusy(gpu) ? "opacity-100" : "opacity-30",
            )}
            style={{ height: `${memoryPercent(gpu)}%` }}
          />
        </span>
      ))}
    </span>
  );
}

/**
 * Which cards' memory belongs to the inference runtime.
 *
 * The metrics report per-card totals with no owner, and the launcher injects
 * the device spec when it spawns the runtime, so that spec is the only
 * ownership signal there is: memory on a card outside it — or on any card at
 * all while the runtime is not holding memory — belongs to something else.
 * A spec that is not a plain index list (GPU UUIDs, MIG selectors) cannot be
 * matched against metrics indexes, and an empty one means the child inherited
 * its view from the Agent; both are read as "the runtime owns what this box
 * shows", which is the reading that does not paint a whole box as foreign.
 */
export function ownedDevices(
  runtime: RuntimeState | undefined,
  indexes: number[],
): Set<number> {
  const holding = runtime
    ? (["ready", "starting", "running", "stopping"] as string[]).includes(
        runtime.status,
      )
    : false;
  if (!holding) return new Set();
  const spec = (runtime?.visible_devices ?? "").trim();
  if (spec === "") return new Set(indexes);
  const parsed = spec.split(",").map((part) => Number.parseInt(part.trim(), 10));
  const usable = parsed.every((n) => Number.isInteger(n) && n >= 0);
  return new Set(usable ? parsed : indexes);
}

/** Allocated fraction of the card's memory; clamped — used can exceed total. */
function memoryPercent(gpu: GpuMetric) {
  const { memory_total_bytes: total, memory_used_bytes: used } = gpu;
  if (!total || used === undefined) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

/**
 * Whether the card is doing work rather than merely holding memory. An
 * unsampleable utilization counts as busy: the card is holding memory, and
 * calling that idle is an assertion the data cannot back.
 */
function isBusy(gpu: GpuMetric) {
  return (
    gpu.utilization_percent === undefined || gpu.utilization_percent >= 5
  );
}

/**
 * The cell's only colour channel. Two tiers on each axis — memory near full
 * and cards running hot are both "needs handling", at a warning and at an
 * alarm level; red and amber are the same two tones the rest of the console
 * uses.
 */
function attentionRing(gpu: GpuMetric) {
  const memory = memoryPercent(gpu);
  const temp = gpu.temperature_c;
  if (memory >= 97 || (temp !== undefined && temp >= 92))
    return "ring-destructive";
  if (memory >= 90 || (temp !== undefined && temp >= 85)) return "ring-warning";
  return "ring-border";
}

/** The per-GPU line the compact rows used to spell out, as a cell tooltip. */
function gpuRowTitle(gpu: GpuMetric) {
  return [
    `#${gpu.index} ${compactGpuName(gpu.name)}`.trim(),
    gpu.utilization_percent !== undefined ? `${gpu.utilization_percent}%` : "—",
    formatGigabytePair(gpu.memory_used_bytes, gpu.memory_total_bytes),
    gpu.temperature_c !== undefined ? `${gpu.temperature_c}°C` : "—",
    gpu.power_watts !== undefined ? `${gpu.power_watts}W` : "—",
  ].join(" · ");
}

/**
 * GPU metrics have four distinct unavailable reasons; never render an
 * all-zero GPU list. Shared by the runtime page notice and the rail footer.
 */
export function gpuUnavailableReason(
  t: TFn,
  metrics: MetricsResponse | undefined,
  metricsError: string | undefined,
  backend: BackendView | undefined,
): string {
  return metrics?.reason
    ? metrics.reason
    : !backend?.reachable
      ? t("runtime.gpuReason.unreachable")
      : backend.kind === "inference_only"
        ? t("runtime.gpuReason.inference")
        : metricsError || t("runtime.gpuReason.unknown");
}

export function GpuList({
  metrics,
  metricsError,
  backend,
  runtime,
  t,
}: {
  metrics?: MetricsResponse;
  metricsError?: string;
  backend?: BackendView;
  runtime?: RuntimeState;
  t: TFn;
}) {
  if (metrics?.available && metrics.gpus.length > 0) {
    return (
      // Auto-fill columns: the card is legible from ~190px, so a full-width
      // panel tiles four across on a laptop and more on a workstation. An
      // 8-GPU box is then two rows, not a screen and a half of scrolling.
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        {metrics.gpus.map((gpu) => (
          <GpuCard key={gpu.index} gpu={gpu} />
        ))}
      </div>
    );
  }

  const reason = gpuUnavailableReason(t, metrics, metricsError, backend);

  return (
    <Notice tone="info" icon={<Cpu className="size-3.5" />}>
      <span className="font-medium">{t("runtime.gpuNoMetrics")}</span>
      <span className="mt-0.5 block font-mono text-[11px] break-all">
        {reason}
      </span>
      {runtime?.visible_devices ? (
        <span className="mt-1 block font-mono text-[11px]">
          visible_devices: {runtime.visible_devices || '""'}
        </span>
      ) : null}
    </Notice>
  );
}

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
 * One cell per GPU, two to a row, so an eight-card box reads as a 2×4 heat
 * grid. The colour is utilization — an idle card stays grey, because a green
 * square for 0% reads as "working" — and the numbers behind each cell (index,
 * utilization, memory) are in its tooltip, so the block never has to be
 * guessed at.
 *
 * Two columns, not four: the block has to be exactly as wide as the node
 * avatar above it in the rail card. Matching widths is what makes the
 * collapsed card read as one centred badge instead of a tile with a wider bar
 * under it, and it costs nothing — the same eight cells, larger.
 *
 * The geometry is fixed on purpose: the rail card keeps this block in both
 * states, so cell size, column count and gap must not depend on rail width.
 */
export function GpuHeatGrid({ gpus }: { gpus: GpuMetric[] }) {
  if (gpus.length === 0) return null;
  return (
    <span className="grid shrink-0 grid-cols-2 gap-0.5">
      {gpus.map((gpu) => (
        <span
          key={gpu.index}
          title={`#${gpu.index} · ${
            gpu.utilization_percent !== undefined
              ? `${gpu.utilization_percent}%`
              : "—"
          } · ${formatGigabytePair(gpu.memory_used_bytes, gpu.memory_total_bytes)}`}
          className={cn(
            "size-[7px] rounded-[2px]",
            heatTone(gpu.utilization_percent),
          )}
        />
      ))}
    </span>
  );
}

/** Three tiers on the same 85% line the GPU cards use. */
function heatTone(utilization?: number) {
  if (utilization === undefined) return "bg-muted-foreground/20";
  if (utilization > 85) return "bg-warning";
  return utilization <= 5 ? "bg-muted-foreground/40" : "bg-success";
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

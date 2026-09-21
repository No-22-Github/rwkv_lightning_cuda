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

export function runtimeLabel(t: TFn, runtime?: RuntimeState) {
  switch (runtime?.status) {
    case "ready":
      return t("status.runtimeReady");
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
      return t("status.runtimeOffline");
  }
}

/** Overall node tone used by the rail dot and the node cards. */
export function nodeTone(
  backend: BackendView | undefined,
  runtime?: RuntimeState,
  jobsRunning = false,
): StatusTone {
  if (!backend?.reachable) return "bad";
  if (runtime?.status === "ready") return "ok";
  if (jobsRunning || runtime?.status === "starting" || runtime?.status === "stopping")
    return "warn";
  if (backend.kind === "inference_only") return "info";
  return "idle";
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
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
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

export function GpuCard({ gpu }: { gpu: GpuMetric }) {
  const used = percent(gpu.memory_used_bytes, gpu.memory_total_bytes);
  const utilization = gpu.utilization_percent;
  const hot = utilization !== undefined && utilization > 85;
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[12.5px] font-medium">
          #{gpu.index} · {compactGpuName(gpu.name)}
        </span>
        <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
          {gpu.temperature_c !== undefined ? `${gpu.temperature_c}°C` : "—"}
          {" · "}
          {gpu.power_watts !== undefined ? `${gpu.power_watts}W` : "—"}
        </span>
      </div>
      <div className="mt-2.5 flex items-center gap-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              used > 90 ? "bg-destructive" : hot ? "bg-warning" : "bg-success",
            )}
            style={{ width: `${used}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-[11.5px] whitespace-nowrap tabular-nums text-muted-foreground">
          {formatGigabytePair(gpu.memory_used_bytes, gpu.memory_total_bytes)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
        <StatusDot tone={hot ? "warn" : "ok"} />
        {utilization !== undefined ? `${utilization}%` : "—"}
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
                ·{" "}
                {gpu.power_watts !== undefined ? `${gpu.power_watts}W` : "—"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
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
        : backend.legacy
          ? t("runtime.gpuReason.legacy")
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
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
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

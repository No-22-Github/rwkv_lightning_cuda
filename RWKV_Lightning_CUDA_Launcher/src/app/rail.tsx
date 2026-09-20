import { useState, type ReactNode } from "react";
import {
  Boxes,
  Database,
  Languages,
  MessageSquare,
  PanelLeft,
  Play,
  RotateCcw,
  Settings,
  Square,
  TrendingUp,
} from "lucide-react";
import { BackendSwitcher } from "@/app/backend-switcher";
import { useCurrent } from "@/app/use-current";
import { RuntimeBadge } from "@/components/runtime-controls";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { applyDevice } from "@/lib/api/launcher";
import { formatGigabytes } from "@/lib/format";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { navigate, useRoute, type Route } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useRuntimeForm } from "@/stores/forms";
import { useNodes } from "@/stores/nodes";
import { toast, useRail } from "@/stores/ui";

interface NavItem {
  route: Route;
  label: MessageKey;
  icon: typeof Boxes;
}

const SECTIONS: { title: MessageKey; items: NavItem[] }[] = [
  {
    title: "nav.overview",
    items: [{ route: "nodes", label: "nav.nodes", icon: Boxes }],
  },
  {
    title: "nav.inference",
    items: [
      { route: "chat", label: "nav.chat", icon: MessageSquare },
      { route: "translate", label: "nav.translate", icon: Languages },
    ],
  },
  {
    title: "nav.operations",
    items: [
      { route: "runtime", label: "nav.runtime", icon: Play },
      { route: "training", label: "nav.training", icon: TrendingUp },
      { route: "quant", label: "nav.quantization", icon: Database },
    ],
  },
];

export function Rail() {
  const { t } = useI18n();
  const route = useRoute();
  const collapsed = useRail((s) => s.collapsed);
  const { jobs } = useCurrent();
  const trainingRunning = Boolean(jobs?.tuning?.running);

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col gap-0.5 border-r border-border bg-card p-2.5 transition-[width] duration-200",
        collapsed ? "w-14" : "w-[216px]",
      )}
    >
      {SECTIONS.map((section) => (
        <div key={section.title} className="contents">
          <p
            className={cn(
              "overflow-hidden px-2 pt-3.5 pb-1 text-[10.5px] font-semibold tracking-[0.06em] whitespace-nowrap text-muted-foreground transition-opacity",
              collapsed ? "opacity-0" : "opacity-100",
            )}
          >
            {t(section.title)}
          </p>
          {section.items.map((item) => (
            <NavButton
              key={item.route}
              item={item}
              active={route === item.route}
              collapsed={collapsed}
              dot={
                item.route === "runtime" ? (
                  <RuntimeDot />
                ) : item.route === "training" && trainingRunning ? (
                  <StatusDot tone="warn" pulse />
                ) : undefined
              }
            />
          ))}
        </div>
      ))}

      <div className="min-h-3.5 flex-1" />

      <NavButton
        item={{ route: "settings", label: "nav.settings", icon: Settings }}
        active={route === "settings"}
        collapsed={collapsed}
      />

      <div className="relative mt-2">
        {collapsed ? <CollapsedFooter /> : <BackendSwitcher />}
      </div>
    </aside>
  );
}

function NavButton({
  item,
  active,
  collapsed,
  dot,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  dot?: ReactNode;
}) {
  const { t } = useI18n();
  const Icon = item.icon;
  return (
    <button
      type="button"
      title={collapsed ? t(item.label) : undefined}
      onClick={() => navigate(item.route)}
      className={cn(
        "flex items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2 text-left text-[13px] font-medium whitespace-nowrap transition-colors",
        active ? "bg-accent text-foreground" : "text-foreground hover:bg-muted",
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>}
      {dot}
    </button>
  );
}

function RuntimeDot() {
  const { runtime, backend } = useCurrent();
  const tone = !backend?.reachable
    ? "bad"
    : runtime?.status === "ready"
      ? "ok"
      : runtime?.status === "starting" || runtime?.status === "stopping"
        ? "warn"
        : "idle";
  return <StatusDot tone={tone} />;
}

/** Collapsed rail keeps the node identity and a GPU peek on hover. */
function CollapsedFooter() {
  const { t } = useI18n();
  const { backendId, backend, runtime, metrics, hasAgent, busy } = useCurrent();
  const form = useRuntimeForm((s) => s.config);
  const devices = useRuntimeForm((s) => s.devices);
  const start = useNodes((s) => s.startRuntime);
  const stop = useNodes((s) => s.stopRuntime);
  const restart = useNodes((s) => s.restartRuntime);
  const toggle = useRail((s) => s.toggle);
  const [peek, setPeek] = useState(false);
  const gpus = metrics?.available ? metrics.gpus : [];
  const disabled = !backendId || !hasAgent || !backend?.reachable;

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

  return (
    <div className="grid gap-2">
      <Popover open={peek} onOpenChange={setPeek}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="rounded-xl border border-border bg-background px-2 py-2.5 transition-colors hover:bg-muted"
            aria-label={t("backend.registered")}
          >
            <span
              className={cn(
                "mx-auto mb-2 block size-[5px] rounded-full",
                backend?.reachable
                  ? runtime?.status === "ready"
                    ? "bg-success"
                    : "bg-muted-foreground/50"
                  : "bg-destructive",
              )}
            />
            <span className="flex h-14 items-end justify-center gap-1.5">
              {gpus.length > 0 ? (
                gpus.slice(0, 4).map((gpu) => {
                  const util = gpu.utilization_percent ?? 0;
                  return (
                    <span
                      key={gpu.index}
                      className="flex h-14 w-[5px] items-end overflow-hidden rounded-full bg-muted"
                    >
                      <span
                        className={cn(
                          "block w-[5px] rounded-full",
                          util > 85 ? "bg-warning" : "bg-success",
                        )}
                        style={{ height: `${Math.max(util, 2)}%` }}
                      />
                    </span>
                  );
                })
              ) : (
                <span className="block h-14 w-[5px] rounded-full bg-muted" />
              )}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" className="w-[250px]">
          <div className="border-b border-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <StatusDot
                tone={backend?.reachable ? "ok" : "bad"}
                className="shrink-0"
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                {backend?.name ?? "—"}
              </span>
            </div>
            <p className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground">
              {backend?.base_url ?? "—"}
            </p>
          </div>
          {gpus.length > 0 ? (
            <div className="grid gap-2.5 px-3 py-2.5">
              {gpus.map((gpu) => {
                const used =
                  gpu.memory_total_bytes > 0
                    ? Math.round(
                        (gpu.memory_used_bytes / gpu.memory_total_bytes) * 100,
                      )
                    : 0;
                return (
                  <div key={gpu.index}>
                    <div className="flex justify-between gap-1.5 text-[10.5px] text-muted-foreground">
                      <span className="truncate">
                        #{gpu.index} {gpu.name}
                      </span>
                      <span className="shrink-0 font-mono">
                        {gpu.utilization_percent ?? 0}%
                      </span>
                    </div>
                    <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-[5px] rounded-full",
                          (gpu.utilization_percent ?? 0) > 85
                            ? "bg-warning"
                            : "bg-success",
                        )}
                        style={{ width: `${used}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
                      <span>
                        {formatGigabytes(gpu.memory_used_bytes)} /{" "}
                        {formatGigabytes(gpu.memory_total_bytes)}
                      </span>
                      <span>
                        {gpu.temperature_c !== undefined
                          ? `${gpu.temperature_c}°C`
                          : "—"}{" "}
                        ·{" "}
                        {gpu.power_watts !== undefined
                          ? `${gpu.power_watts}W`
                          : "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-3 py-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
              {t("runtime.gpuNoMetrics")}
            </p>
          )}
          <div className="flex gap-1.5 border-t border-border p-2">
            <Button
              size="xs"
              variant="default"
              disabled={disabled || busy || runtime?.running || !form.model_path.trim()}
              onClick={() =>
                void run(
                  () => start(backendId, applyDevice({ ...form }, devices)),
                  t("runtime.started"),
                )
              }
            >
              <Play className="size-3" />
            </Button>
            <Button
              size="xs"
              disabled={disabled || busy || !runtime?.running}
              onClick={() => void run(() => stop(backendId), t("runtime.stopped"))}
            >
              <Square className="size-3" />
            </Button>
            <Button
              size="xs"
              disabled={disabled || busy || !runtime?.running}
              onClick={() =>
                void run(() => restart(backendId), t("runtime.restarted"))
              }
            >
              <RotateCcw className="size-3" />
            </Button>
            <div className="flex-1" />
            <Button
              size="xs"
              onClick={() => {
                setPeek(false);
                toggle();
              }}
            >
              <PanelLeft className="size-3" />
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function RailToggle() {
  const { t } = useI18n();
  const toggle = useRail((s) => s.toggle);
  return (
    <Button
      size="icon-sm"
      variant="outline"
      title={t("header.toggleSidebar")}
      onClick={toggle}
    >
      <PanelLeft className="size-3.5" />
    </Button>
  );
}

export { RuntimeBadge };

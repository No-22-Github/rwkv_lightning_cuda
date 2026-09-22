import { useState, type ReactNode } from "react";
import {
  Archive,
  ChartLine,
  Cpu,
  Languages,
  MessageSquare,
  PanelLeft,
  Server,
  Settings2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BackendSwitcher } from "@/app/backend-switcher";
import { useCurrent } from "@/app/use-current";
import { NodeProcessList } from "@/components/node-processes";
import { gpuUnavailableReason, GpuMiniRows } from "@/components/node-status";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { navigate, useRoute, type Route } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useBackends } from "@/stores/backends";
import { useRail } from "@/stores/ui";

interface NavItem {
  route: Route;
  label: MessageKey;
  icon: LucideIcon;
}

const SECTIONS: { title: MessageKey; items: NavItem[] }[] = [
  {
    title: "nav.overview",
    items: [{ route: "nodes", label: "nav.nodes", icon: Server }],
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
      { route: "runtime", label: "nav.runtime", icon: Cpu },
      { route: "training", label: "nav.training", icon: ChartLine },
      { route: "quant", label: "nav.quantization", icon: Archive },
    ],
  },
];

export function Rail() {
  const { t } = useI18n();
  const route = useRoute();
  const collapsed = useRail((s) => s.collapsed);
  const backendCount = useBackends((s) => s.list.length);
  const { jobs } = useCurrent();
  const trainingRunning = Boolean(jobs?.tuning?.running);

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col border-r border-border bg-card p-2.5 transition-[width] duration-200",
        collapsed ? "w-14" : "w-[216px]",
      )}
    >
      {/* The node card at the bottom is the one control that must never be
          pushed off a short window, so the nav scrolls and the card stays. */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto">
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
                count={item.route === "nodes" ? backendCount : undefined}
                dot={
                  item.route === "runtime" ? (
                    <RuntimeDot />
                  ) : item.route === "training" && trainingRunning ? (
                    // Steady, not pulsing: training runs for hours.
                    <StatusDot tone="warn" />
                  ) : undefined
                }
              />
            ))}
          </div>
        ))}
      </div>

      {/* flex, like the scrolling nav above: a <button> is a form control, so
          width:auto shrinks it to its label. Only the stretch of a flex
          column made the nav rows full width, which is why Settings came out
          a size smaller once it moved into this block. */}
      <div className="flex shrink-0 flex-col pt-2">
        <NavButton
          item={{ route: "settings", label: "nav.settings", icon: Settings2 }}
          active={route === "settings"}
          collapsed={collapsed}
        />
        <div className="relative mt-2">
          {collapsed ? <CollapsedFooter /> : <BackendSwitcher />}
        </div>
      </div>
    </aside>
  );
}

function NavButton({
  item,
  active,
  collapsed,
  count,
  dot,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  count?: number;
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
      {!collapsed && (
        <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
      )}
      {!collapsed && count ? (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {count}
        </span>
      ) : null}
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
  const { backend, runtime, metrics, metricsError } = useCurrent();
  const toggle = useRail((s) => s.toggle);
  const [peek, setPeek] = useState(false);
  const gpus = metrics?.available ? metrics.gpus : [];

  // A collapsed rail is 56px wide, ~24px of it drawable: one bar per card
  // overflowed the rail the moment a box had more than three GPUs. Aggregate
  // instead — average fill, peak colour, card count — and leave the per-card
  // detail to the peek popover, which is where it is readable anyway.
  const utilization = gpus.map((gpu) => gpu.utilization_percent ?? 0);
  const average = utilization.length
    ? Math.round(
        utilization.reduce((sum, u) => sum + u, 0) / utilization.length,
      )
    : 0;
  const peak = utilization.length ? Math.max(...utilization) : 0;
  const gpuSummary =
    gpus.length > 1
      ? t("rail.gpuSummary", { count: gpus.length, avg: average })
      : gpus.length === 1
        ? t("rail.gpuSummaryOne", { avg: average })
        : gpuUnavailableReason(t, metrics, metricsError, backend);

  return (
    <div className="grid gap-2">
      <Popover open={peek} onOpenChange={setPeek}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={`${backend?.name ?? ""} · ${gpuSummary}`.replace(/^ · /, "")}
            className="w-full overflow-hidden rounded-xl border border-border bg-background px-1.5 py-2.5 transition-colors hover:bg-muted"
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
            <span className="mx-auto flex h-12 w-1.5 items-end overflow-hidden rounded-full bg-muted">
              {gpus.length > 0 && (
                <span
                  className={cn(
                    "block w-1.5 rounded-full",
                    peak > 85 ? "bg-warning" : "bg-success",
                  )}
                  style={{ height: `${Math.max(average, 2)}%` }}
                />
              )}
            </span>
            <span className="mt-1.5 block text-center font-mono text-[9px] leading-none tabular-nums text-muted-foreground">
              {gpus.length > 0 ? gpus.length : "—"}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" className="w-[300px]">
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
          {metrics?.available && gpus.length > 0 ? (
            // An 8-GPU box would otherwise grow the popover past the viewport.
            <div className="max-h-[248px] overflow-x-hidden overflow-y-auto px-3 py-2.5">
              <GpuMiniRows metrics={metrics} />
            </div>
          ) : (
            <p className="px-3 py-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
              {gpuUnavailableReason(t, metrics, metricsError, backend)}
            </p>
          )}
          {/* The same three process rows the header menu shows: one
              implementation of "start this / stop that", wherever it is
              reached from. */}
          <div className="border-t border-border">
            <NodeProcessList />
          </div>
          <div className="flex border-t border-border p-2">
            <div className="flex-1" />
            <Button
              size="xs"
              title={t("header.expandSidebar")}
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

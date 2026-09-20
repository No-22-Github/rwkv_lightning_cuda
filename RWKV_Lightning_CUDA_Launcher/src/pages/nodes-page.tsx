import { useEffect } from "react";
import {
  Boxes,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import {
  CapabilityBadges,
  modelName,
  nodeTone,
  runtimeLabel,
} from "@/components/node-status";
import { PageHeader } from "@/components/common";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { EmptyState, Notice, StatCard } from "@/components/ui/primitives";
import { formatRelativeTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { backendKindLabel, useBackends } from "@/stores/backends";
import { useNodes } from "@/stores/nodes";
import { toast, useUI } from "@/stores/ui";

export function NodesPage() {
  const { t } = useI18n();
  const list = useBackends((s) => s.list);
  const loaded = useBackends((s) => s.loaded);
  const listError = useBackends((s) => s.error);
  const currentId = useBackends((s) => s.currentId);
  const probeAll = useBackends((s) => s.probeAll);
  const refresh = useBackends((s) => s.refresh);
  const refreshAll = useNodes((s) => s.refreshAll);
  const snapshots = useNodes((s) => s.snapshots);
  const openAddBackend = useUI((s) => s.openAddBackend);

  // The overview needs every node's runtime + job state, not just the active one.
  useEffect(() => {
    const controller = new AbortController();
    void refreshAll(controller.signal);
    const timer = window.setInterval(() => void refreshAll(), 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refreshAll, list.length]);

  const reachable = list.filter((b) => b.reachable).length;
  const ready = list.filter((b) => snapshots[b.id]?.runtime?.status === "ready").length;
  const jobCount = list.filter(
    (b) =>
      snapshots[b.id]?.jobs?.tuning?.running ||
      snapshots[b.id]?.jobs?.quantization?.running,
  ).length;

  return (
    <div className="mx-auto max-w-[1240px] px-6 pt-5.5 pb-10">
      <PageHeader
        title={t("nodes.title")}
        description={t("nodes.subtitle")}
        actions={
          <>
            <Button
              disabled={list.length === 0}
              onClick={async () => {
                await probeAll();
                await refresh();
                toast.success(t("backend.probeAll"));
              }}
            >
              <RefreshCw className="size-3.5" />
              {t("backend.probeAll")}
            </Button>
            <Button variant="default" onClick={openAddBackend}>
              <Plus className="size-3.5" />
              {t("nodes.addBackend")}
            </Button>
          </>
        }
      />

      {listError && (
        <Notice tone="danger" className="mt-5">
          {listError}
        </Notice>
      )}

      <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <StatCard label={t("nodes.registered")} value={list.length} />
        <StatCard label={t("nodes.reachable")} value={reachable} tone="success" />
        <StatCard label={t("nodes.runtimeReady")} value={ready} />
        <StatCard
          label={t("nodes.runningJobs")}
          value={jobCount}
          tone="warning"
        />
      </div>

      {loaded && list.length === 0 ? (
        <EmptyState
          className="mt-5"
          icon={<Server className="size-7" strokeWidth={1.5} />}
          title={t("backend.emptyTitle")}
          body={t("backend.emptyBody")}
          action={
            <Button variant="default" onClick={openAddBackend}>
              <Plus className="size-3.5" />
              {t("nodes.addBackend")}
            </Button>
          }
        />
      ) : (
        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-3.5">
          {list.map((backend) => {
            const snapshot = snapshots[backend.id];
            const runtime = snapshot?.runtime;
            const tone = nodeTone(backend, runtime);
            const model = modelName(runtime);
            const job = snapshot?.jobs?.tuning?.running
              ? `tuning · ${progressLabel(snapshot.jobs.tuning.progress)}`
              : snapshot?.jobs?.quantization?.running
                ? `quantization · ${progressLabel(snapshot.jobs.quantization.progress)}`
                : "";
            return (
              <Card key={backend.id} className="flex flex-col overflow-hidden">
                <CardHeader>
                  <StatusDot tone={tone} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold tracking-[-0.01em]">
                        {backend.name}
                      </span>
                      {backend.id === currentId && (
                        <Badge variant="info">{t("settings.currentNode")}</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {backend.base_url}
                    </div>
                  </div>
                  <Badge>
                    {backendKindLabel(backend.kind, backend.legacy) ||
                      t("backend.kind.unknown")}
                  </Badge>
                </CardHeader>

                <CardContent className="grid flex-1 gap-2.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="min-w-0">
                      <div className="text-[11px] text-muted-foreground">
                        {t("nodes.runtime")}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[12.5px]">
                        {backend.reachable
                          ? runtimeLabel(t, runtime)
                          : t("status.unreachable")}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] text-muted-foreground">
                        {t("nodes.model")}
                      </div>
                      <div
                        className="mt-0.5 truncate font-mono text-[12.5px]"
                        title={model}
                      >
                        {model || "—"}
                      </div>
                    </div>
                  </div>

                  <CapabilityBadges capabilities={backend.capabilities} />

                  {job && (
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2">
                      <StatusDot tone="warn" pulse />
                      <span className="truncate font-mono text-xs">{job}</span>
                    </div>
                  )}

                  {!backend.reachable && backend.probe_error && (
                    <div className="rounded-lg border border-destructive px-2.5 py-2">
                      <div className="text-[11.5px] font-semibold text-destructive">
                        {t("nodes.probeFailed")}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] break-all text-muted-foreground">
                        {backend.probe_error}
                      </div>
                    </div>
                  )}
                </CardContent>

                <CardFooter className="mt-auto">
                  <span className="flex-1 text-[11px] text-muted-foreground">
                    {t("backend.lastProbe")}{" "}
                    {backend.last_probe
                      ? formatRelativeTime(backend.last_probe)
                      : t("backend.never")}
                  </span>
                  <ProbeButton id={backend.id} name={backend.name} />
                  <Button
                    size="xs"
                    disabled={backend.id === currentId}
                    onClick={() => useBackends.getState().select(backend.id)}
                  >
                    {t("backend.switchTo")}
                  </Button>
                  <RemoveButton
                    id={backend.id}
                    name={backend.name}
                    disabled={backend.id === "local"}
                  />
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {list.length > 0 && (
        <p className="mt-4 flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <Boxes className="size-3.5" />
          {t("nodes.unreachableHint")}
        </p>
      )}
    </div>
  );
}

function progressLabel(
  progress: { step?: number; total?: number } | null | undefined,
) {
  if (!progress?.step) return "running";
  return progress.total ? `step ${progress.step}/${progress.total}` : `step ${progress.step}`;
}

function ProbeButton({ id, name }: { id: string; name: string }) {
  const { t } = useI18n();
  const probe = useBackends((s) => s.probe);
  const refresh = useNodes((s) => s.refresh);
  return (
    <Button
      size="xs"
      onClick={async () => {
        try {
          const view = await probe(id);
          await refresh(id);
          if (view.reachable) toast.success(t("backend.probed", { name }));
          else
            toast.error(
              t("backend.probeFailed", {
                error: view.probe_error || t("common.unknown"),
              }),
            );
        } catch (error) {
          toast.error(
            t("toast.failed", {
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }}
    >
      {t("backend.probe")}
    </Button>
  );
}

function RemoveButton({
  id,
  name,
  disabled,
}: {
  id: string;
  name: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const remove = useBackends((s) => s.remove);
  const refresh = useBackends((s) => s.refresh);
  return (
    <Button
      size="xs"
      variant="danger"
      disabled={disabled}
      title={disabled ? t("backend.localReserved") : t("backend.remove")}
      onClick={async () => {
        if (!window.confirm(t("backend.removeConfirm", { name }))) return;
        try {
          await remove(id);
          await refresh();
          toast.success(t("backend.removed", { name }));
        } catch (error) {
          toast.error(
            t("toast.failed", {
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}

/** Shared "no node selected" placeholder used by the operation pages. */
export function NoNodeNotice() {
  const { t } = useI18n();
  const backendId = useBackends((s) => s.currentId);
  const loading = useBackends((s) => s.loading);
  if (backendId) return null;
  return (
    <Notice tone="info" className="mt-5">
      <span className="inline-flex items-center gap-2">
        {loading && <Loader2 className="size-3.5 animate-spin" />}
        {t("backend.emptyTitle")}
      </span>
    </Notice>
  );
}

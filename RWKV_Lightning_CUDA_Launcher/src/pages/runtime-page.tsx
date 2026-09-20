import { useEffect, useState } from "react";
import { HardDrive, Info, Loader2, MonitorPlay } from "lucide-react";
import { useCurrent } from "@/app/use-current";
import { PageHeader, PathField } from "@/components/common";
import { LogViewer } from "@/components/log-viewer";
import { GpuList, modelName, runtimeLabel, runtimeTone } from "@/components/node-status";
import { RuntimeControls } from "@/components/runtime-controls";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckboxField, Field } from "@/components/ui/field";
import { Input, MonoInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Notice } from "@/components/ui/primitives";
import { inferenceApi } from "@/lib/api/inference";
import type { DeviceSelection } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n";
import { useRuntimeForm } from "@/stores/forms";
import { useLogs, useLogStream } from "@/stores/logs";
import { useNodes } from "@/stores/nodes";
import { toast } from "@/stores/ui";
import { NoNodeNotice } from "@/pages/nodes-page";

export function RuntimePage() {
  const { t } = useI18n();
  const {
    backendId,
    backend,
    runtime,
    metrics,
    metricsError,
    error,
    hasAgent,
  } = useCurrent();
  const config = useRuntimeForm((s) => s.config);
  const devices = useRuntimeForm((s) => s.devices);
  const set = useRuntimeForm((s) => s.set);
  const setDevices = useRuntimeForm((s) => s.setDevices);
  const logs = useLogStream(backendId, "runtime");
  const openLogs = useLogs((s) => s.open);
  const closeLogs = useLogs((s) => s.close);

  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loadingModel, setLoadingModel] = useState(false);

  // Live runtime logs while this page is mounted.
  useEffect(() => {
    if (!backendId || !hasAgent) return;
    openLogs(backendId, "runtime");
    return () => closeLogs(backendId, "runtime");
  }, [backendId, hasAgent, openLogs, closeLogs]);

  // Adopt the running configuration once, so a page reload shows what the
  // process is actually using. The password is never echoed by the Agent.
  useEffect(() => {
    if (!runtime?.config) return;
    if (config.model_path) return;
    set({ ...runtime.config, password: config.password });
  }, [runtime?.config, config.model_path, config.password, set]);

  const dynamicReady =
    runtime?.status === "ready" && config.enable_dynamic_loading;

  useEffect(() => {
    if (!dynamicReady || !backendId) return;
    const controller = new AbortController();
    void inferenceApi
      .models(backendId, controller.signal)
      .then((response) => {
        setModels(
          response.available ?? response.data.map((entry) => entry.id),
        );
        setSelectedModel(response.loaded ?? "");
      })
      .catch(() => setModels([]));
    return () => controller.abort();
  }, [dynamicReady, backendId]);

  const inferenceOnly = backend?.kind === "inference_only";

  return (
    <div className="mx-auto max-w-[1240px] px-6 pt-5.5 pb-10">
      <PageHeader
        eyebrow={backend?.name ?? "—"}
        title={t("runtime.title")}
        description={t("runtime.subtitle")}
        actions={hasAgent ? <RuntimeControls size="default" /> : undefined}
      />

      <NoNodeNotice />

      {inferenceOnly && (
        <Notice tone="info" className="mt-5" icon={<Info className="size-3.5" />}>
          {t("runtime.unsupported")}
        </Notice>
      )}

      {error && (
        <Notice tone="danger" className="mt-5">
          {error}
        </Notice>
      )}

      <div className="mt-4.5 flex flex-wrap items-center gap-x-0 gap-y-2 rounded-xl border border-border bg-card px-3.5 py-3">
        <StatusPill
          tone={backend?.reachable ? "ok" : "bad"}
          label={t("runtime.nodeReachable")}
        />
        <Connector />
        <StatusPill
          tone={runtimeTone(runtime)}
          label={runtimeLabel(t, runtime)}
        />
        <Connector />
        <StatusPill
          tone={runtime?.status === "ready" ? "ok" : "idle"}
          label={modelName(runtime) || t("status.noModel")}
          mono
        />
        {runtime?.visible_devices ? (
          <>
            <Connector />
            <StatusPill
              tone="info"
              label={`${t("runtime.visibleDevices")}: ${
                runtime.visible_devices || '""'
              }`}
              mono
            />
          </>
        ) : null}
        <div className="flex-1" />
        <span className="text-[11.5px] text-muted-foreground">
          {t("runtime.polling")}
        </span>
      </div>

      <div className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(330px,1fr))] gap-3.5">
        <Card>
          <CardHeader>
            <CardTitle>{t("runtime.model")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3.5">
            <PathField
              label={t("runtime.modelPath")}
              value={config.model_path}
              placeholder={
                config.enable_dynamic_loading
                  ? "/data/models"
                  : "/data/models/model.pth"
              }
              backendId={backendId}
              hostDialog={backend?.capabilities.includes("host_dialog")}
              onChange={(model_path) => set({ model_path })}
            />
            <Field label={t("runtime.vocab")}>
              <MonoInput
                value={config.vocab_path}
                onChange={(event) => set({ vocab_path: event.target.value })}
              />
            </Field>
            <CheckboxField
              label={t("runtime.dynamicLoading")}
              checked={config.enable_dynamic_loading}
              onChange={(event) =>
                set({ enable_dynamic_loading: event.target.checked })
              }
            />

            {dynamicReady && (
              <div className="grid gap-2 border-t border-border pt-3.5">
                <Field label={t("runtime.model")}>
                  <div className="flex gap-2">
                    <Select
                      value={selectedModel}
                      onChange={(event) => setSelectedModel(event.target.value)}
                    >
                      <option value="">—</option>
                      {models.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </Select>
                    <Button
                      disabled={!selectedModel || loadingModel}
                      onClick={async () => {
                        setLoadingModel(true);
                        try {
                          await useNodes
                            .getState()
                            .loadModel(backendId, selectedModel);
                          toast.success(t("settings.saved"));
                        } catch (caught) {
                          toast.error(
                            t("toast.failed", {
                              error:
                                caught instanceof Error
                                  ? caught.message
                                  : String(caught),
                            }),
                          );
                        } finally {
                          setLoadingModel(false);
                        }
                      }}
                    >
                      {loadingModel ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <MonitorPlay className="size-3.5" />
                      )}
                      {t("runtime.model")}
                    </Button>
                  </div>
                </Field>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("runtime.device")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3.5">
            <Field label="visible_devices" hint={t("runtime.deviceHint")}>
              <div className="grid gap-2">
                <Select
                  value={devices.mode}
                  onChange={(event) => {
                    const mode = event.target.value as DeviceSelection["mode"];
                    if (mode === "explicit")
                      setDevices({
                        mode: "explicit",
                        value:
                          devices.mode === "explicit" ? devices.value : "0",
                      });
                    else setDevices({ mode } as DeviceSelection);
                  }}
                >
                  <option value="inherit">{t("runtime.deviceInherit")}</option>
                  <option value="none">{t("runtime.deviceNone")}</option>
                  <option value="explicit">
                    {t("runtime.deviceExplicit")}
                  </option>
                </Select>
                {devices.mode === "explicit" && (
                  <MonoInput
                    value={devices.value}
                    placeholder="0,1"
                    onChange={(event) =>
                      setDevices({ mode: "explicit", value: event.target.value })
                    }
                  />
                )}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("runtime.port")}>
                <MonoInput
                  type="number"
                  min={1}
                  max={65535}
                  value={config.port}
                  onChange={(event) => set({ port: event.target.value })}
                />
              </Field>
              <Field label={t("runtime.password")} hint={t("runtime.passwordHint")}>
                <Input
                  type="password"
                  autoComplete="off"
                  value={config.password}
                  onChange={(event) => set({ password: event.target.value })}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("runtime.performance")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3.5">
            <Field label={t("runtime.chunkSize")}>
              <MonoInput
                type="number"
                min={0}
                value={config.chunk_size}
                onChange={(event) =>
                  set({ chunk_size: Number(event.target.value) })
                }
              />
            </Field>
            <div className="grid gap-2.5">
              <CheckboxField
                label={t("runtime.chunkLoad")}
                hint={t("runtime.chunkLoadHint")}
                checked={config.chunk_load}
                onChange={(event) => set({ chunk_load: event.target.checked })}
              />
              <CheckboxField
                label={t("runtime.wkv32")}
                hint={t("runtime.wkv32Hint")}
                checked={config.use_wkv32}
                onChange={(event) => set({ use_wkv32: event.target.checked })}
              />
            </div>
            <Field label={t("runtime.stateDb")}>
              <MonoInput
                value={config.state_db_path}
                onChange={(event) => set({ state_db_path: event.target.value })}
              />
            </Field>
            <Field label={t("runtime.tuneCache")}>
              <MonoInput
                value={config.tune_cache}
                placeholder={t("runtime.tuneCacheHint")}
                onChange={(event) => set({ tune_cache: event.target.value })}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>GPU</CardTitle>
            <div className="flex-1" />
            <span className="font-mono text-[11px] text-muted-foreground">
              /api/v1/node/metrics
            </span>
          </CardHeader>
          <CardContent>
            <GpuList
              metrics={metrics}
              metricsError={metricsError}
              backend={backend}
              runtime={runtime}
              t={t}
            />
          </CardContent>
        </Card>
      </div>

      <Notice tone="info" className="mt-3.5" icon={<HardDrive className="size-3.5" />}>
        {t("runtime.startHint")}
      </Notice>

      <LogViewer
        className="mt-3.5"
        lines={logs.lines}
        title={t("runtime.logs")}
        endpoint="/api/v1/runtime/logs"
        bodyClassName="max-h-[260px]"
      />
    </div>
  );
}

function StatusPill({
  tone,
  label,
  mono,
}: {
  tone: "ok" | "warn" | "bad" | "info" | "idle";
  label: string;
  mono?: boolean;
}) {
  return (
    <span className="flex items-center gap-2 px-3.5 first:pl-0">
      <StatusDot tone={tone} />
      <span
        className={
          mono
            ? "max-w-[280px] truncate font-mono text-[12.5px] font-medium"
            : "text-[12.5px] font-medium"
        }
      >
        {label}
      </span>
    </span>
  );
}

function Connector() {
  return <span className="hidden h-px w-5.5 bg-border sm:block" />;
}

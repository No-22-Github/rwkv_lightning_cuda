import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Play, Square, TriangleAlert } from "lucide-react";
import { useCurrent } from "@/app/use-current";
import { CopyButton, PageHeader, PathField } from "@/components/common";
import { LogViewer } from "@/components/log-viewer";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckboxField, Field, Segmented } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Metric, Notice, Progress } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { applyDevice, defaultTuning } from "@/lib/api/launcher";
import { MISS_TARGETS } from "@/lib/api/types";
import type {
  DeviceSelection,
  TuningConfig,
  TuningMethod,
} from "@/lib/api/types";
import { basename, formatCount, formatDuration, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { hasCapability } from "@/stores/backends";
import {
  resetTuningParameters,
  useTuningForm,
  useTuningFormEntry,
} from "@/stores/forms";
import { useLogs, useLogStream } from "@/stores/logs";
import { useNodeBusy, useNodes } from "@/stores/nodes";
import { toast } from "@/stores/ui";

const LOG_ENDPOINT = "/api/v1/jobs/tuning/logs";

/** MiSS is adam-only; `state` keeps whatever the user picked. */
function effectiveOptimizer(config: TuningConfig): TuningConfig["optimizer"] {
  return config.method === "miss" ? "adam" : config.optimizer;
}

/** `{mode}` is a three-state union: never collapse it into one string. */
function DeviceField({
  label,
  selection,
  onChange,
  className,
}: {
  label: string;
  selection: DeviceSelection;
  onChange: (selection: DeviceSelection) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const current = selection.mode === "explicit" ? selection.value : "";
  return (
    <Field label={label} hint={t("runtime.deviceHint")} className={className}>
      <div className="grid gap-2">
        <Select
          value={selection.mode}
          onChange={(event) => {
            const mode = event.target.value;
            if (mode === "explicit") onChange({ mode: "explicit", value: current });
            else if (mode === "none") onChange({ mode: "none" });
            else onChange({ mode: "inherit" });
          }}
        >
          <option value="inherit">{t("runtime.deviceInherit")}</option>
          <option value="none">{t("runtime.deviceNone")}</option>
          <option value="explicit">{t("runtime.deviceExplicit")}</option>
        </Select>
        {selection.mode === "explicit" && (
          <Input
            value={selection.value}
            placeholder="0"
            onChange={(event) =>
              onChange({ mode: "explicit", value: event.target.value })
            }
            className="font-mono text-xs"
          />
        )}
      </div>
    </Field>
  );
}

/** One of the 01–04 pipeline cards: glyph + step name + live value. */
function StepCard({
  step,
  label,
  value,
  done,
  running,
}: {
  step: string;
  label: string;
  value: string;
  done: boolean;
  running?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
      {running ? (
        <StatusDot tone="warn" pulse />
      ) : (
        <span
          aria-hidden
          className="flex size-[18px] shrink-0 items-center justify-center rounded-full border border-border"
        >
          {done && <Check className="size-3 text-success" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-muted-foreground">
          {step} {label}
        </div>
        <div className="truncate font-mono text-[11.5px]" title={value}>
          {value}
        </div>
      </div>
    </div>
  );
}

export function TrainingPage() {
  const { t } = useI18n();
  const { backendId, backend, runtime, jobs } = useCurrent();
  const nodeBusy = useNodeBusy(backendId);
  const { config, devices } = useTuningFormEntry(backendId);
  const setField = useTuningForm((s) => s.set);
  const setDeviceSelection = useTuningForm((s) => s.setDevices);
  const set = useCallback(
    (patch: Partial<TuningConfig>) => setField(backendId, patch),
    [backendId, setField],
  );
  const setDevices = useCallback(
    (selection: DeviceSelection) => setDeviceSelection(backendId, selection),
    [backendId, setDeviceSelection],
  );
  const resetParameters = useCallback(
    () => resetTuningParameters(backendId),
    [backendId],
  );
  const [samples, setSamples] = useState<number | null>(null);
  const [validating, setValidating] = useState(false);
  const { lines } = useLogStream(backendId, "tuning");

  const tuning = jobs?.tuning;
  const progress = tuning?.progress ?? null;
  const losses = useMemo(() => tuning?.losses ?? [], [tuning?.losses]);
  const checkpoint = tuning?.checkpoint ?? "";

  useEffect(() => {
    if (!backendId) return;
    useLogs.getState().open(backendId, "tuning");
    return () => useLogs.getState().close(backendId, "tuning");
  }, [backendId]);

  // A stale sample count must never outlive the path it described.
  useEffect(() => {
    setSamples(null);
  }, [config.data]);

  const supportsState = hasCapability(backend, "tuning_state");
  const supportsMiss = hasCapability(backend, "tuning_miss");
  const isMiss = config.method === "miss";

  const numbersValid =
    config.ctx >= 1 &&
    config.chunk >= 1 &&
    config.batch_size >= 1 &&
    config.batch_size <= 128 &&
    config.epochs >= 1 &&
    config.lr >= 0 &&
    config.lr_final >= 0 &&
    config.warmup_steps >= 0 &&
    config.save_every >= 0 &&
    config.seed >= 0 &&
    (!isMiss || (config.rank >= 1 && config.rank <= 1024 && config.alpha >= 0));

  const canStart =
    Boolean(backendId) &&
    config.model.trim() !== "" &&
    config.data.trim() !== "" &&
    config.output.trim() !== "" &&
    numbersValid &&
    supportsState &&
    (!isMiss || supportsMiss) &&
    !nodeBusy &&
    !tuning?.running;

  const lossPoints = useMemo(() => {
    if (losses.length < 2) return "";
    const values = losses.map((point) => point.loss);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return losses
      .map((point, index) => {
        const x = (index / (losses.length - 1)) * 100;
        const y = 100 - ((point.loss - min) / span) * 100;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [losses]);

  const deviceLabel =
    runtime?.visible_devices ||
    (devices.mode === "explicit" ? devices.value : "") ||
    t("common.auto");

  const trainerText = tuning?.running
    ? t("training.trainerRunning", { device: deviceLabel })
    : tuning?.status === "completed"
      ? t("training.trainerCompleted")
      : tuning?.status === "error"
        ? t("training.trainerError")
        : t("training.trainerIdle");

  const setMethod = (method: TuningMethod) => {
    if (method === config.method) return;
    if (method === "miss") {
      set({
        method,
        optimizer: "adam",
        lr: 0.0001,
        lr_final: 0.00001,
        output: "./miss_output",
      });
    } else {
      set({
        method,
        lr: defaultTuning.lr,
        lr_final: defaultTuning.lr_final,
        output: "./state_output",
      });
    }
  };

  const numericFields: {
    key: string;
    min: number;
    max?: number;
    step: number | string;
    value: number;
    onChange: (value: number) => void;
  }[] = [
    { key: "ctx", min: 1, step: 1, value: config.ctx, onChange: (ctx) => set({ ctx }) },
    { key: "chunk", min: 1, step: 1, value: config.chunk, onChange: (chunk) => set({ chunk }) },
    {
      key: "batch_size",
      min: 1,
      max: 128,
      step: 1,
      value: config.batch_size,
      onChange: (batch_size) => set({ batch_size }),
    },
    { key: "epochs", min: 1, step: 1, value: config.epochs, onChange: (epochs) => set({ epochs }) },
    { key: "lr", min: 0, step: "any", value: config.lr, onChange: (lr) => set({ lr }) },
    {
      key: "lr_final",
      min: 0,
      step: "any",
      value: config.lr_final,
      onChange: (lr_final) => set({ lr_final }),
    },
    {
      key: "warmup_steps",
      min: 0,
      step: 1,
      value: config.warmup_steps,
      onChange: (warmup_steps) => set({ warmup_steps }),
    },
    {
      key: "save_every",
      min: 0,
      step: 1,
      value: config.save_every,
      onChange: (save_every) => set({ save_every }),
    },
    { key: "seed", min: 0, step: 1, value: config.seed, onChange: (seed) => set({ seed }) },
  ];

  const start = async () => {
    if (!backendId) return;
    try {
      await useNodes.getState().startTuning(
        backendId,
        applyDevice({ ...config, optimizer: effectiveOptimizer(config) }, devices),
      );
    } catch (error) {
      toast.error(
        t("toast.failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  const stop = async () => {
    if (!backendId) return;
    try {
      await useNodes.getState().stopJob(backendId, "tuning");
    } catch (error) {
      toast.error(
        t("toast.failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  const validate = async () => {
    if (!backendId || !config.data) return;
    setValidating(true);
    try {
      setSamples(await useNodes.getState().validateDataset(backendId, config.data));
    } catch (error) {
      setSamples(null);
      toast.error(
        t("toast.failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="max-w-[1240px] px-6 pt-5.5 pb-10">
      <PageHeader
        eyebrow={backend?.name}
        title={t("training.title")}
        description={t("training.subtitle")}
        actions={
          <>
            <Segmented<TuningMethod>
              value={config.method}
              onChange={setMethod}
              options={[
                { value: "state", label: t("training.stateTab") },
                { value: "miss", label: t("training.missTab") },
              ]}
            />
            <Button disabled={!tuning?.running} onClick={stop}>
              <Square className="size-3.5" />
              {t("common.stop")}
            </Button>
          </>
        }
      />

      {!supportsState && (
        <Notice tone="warning" className="mt-4" icon={<TriangleAlert className="size-3.5" />}>
          {t("training.unsupported")}
        </Notice>
      )}
      {isMiss && !supportsMiss && (
        <Notice tone="warning" className="mt-3" icon={<TriangleAlert className="size-3.5" />}>
          {t("training.missUnsupported")}
        </Notice>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StepCard
          step="01"
          label={t("training.stepFiles")}
          value={config.model ? basename(config.model) : "—"}
          done={Boolean(config.model)}
        />
        <StepCard
          step="02"
          label={t("training.stepDataset")}
          value={
            samples === null
              ? "—"
              : t("training.validated", { count: samples })
          }
          done={samples !== null}
        />
        <StepCard
          step="03"
          label={t("training.stepParameters")}
          value={`${config.ctx} ctx · batch ${config.batch_size}`}
          done={numbersValid}
        />
        <StepCard
          step="04"
          label={t("training.stepTrainer")}
          value={trainerText}
          done={tuning?.status === "completed"}
          running={Boolean(tuning?.running)}
        />
      </div>

      <div className="mt-3.5 grid gap-3.5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>{t("training.config")}</CardTitle>
            <div className="flex-1" />
            <span className="font-mono text-[11px] text-muted-foreground">
              {config.method}
            </span>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="text-[11px] text-muted-foreground">
              {t("training.stepFiles")} · {t("training.stepDataset")}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <PathField
                label={t("training.baseModel")}
                value={config.model}
                onChange={(model) => set({ model })}
                backendId={backendId}
                hostDialog={hasCapability(backend, "host_dialog")}
              />
              <div className="grid gap-2">
                <PathField
                  label={t("training.dataset")}
                  value={config.data}
                  onChange={(data) => set({ data })}
                  backendId={backendId}
                  hostDialog={hasCapability(backend, "host_dialog")}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={!backendId || !config.data || validating}
                    onClick={validate}
                  >
                    {t("training.validate")}
                  </Button>
                  {samples !== null && (
                    <span className="text-[11.5px] text-success">
                      {t("training.validated", { count: samples })}
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {t("training.datasetHint")}
                  </span>
                </div>
              </div>
              <PathField
                label={t("training.vocab")}
                value={config.vocab}
                onChange={(vocab) => set({ vocab })}
                backendId={backendId}
                hostDialog={hasCapability(backend, "host_dialog")}
              />
              <PathField
                label={t("training.output")}
                value={config.output}
                onChange={(output) => set({ output })}
                backendId={backendId}
                hostDialog={hasCapability(backend, "host_dialog")}
              />
            </div>

            <div className="border-t border-border pt-3">
              <div className="mb-2 text-[11px] text-muted-foreground">
                {t("training.stepParameters")}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {numericFields.map((field) => (
                  <Field key={field.key} label={field.key}>
                    <Input
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={field.value}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        field.onChange(Number.isFinite(parsed) ? parsed : 0);
                      }}
                    />
                  </Field>
                ))}
                <Field
                  label={t("training.optimizer")}
                  hint={isMiss ? t("training.missOptimizerHint") : undefined}
                >
                  <Select
                    value={effectiveOptimizer(config)}
                    disabled={isMiss}
                    onChange={(event) =>
                      set({
                        optimizer: event.target.value as TuningConfig["optimizer"],
                      })
                    }
                  >
                    <option value="adam">adam</option>
                    <option value="muon">muon</option>
                  </Select>
                </Field>
                <DeviceField
                  label={t("runtime.deviceMode")}
                  selection={devices}
                  onChange={setDevices}
                  className="sm:col-span-2 xl:col-span-1"
                />
                <div className="flex items-center pt-1 sm:pt-5">
                  <CheckboxField
                    label="wkv_tape"
                    checked={config.wkv_tape}
                    onChange={(event) => set({ wkv_tape: event.target.checked })}
                  />
                </div>
              </div>
            </div>

            {isMiss && (
              <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2 xl:grid-cols-3">
                <Field label={t("training.rank")} hint={t("training.rankHint")}>
                  <Input
                    type="number"
                    min={1}
                    max={1024}
                    step={1}
                    value={config.rank}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      set({ rank: Number.isFinite(parsed) ? parsed : 1 });
                    }}
                  />
                </Field>
                <Field label={t("training.alpha")}>
                  <Input
                    type="number"
                    step="any"
                    value={config.alpha}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      set({ alpha: Number.isFinite(parsed) ? parsed : 0 });
                    }}
                  />
                </Field>
                <Field
                  label={t("training.targets")}
                  className="sm:col-span-2 xl:col-span-3"
                >
                  <Input
                    value={config.targets}
                    placeholder="all"
                    onChange={(event) => set({ targets: event.target.value })}
                    className="font-mono text-xs"
                  />
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {MISS_TARGETS.join(" · ")}
                  </p>
                </Field>
                <PathField
                  className="sm:col-span-2 xl:col-span-3"
                  label={
                    <>
                      {t("training.initialState")}
                      <span className="text-muted-foreground">
                        {" · "}
                        {t("training.missOnly")}
                      </span>
                    </>
                  }
                  value={config.state}
                  onChange={(state) => set({ state })}
                  backendId={backendId}
                  hostDialog={hasCapability(backend, "host_dialog")}
                />
                <PathField
                  className="sm:col-span-2 xl:col-span-3"
                  label={
                    <>
                      {t("training.resume")}
                      <span className="text-muted-foreground">
                        {" · "}
                        {t("training.missOnly")}
                      </span>
                    </>
                  }
                  value={config.resume}
                  onChange={(resume) => set({ resume })}
                  backendId={backendId}
                  hostDialog={hasCapability(backend, "host_dialog")}
                />
              </div>
            )}

            {config.chunk > config.ctx && (
              <Notice tone="warning">{t("training.chunkHint")}</Notice>
            )}
            {/* No catalogue key describes the lr range, so the constraint is
                rendered as the protocol expression itself. */}
            {config.lr > 0.01 && (
              <Notice tone="warning">{t("training.lrWarning")}</Notice>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <span className="text-[11px] text-muted-foreground">
                {t("training.presets")}
              </span>
              <Button
                size="xs"
                onClick={() =>
                  set({
                    ctx: 512,
                    chunk: 128,
                    epochs: 1,
                    batch_size: 16,
                    lr: isMiss ? 0.0001 : 0.0005,
                    lr_final: isMiss ? 0.00001 : 0.0001,
                    warmup_steps: 10,
                    save_every: 100,
                    max_steps: 0,
                    seed: 1234,
                    optimizer: "adam",
                    wkv_tape: false,
                  })
                }
              >
                {t("training.presetRecommended")}
              </Button>
              <Button
                size="xs"
                onClick={() => set({ ctx: 256, chunk: 64, batch_size: 4 })}
              >
                {t("training.presetLowMemory")}
              </Button>
              <Button
                size="xs"
                onClick={() =>
                  set({
                    ctx: 128,
                    chunk: 64,
                    batch_size: 2,
                    max_steps: 10,
                    save_every: 5,
                  })
                }
              >
                {t("training.presetQuickCheck")}
              </Button>
              <div className="flex-1" />
              <Button size="xs" variant="ghost" onClick={resetParameters}>
                {t("training.resetDefaults")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>{t("training.progress")}</CardTitle>
            <div className="flex-1" />
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {t("training.epoch", {
                epoch: progress?.epoch ?? 0,
                epochs: progress?.epochs ?? config.epochs,
              })}
            </span>
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {t("training.eta", { eta: formatDuration(progress?.eta) })}
            </span>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <span className="font-mono text-[11.5px] text-muted-foreground">
                {t("training.steps", {
                  step: progress?.step ?? 0,
                  total: progress?.total ?? 0,
                })}
              </span>
              <Progress
                value={progress?.step ?? 0}
                max={progress?.total ?? 0}
                tone="warning"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Metric label="loss" value={formatNumber(progress?.loss, 4)} />
              <Metric label="lr" value={formatNumber(progress?.lr, 4)} />
              <Metric
                label={t("training.tokensPerSecond")}
                value={formatCount(progress?.tokens_per_second)}
              />
            </div>

            {losses.length > 1 && (
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">
                  {t("training.lossCurve")}
                </div>
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="h-[92px] w-full"
                  role="img"
                  aria-label={t("training.lossCurve")}
                >
                  <polyline
                    fill="none"
                    stroke="var(--info)"
                    strokeWidth={1.4}
                    vectorEffect="non-scaling-stroke"
                    points={lossPoints}
                  />
                </svg>
              </div>
            )}

            <div className="flex items-center gap-2 border-t border-border pt-3">
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {t("training.checkpoint")}
              </span>
              <span
                className="min-w-0 flex-1 truncate font-mono text-[11.5px]"
                title={checkpoint}
              >
                {checkpoint || t("training.noCheckpoint")}
              </span>
              <CopyButton text={checkpoint} size="xs" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3">
        <Button variant="default" disabled={!canStart} onClick={start}>
          <Play className="size-3.5" />
          {t("training.start")}
        </Button>
        <span className="text-[11.5px] text-muted-foreground">
          {tuning?.running ? t("training.running") : trainerText}
        </span>
      </div>

      <LogViewer
        className="mt-3.5"
        lines={lines}
        title={t("training.logs")}
        endpoint={LOG_ENDPOINT}
      />
    </div>
  );
}

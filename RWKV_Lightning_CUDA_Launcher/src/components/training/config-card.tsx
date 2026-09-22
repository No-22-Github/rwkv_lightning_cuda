import { PathField } from "@/components/common";
import { DeviceSelector } from "@/components/device-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckboxField, Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { effectiveOptimizer } from "@/lib/api/launcher";
import { MISS_TARGETS } from "@/lib/api/types";
import type {
  BackendView,
  DeviceSelection,
  TuningConfig,
} from "@/lib/api/types";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { hasCapability } from "@/stores/backends";

export interface TuningFieldProps {
  backendId: string;
  backend?: BackendView;
  config: TuningConfig;
  set: (patch: Partial<TuningConfig>) => void;
}

/**
 * Numeric parameters, grouped the way they are reasoned about rather than in
 * protocol order, each row carrying what it does and the range it has to stay
 * in. `invalid` means "the trainer would reject this"; softer advice (chunk vs
 * ctx, lr_final vs lr) is a notice, because it does not block a run.
 */
interface NumericField {
  key: keyof TuningConfig & string;
  min: number;
  max?: number;
  step: number | string;
  value: number;
  invalid: boolean;
  onChange: (value: number) => void;
}

function numericGroups(
  config: TuningConfig,
  set: TuningFieldProps["set"],
  t: (key: MessageKey) => string,
): { title: string; fields: NumericField[] }[] {
  return [
    {
      title: t("training.groupSequence"),
      fields: [
        {
          key: "ctx",
          min: 1,
          step: 1,
          value: config.ctx,
          invalid: config.ctx < 1,
          onChange: (ctx: number) => set({ ctx }),
        },
        {
          key: "chunk",
          min: 1,
          step: 1,
          value: config.chunk,
          invalid: config.chunk < 1,
          onChange: (chunk: number) => set({ chunk }),
        },
        {
          key: "batch_size",
          min: 1,
          max: 128,
          step: 1,
          value: config.batch_size,
          invalid: config.batch_size < 1 || config.batch_size > 128,
          onChange: (batch_size: number) => set({ batch_size }),
        },
        {
          key: "epochs",
          min: 1,
          step: 1,
          value: config.epochs,
          invalid: config.epochs < 1,
          onChange: (epochs: number) => set({ epochs }),
        },
      ],
    },
    {
      title: t("training.groupOptimizer"),
      fields: [
        {
          key: "lr",
          min: 0,
          step: "any",
          value: config.lr,
          invalid: config.lr < 0,
          onChange: (lr: number) => set({ lr }),
        },
        {
          key: "lr_final",
          min: 0,
          step: "any",
          value: config.lr_final,
          invalid: config.lr_final < 0,
          onChange: (lr_final: number) => set({ lr_final }),
        },
        {
          key: "warmup_steps",
          min: 0,
          step: 1,
          value: config.warmup_steps,
          invalid: config.warmup_steps < 0,
          onChange: (warmup_steps: number) => set({ warmup_steps }),
        },
      ],
    },
    {
      title: t("training.groupRun"),
      fields: [
        {
          key: "max_steps",
          min: 0,
          step: 1,
          value: config.max_steps,
          invalid: config.max_steps < 0,
          onChange: (max_steps: number) => set({ max_steps }),
        },
        {
          key: "save_every",
          min: 0,
          step: 1,
          value: config.save_every,
          invalid: config.save_every < 0,
          onChange: (save_every: number) => set({ save_every }),
        },
        {
          key: "seed",
          min: 0,
          step: 1,
          value: config.seed,
          invalid: config.seed < 0,
          onChange: (seed: number) => set({ seed }),
        },
      ],
    },
  ];
}

/** Files and dataset: everything the run reads from and writes to. */
function FileFields({
  backendId,
  backend,
  config,
  set,
  samples,
  validating,
  onValidate,
}: TuningFieldProps & {
  samples: number | null;
  validating: boolean;
  onValidate: () => void;
}) {
  const { t } = useI18n();
  const hostDialog = hasCapability(backend, "host_dialog");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <PathField
        label={t("training.baseModel")}
        value={config.model}
        onChange={(model) => set({ model })}
        backendId={backendId}
        hostDialog={hostDialog}
      />
      <div className="grid gap-2">
        <PathField
          label={t("training.dataset")}
          value={config.data}
          onChange={(data) => set({ data })}
          backendId={backendId}
          hostDialog={hostDialog}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!backendId || !config.data || validating}
            onClick={onValidate}
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
        hostDialog={hostDialog}
      />
      <PathField
        label={t("training.output")}
        value={config.output}
        onChange={(output) => set({ output })}
        backendId={backendId}
        hostDialog={hostDialog}
      />
    </div>
  );
}

function ParameterFields({
  config,
  set,
  devices,
  setDevices,
  onReset,
}: Pick<TuningFieldProps, "config" | "set"> & {
  devices: DeviceSelection;
  setDevices: (selection: DeviceSelection) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const isMiss = config.method === "miss";
  return (
    <div className="border-t border-border pt-3">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          {t("training.stepParameters")}
        </span>
        {/* Presets sit above the fields, not below them: they are the starting
            point, not an afterthought once every box has been typed into. */}
        <span className="text-[11px] text-muted-foreground/70">
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
        <Button size="xs" variant="ghost" onClick={onReset}>
          {t("training.resetDefaults")}
        </Button>
      </div>

      <div className="grid gap-3">
        {numericGroups(config, set, t).map((group) => (
          <div key={group.title}>
            <div className="mb-1.5 text-[10.5px] font-semibold tracking-[0.04em] text-muted-foreground/80">
              {group.title}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.fields.map((field) => {
                const hint = t(`training.hint.${field.key}` as MessageKey);
                return (
                  <Field key={field.key} label={field.key} hint={hint}>
                    <Input
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={field.value}
                      aria-invalid={field.invalid || undefined}
                      className={cn(
                        field.invalid &&
                          "border-destructive focus-visible:border-destructive",
                      )}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        field.onChange(Number.isFinite(parsed) ? parsed : 0);
                      }}
                    />
                    <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground/80">
                      {hint}
                    </p>
                  </Field>
                );
              })}
            </div>
          </div>
        ))}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
          <DeviceSelector
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
    </div>
  );
}

/** MiSS-only adapter parameters. */
function MissFields({ backendId, backend, config, set }: TuningFieldProps) {
  const { t } = useI18n();
  const hostDialog = hasCapability(backend, "host_dialog");
  return (
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
        hostDialog={hostDialog}
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
        hostDialog={hostDialog}
      />
    </div>
  );
}

/** Left column of the training page: what to train on, and how. */
export function TrainingConfigCard({
  backendId,
  backend,
  config,
  set,
  devices,
  setDevices,
  samples,
  validating,
  onValidate,
  onReset,
}: TuningFieldProps & {
  devices: DeviceSelection;
  setDevices: (selection: DeviceSelection) => void;
  samples: number | null;
  validating: boolean;
  onValidate: () => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const fields = { backendId, backend, config, set };
  return (
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
        <FileFields
          {...fields}
          samples={samples}
          validating={validating}
          onValidate={onValidate}
        />
        <ParameterFields
          config={config}
          set={set}
          devices={devices}
          setDevices={setDevices}
          onReset={onReset}
        />
        {config.method === "miss" && <MissFields {...fields} />}

        {config.chunk > config.ctx && (
          <Notice tone="warning">{t("training.chunkHint")}</Notice>
        )}
        {config.lr > 0.01 && (
          <Notice tone="warning">{t("training.lrWarning")}</Notice>
        )}
        {config.lr_final > config.lr && (
          <Notice tone="warning">{t("training.lrFinalWarning")}</Notice>
        )}
      </CardContent>
    </Card>
  );
}

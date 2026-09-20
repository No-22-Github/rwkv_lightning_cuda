import { useEffect, useState } from "react";
import { AdapterManager } from "@/components/chat/adapter-manager";
import { StateManager } from "@/components/chat/state-manager";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/field";
import { Separator } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { inferenceApi } from "@/lib/api/inference";
import type { AdapterEntry, UploadedState } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n";
import { useSettings } from "@/stores/settings";

type ThinkType = "fast" | "free";

const encodeAdapter = (id: string, version: string) =>
  JSON.stringify([id, version]);

/** `adapter_id + version` is the identity, so the select value carries both. */
function decodeAdapter(value: string): [string, string] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    )
      return [parsed[0], parsed[1]];
  } catch {
    // Not an encoded adapter value: fall through to "no adapter".
  }
  return ["", ""];
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11.5px] text-muted-foreground">
          {label}
        </span>
        <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
          {value}
        </span>
      </div>
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

/** Right-hand column of the chat page: generation settings and node assets. */
export function GenerationPanel({ backendId }: { backendId: string }) {
  const { t } = useI18n();
  const generation = useSettings((s) => s.generation);
  const setGeneration = useSettings((s) => s.setGeneration);
  const [states, setStates] = useState<UploadedState[]>([]);
  const [statesFailed, setStatesFailed] = useState(false);
  const [adapters, setAdapters] = useState<AdapterEntry[]>([]);
  const [adaptersError, setAdaptersError] = useState("");
  const [statesOpen, setStatesOpen] = useState(false);
  const [adaptersOpen, setAdaptersOpen] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!backendId) {
      setStates([]);
      setStatesFailed(false);
      setAdapters([]);
      setAdaptersError("");
      return;
    }
    const controller = new AbortController();
    inferenceApi
      .listStates(backendId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setStates(result?.data ?? []);
        setStatesFailed(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setStates([]);
        setStatesFailed(true);
      });
    inferenceApi
      .listAdapters(backendId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setAdapters(result?.data ?? []);
        setAdaptersError("");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setAdapters([]);
        setAdaptersError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [backendId, revision]);

  /** Re-read both lists once a manager dialog closes; it may have changed them. */
  const closed = (setOpen: (open: boolean) => void) => (open: boolean) => {
    setOpen(open);
    if (!open) setRevision((value) => value + 1);
  };

  const selectedAdapter = encodeAdapter(
    generation.adapter_id ?? "",
    generation.adapter_version ?? "",
  );
  const adapterMissing =
    Boolean(generation.adapter_id) &&
    !adapters.some(
      (entry) =>
        entry.id === generation.adapter_id &&
        entry.version === (generation.adapter_version ?? ""),
    );
  const stateMissing =
    Boolean(generation.state_id) &&
    !states.some((state) => state.state_id === generation.state_id);

  return (
    <div className="space-y-3.5">
      <section className="space-y-3">
        <h2 className="text-[12.5px] font-semibold">{t("chat.generation")}</h2>
        <SliderRow
          label={t("chat.temperature")}
          value={generation.temperature}
          min={0}
          max={2}
          step={0.1}
          onChange={(value) => setGeneration({ temperature: value })}
        />
        <SliderRow
          label={t("chat.topP")}
          value={generation.top_p}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) => setGeneration({ top_p: value })}
        />
        <SliderRow
          label={t("chat.maxTokens")}
          value={generation.max_tokens}
          min={64}
          max={4096}
          step={64}
          onChange={(value) => setGeneration({ max_tokens: value })}
        />
      </section>

      <Separator />

      <section className="space-y-2">
        <h2 className="text-[12.5px] font-semibold">{t("chat.state")}</h2>
        {statesFailed ? (
          <p className="text-[11.5px] text-muted-foreground">
            {t("chat.stateUnavailable")}
          </p>
        ) : (
          <Select
            value={generation.state_id}
            disabled={!backendId}
            onChange={(event) =>
              setGeneration({ state_id: event.target.value })
            }
          >
            <option value="">{t("chat.stateNone")}</option>
            {stateMissing && (
              <option value={generation.state_id}>{generation.state_id}</option>
            )}
            {states.map((state) => (
              <option key={state.state_id} value={state.state_id}>
                {state.filename}
              </option>
            ))}
          </Select>
        )}
        <Button
          className="w-full"
          disabled={!backendId}
          onClick={() => setStatesOpen(true)}
        >
          {t("chat.manageStates")}
        </Button>
      </section>

      <Separator />

      <section className="space-y-2">
        <h2 className="text-[12.5px] font-semibold">{t("chat.adapter")}</h2>
        <Select
          value={selectedAdapter}
          disabled={!backendId}
          onChange={(event) => {
            const [id, version] = decodeAdapter(event.target.value);
            setGeneration({
              adapter_id: id,
              adapter_version: version,
              adapter_scale: "",
            });
          }}
        >
          <option value={encodeAdapter("", "")}>{t("chat.adapterNone")}</option>
          {adapterMissing && (
            <option value={selectedAdapter}>{generation.adapter_id}</option>
          )}
          {adapters.map((entry) => (
            <option
              key={`${entry.id}@${entry.version}`}
              value={encodeAdapter(entry.id, entry.version)}
            >
              {entry.id} · {entry.version.slice(0, 12)} · {t("adapter.rank")}{" "}
              {entry.manifest.rank}
            </option>
          ))}
        </Select>
        {adaptersError && (
          <p className="font-mono text-[11px] break-all text-muted-foreground">
            {adaptersError}
          </p>
        )}
        <Button
          className="w-full"
          disabled={!backendId}
          onClick={() => setAdaptersOpen(true)}
        >
          {t("chat.manageAdapters")}
        </Button>
      </section>

      <Separator />

      <section className="space-y-2">
        <h2 className="text-[12.5px] font-semibold">{t("chat.thinkType")}</h2>
        <Segmented<ThinkType>
          value={generation.think_type === "free" ? "free" : "fast"}
          options={[
            { value: "fast", label: t("chat.thinkFast") },
            { value: "free", label: t("chat.thinkThink") },
          ]}
          onChange={(value) => setGeneration({ think_type: value })}
        />
      </section>

      <StateManager
        backendId={backendId}
        open={statesOpen}
        onOpenChange={closed(setStatesOpen)}
      />
      <AdapterManager
        backendId={backendId}
        open={adaptersOpen}
        onOpenChange={closed(setAdaptersOpen)}
      />
    </div>
  );
}

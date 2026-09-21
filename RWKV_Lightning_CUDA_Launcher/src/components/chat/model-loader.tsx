import { useEffect, useState } from "react";
import { Loader2, MonitorPlay } from "lucide-react";
import { useCurrent } from "@/app/use-current";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { inferenceApi } from "@/lib/api/inference";
import { useI18n } from "@/lib/i18n";
import { useNodes } from "@/stores/nodes";
import { toast } from "@/stores/ui";

/**
 * Card-switch model loading from the chat page: pick a GPU (and, in dynamic
 * mode, a model), and the Agent restarts the runtime with that card injected
 * as CUDA_VISIBLE_DEVICES before loading. Inherently interrupting — CUDA
 * binds devices at process init — which is why the Agent-side call blocks
 * until the new runtime is actually serving.
 */
export function ModelLoader() {
  const { t } = useI18n();
  const { backendId, hasAgent, runtime, metrics, runtimeReady } = useCurrent();
  const busy = useNodes((s) =>
    backendId ? Boolean(s.busy[backendId]) : false,
  );
  const [card, setCard] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);

  const dynamic = runtime?.config?.enable_dynamic_loading === true;
  const hasConfig = Boolean(runtime?.config?.model_path);

  // Dynamic mode only: what can be loaded at all is the server's business.
  useEffect(() => {
    if (!backendId || !dynamic || !runtimeReady) return;
    const controller = new AbortController();
    void inferenceApi
      .models(backendId, controller.signal)
      .then((response) => {
        setModels(response.available ?? response.data.map((e) => e.id));
      })
      .catch(() => setModels([]));
    return () => controller.abort();
  }, [backendId, dynamic, runtimeReady]);

  if (!hasAgent || !hasConfig) return null;

  const gpus = metrics?.available ? metrics.gpus : [];
  const current = runtime?.visible_devices;
  // A launcher pinned by --card refuses every other spec, so the picker only
  // offers the pinned card next to auto.
  const pinned = runtime?.card?.trim() ?? "";
  const cardValue = pinned && card !== "" && card !== pinned ? "" : card;

  const submit = async () => {
    if (!backendId) return;
    try {
      const out = await useNodes
        .getState()
        .loadOnCard(backendId, model, cardValue);
      toast.success(
        t("chat.loadDone", {
          card: out?.visible_devices || t("chat.autoCard"),
        }),
      );
    } catch (error) {
      toast.error(
        t("toast.failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  return (
    <div className="grid gap-2.5">
      <div className="flex items-center gap-2">
        <StatusDot tone={runtimeReady ? "ok" : "warn"} />
        <span className="text-[12px] font-semibold">{t("chat.modelLoader")}</span>
      </div>
      {dynamic && (
        <Field label={t("runtime.model")}>
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">—</option>
            {models.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("chat.loadCard")}>
        <Select value={cardValue} onChange={(e) => setCard(e.target.value)}>
          <option value="">{t("chat.autoCard")}</option>
          {pinned ? (
            <option value={pinned}>
              GPU {pinned} · {t("runtime.devicePinned")}
            </option>
          ) : (
            gpus.map((gpu) => (
              <option key={gpu.index} value={String(gpu.index)}>
                GPU {gpu.index} · {t("chat.gpuFree", { free: gigabytesFree(gpu) })}
              </option>
            ))
          )}
        </Select>
      </Field>
      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <MonitorPlay className="size-3.5" />
        )}
        {t("chat.loadOnCard")}
      </Button>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {t("chat.loadHint")}
        {current ? ` ${t("chat.loadCurrent")} GPU ${current}.` : ""}
        {pinned ? ` ${t("runtime.devicePinnedHint", { card: pinned })}` : ""}
      </p>
    </div>
  );
}

function gigabytesFree(gpu: {
  memory_total_bytes: number;
  memory_used_bytes: number;
}) {
  const free = gpu.memory_total_bytes - gpu.memory_used_bytes;
  // One decimal is enough to tell "48G card 12G busy" from "empty".
  return (free / 2 ** 30).toFixed(1).replace(/\.0$/, "");
}

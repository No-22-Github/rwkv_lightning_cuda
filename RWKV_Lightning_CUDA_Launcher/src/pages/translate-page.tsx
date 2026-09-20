/**
 * Parallel Translate. Every non-empty line of the source document is one
 * independent continuation on `/v1/batch/completions`; the job engine (chunk
 * queue, batching, abort, persistence) lives in `stores/translate`.
 */
import { Languages, Play, Square } from "lucide-react";
import { useEffect } from "react";
import { useCurrent } from "@/app/use-current";
import { CopyButton, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { EmptyState, Notice, Progress } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { formatCount } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { chunkText } from "@/lib/translate/chunk";
import { languages, normalizeLanguage } from "@/lib/translate/languages";
import { cn } from "@/lib/utils";
import { useSettings } from "@/stores/settings";
import { translatedOutput, useTranslate } from "@/stores/translate";
import { useUI } from "@/stores/ui";

/** Browser-side text export; the document never leaves the page. */
function download(text: string, extension: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rwkv-translation.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function TranslatePage() {
  const { t } = useI18n();
  // The whole job state is subscribed on purpose: the engine publishes progress
  // by mutating the chunk objects, so derived values must be recomputed on
  // every render instead of being memoised on the stable `chunks` reference.
  const job = useTranslate();
  const sourceLanguage = useSettings((s) => s.sourceLanguage);
  const targetLanguage = useSettings((s) => s.targetLanguage);
  const defaultConcurrency = useSettings((s) => s.concurrency);
  const { backendId, backend, canInfer } = useCurrent();

  const sourceLang = normalizeLanguage(job.from || sourceLanguage, "English");
  const targetLang = normalizeLanguage(job.to || targetLanguage, "Chinese");
  const batchSize = job.concurrency || defaultConcurrency;

  const lines = chunkText(job.source);
  const ordered = [...job.chunks].sort((a, b) => a.id - b.id);
  const output = translatedOutput(job.chunks);
  const done = job.chunks.filter((c) => c.status === "done").length;
  const running = job.chunks.filter((c) => c.status === "running").length;
  const chars = job.chunks.reduce((total, c) => total + c.translated.length, 0);
  const errorIds = job.chunks
    .filter((c) => c.status === "error")
    .map((c) => c.id);
  const pendingIds = job.chunks
    .filter((c) => c.status === "pending")
    .map((c) => c.id);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
      if (job.busy || !canInfer) return;
      const ui = useUI.getState();
      if (ui.addBackendOpen || ui.fsPicker) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      void useTranslate.getState().run(backendId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [backendId, job.busy, canInfer]);

  const errorText = !job.error
    ? ""
    : job.error === "invalid-languages"
      ? `${t("common.error")}: ${t("translate.source")} ≠ ${t("translate.target")}`
      : job.error === "invalid-batch"
        ? `${t("common.error")}: ${t("settings.batchSize")} 1–128`
        : job.error === "empty-source"
          ? t("translate.placeholder")
          : job.error;

  return (
    <div className="mx-auto max-w-[1240px] px-6 pt-5.5 pb-10">
      <PageHeader
        title={t("translate.title")}
        description={t("translate.subtitle")}
        actions={
          <>
            <Select
              className="w-[150px]"
              aria-label={t("translate.source")}
              title={t("translate.source")}
              value={sourceLang}
              disabled={job.busy}
              onChange={(event) => job.set({ from: event.target.value })}
            >
              {languages.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </Select>
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
            <Select
              className="w-[150px]"
              aria-label={t("translate.target")}
              title={t("translate.target")}
              value={targetLang}
              disabled={job.busy}
              onChange={(event) => job.set({ to: event.target.value })}
            >
              {languages.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              min={1}
              max={128}
              className="w-[74px] text-center font-mono"
              aria-label={t("translate.batchSize")}
              title={t("translate.batchSize")}
              value={batchSize}
              onChange={(event) =>
                job.set({ concurrency: Number(event.target.value) })
              }
            />
            <Button
              variant="default"
              disabled={
                job.busy ||
                !job.source.trim() ||
                !canInfer ||
                sourceLang === targetLang
              }
              onClick={() => void useTranslate.getState().run(backendId)}
            >
              <Play className="size-3.5" />
              {t("translate.start")}
            </Button>
            <Button
              disabled={!job.busy}
              onClick={() => useTranslate.getState().stop()}
            >
              <Square className="size-3.5" />
              {t("translate.stop")}
            </Button>
          </>
        }
      />

      {errorText && (
        <Notice tone="danger" className="mt-4">
          {errorText}
        </Notice>
      )}
      {backend?.kind === "inference_only" && (
        <Notice tone="warning" className="mt-4">
          {t("translate.unsupported")}
        </Notice>
      )}
      {!canInfer && (
        <Notice tone="info" className="mt-4">
          {t("translate.noRuntime")}{" "}
          <a
            href="#/runtime"
            className="text-info underline underline-offset-2"
          >
            {t("runtime.title")}
          </a>
        </Notice>
      )}

      {job.chunks.length > 0 && (
        <Card className="mt-4 flex items-center gap-3 px-3.5 py-2.5">
          <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
            {t("translate.progress", { done, total: job.chunks.length })}
          </span>
          <Progress
            className="flex-1"
            value={done}
            max={job.chunks.length}
          />
          <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
            {t("translate.inFlight", { count: running })}
          </span>
        </Card>
      )}

      <div className="mt-3.5 grid gap-3.5 lg:grid-cols-2">
        <Card className="flex flex-col overflow-hidden">
          <CardHeader className="justify-between">
            <CardTitle>{t("translate.sourcePanel")}</CardTitle>
            <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
              {t("translate.chars", { count: formatCount(job.source.length) })}{" "}
              ·{" "}
              {t("translate.lines", { count: formatCount(lines.length) })}
            </span>
          </CardHeader>
          <CardContent className="p-3">
            <Textarea
              className="h-[320px] resize-none"
              placeholder={t("translate.placeholder")}
              value={job.source}
              disabled={job.busy}
              onChange={(event) => job.set({ source: event.target.value })}
            />
          </CardContent>
        </Card>

        <Card className="flex flex-col overflow-hidden">
          <CardHeader className="justify-between">
            <CardTitle>{t("translate.targetPanel")}</CardTitle>
            <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
              {t("translate.rendered", {
                done,
                total: job.chunks.length,
                chars: formatCount(chars),
              })}
            </span>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col p-3">
            {ordered.length > 0 ? (
              <div className="h-[320px] space-y-2 overflow-auto rounded-lg border border-border bg-background p-2.5">
                {ordered.map((chunk) => (
                  <div
                    key={chunk.id}
                    className="flex items-baseline gap-2 rounded-lg px-1.5 py-1"
                  >
                    <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-muted-foreground">
                      {String(chunk.id + 1).padStart(2, "0")}
                    </span>
                    <p
                      className={cn(
                        "min-w-0 flex-1 text-[12.5px] leading-relaxed break-words whitespace-pre-wrap",
                        !chunk.translated &&
                          (chunk.status === "error"
                            ? "text-destructive"
                            : "text-muted-foreground"),
                      )}
                    >
                      {chunk.translated ||
                        (chunk.status === "error"
                          ? chunk.error || "···"
                          : "···")}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                className="h-[320px]"
                icon={<Languages className="size-7" strokeWidth={1.5} />}
                title={t("translate.empty")}
              />
            )}

            <div className="mt-3 flex items-center gap-2">
              <CopyButton text={output} disabled={!output} />
              <Button
                size="xs"
                disabled={!output}
                onClick={() => download(output, "txt")}
              >
                TXT
              </Button>
              <Button
                size="xs"
                disabled={!output}
                onClick={() => download(output, "md")}
              >
                Markdown
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={job.busy || errorIds.length === 0}
          onClick={() => void useTranslate.getState().run(backendId, errorIds)}
        >
          {t("translate.retryFailed")}
        </Button>
        <Button
          size="sm"
          disabled={job.busy || pendingIds.length === 0}
          onClick={() => void useTranslate.getState().run(backendId, pendingIds)}
        >
          {t("common.retry")}
        </Button>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          disabled={job.busy}
          onClick={() => useTranslate.getState().clear()}
        >
          {t("translate.clear")}
        </Button>
      </div>
    </div>
  );
}

import { RailToggle, RuntimeBadge } from "@/app/rail";
import { useCurrent } from "@/app/use-current";
import { modelName } from "@/components/node-status";
import { RuntimeControls } from "@/components/runtime-controls";
import { StatusDot } from "@/components/ui/badge";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useRoute, type Route } from "@/lib/router";

const TITLES: Record<Route, MessageKey> = {
  nodes: "nodes.title",
  chat: "chat.title",
  translate: "translate.title",
  runtime: "runtime.title",
  training: "training.title",
  quant: "quant.title",
  settings: "settings.title",
};

export function Header() {
  const { t } = useI18n();
  const route = useRoute();
  const { backend, runtime } = useCurrent();
  const model = modelName(runtime);

  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-border bg-card px-3.5">
      <RailToggle />

      <div className="flex h-7 items-center gap-2 border-r border-border pr-3">
        {/* Black swan mark; invert keeps the silhouette visible on the dark
            header (the source asset is a black-on-transparent cutout). */}
        <img
          src="/logo.png"
          alt=""
          className="size-[22px] object-contain dark:invert"
        />
        <span className="text-[13.5px] font-semibold tracking-[-0.01em]">
          {t("app.name")}
        </span>
        <span className="rounded-[5px] border border-border px-1.5 py-px text-[10.5px] font-medium text-muted-foreground">
          {t("app.console")}
        </span>
      </div>

      <span className="text-[13.5px] font-medium">{t(TITLES[route])}</span>

      <div className="flex-1" />

      <RuntimeBadge />

      <span className="hidden max-w-[200px] items-center gap-1.5 truncate font-mono text-[11.5px] text-muted-foreground lg:inline-flex">
        {model && <StatusDot tone="ok" />}
        {model || t("status.noModel")}
      </span>

      {backend?.kind !== "inference_only" && (
        <RuntimeControls className="pl-1" size="xs" />
      )}
    </header>
  );
}

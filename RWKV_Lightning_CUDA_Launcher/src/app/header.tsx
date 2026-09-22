import { LogDockToggle } from "@/app/log-dock";
import { RailToggle } from "@/app/rail";
import { NodeProcessMenu } from "@/components/node-processes";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useRoute, type Route } from "@/lib/router";
import { usePageTitle } from "@/stores/ui";

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
  // Pages carry their own <h1>; printing the same words here too was the
  // "节点总览 / 节点总览" stutter. Show the view name in the bar only when the
  // page has no heading of its own (Chat) or has scrolled past it.
  const inlineTitle = usePageTitle((s) => s.inlineVisible);

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

      {!inlineTitle && (
        <span className="animate-fade-in truncate text-[13.5px] font-medium">
          {t(TITLES[route])}
        </span>
      )}

      <div className="flex-1" />

      {/* Status and commands are the same object: one chip that reports the
          node's inference state and opens the three process rows. The bare
          Start / Stop / Restart used to sit here on every page, which put an
          unlabelled pair directly above each page's own labelled pair. */}
      <NodeProcessMenu />

      <LogDockToggle />
    </header>
  );
}

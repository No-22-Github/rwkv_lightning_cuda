import { useState } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useChat } from "@/stores/chat";
import { useSettings } from "@/stores/settings";

const chipClass =
  "inline-flex h-6 min-w-0 max-w-[220px] items-center rounded-full border border-border px-2.5 text-[11.5px] text-muted-foreground";

function Chip({ children }: { children: string }) {
  return (
    <span className={chipClass}>
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Draft box pinned to the bottom of the chat column. */
export function Composer({
  backendId,
  disabled,
  streaming,
}: {
  backendId: string;
  disabled: boolean;
  streaming: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const generation = useSettings((s) => s.generation);
  const stop = useChat((s) => s.stop);

  const submit = () => {
    const text = draft.trim();
    if (!text || disabled || streaming) return;
    setDraft("");
    void useChat.getState().send(backendId, text);
  };

  return (
    <div>
      <div className="rounded-xl border border-border bg-card">
        <Textarea
          value={draft}
          rows={3}
          placeholder={t("chat.placeholder")}
          className="h-[82px] resize-none rounded-none border-0 bg-transparent px-3.5 py-3 focus-visible:ring-0"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            // IME composition commits with Enter too; never send from it.
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }}
        />

        <div className="flex items-center gap-1.5 border-t border-border px-3.5 py-2">
          <Chip>
            {`state: ${generation.state_id || t("chat.stateNone")}`}
          </Chip>
          <Chip>
            {`MiSS: ${generation.adapter_id || t("chat.adapterNone")}`}
          </Chip>
          <Chip>{`think: ${generation.think_type}`}</Chip>
          <div className="flex-1" />
          {streaming ? (
            <Button onClick={stop}>
              <Square className="size-3.5" />
              {t("chat.stop")}
            </Button>
          ) : (
            <Button
              variant="default"
              disabled={!draft.trim() || disabled}
              onClick={submit}
            >
              <Send className="size-3.5" />
              {t("chat.send")}
            </Button>
          )}
        </div>
      </div>

      <p className={cn("mt-2 px-1 text-[11.5px] text-muted-foreground")}>
        {disabled ? (
          <>
            {t("chat.emptyBody")}{" "}
            <a
              href="#/runtime"
              className="text-info underline underline-offset-2"
            >
              {t("runtime.title")}
            </a>
          </>
        ) : (
          "Enter to send · Shift + Enter for a new line"
        )}
      </p>
    </div>
  );
}

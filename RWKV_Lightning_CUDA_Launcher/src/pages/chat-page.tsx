import "highlight.js/styles/github-dark-dimmed.css";
import { useEffect, useRef } from "react";
import { MessageSquare, Plus } from "lucide-react";
import { useCurrent } from "@/app/use-current";
import { Composer } from "@/components/chat/composer";
import { GenerationPanel } from "@/components/chat/generation-panel";
import { MessageBubble } from "@/components/chat/message-bubble";
import { modelName } from "@/components/node-status";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n";
import { useChat, useStreaming, useThread } from "@/stores/chat";

/** How close to the bottom the viewport must be to keep following the stream. */
const FOLLOW_THRESHOLD = 80;

export function ChatPage() {
  const { t } = useI18n();
  const { backendId, backend, runtime, canInfer } = useCurrent();
  const thread = useThread(backendId);
  const streaming = useStreaming(backendId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  const disabled = !backendId || !canInfer;

  // Follow new tokens only while the reader is already at the bottom.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !follow.current) return;
    node.scrollTop = node.scrollHeight;
  }, [thread, streaming]);

  // A different node is a different conversation: start at its latest message.
  useEffect(() => {
    follow.current = true;
  }, [backendId]);

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_288px]">
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-3">
          <h1 className="shrink-0 text-[13px] font-semibold">
            {t("chat.title")}
          </h1>
          <span className="text-muted-foreground">·</span>
          <span className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground">
            {backend?.name ?? "—"} / {modelName(runtime) || "—"}
          </span>
          <div className="flex-1" />
          <Button
            size="sm"
            disabled={!backendId}
            onClick={() => useChat.getState().reset(backendId)}
          >
            <Plus className="size-3.5" />
            {t("chat.newChat")}
          </Button>
        </div>

        <div
          ref={scrollRef}
          onScroll={(event) => {
            const node = event.currentTarget;
            follow.current =
              node.scrollHeight - node.scrollTop - node.clientHeight <
              FOLLOW_THRESHOLD;
          }}
          className="min-h-0 flex-1 overflow-auto px-5 py-5.5"
        >
          {thread.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                className="w-full max-w-[560px]"
                icon={<MessageSquare className="size-7" strokeWidth={1.5} />}
                title={t("chat.emptyTitle")}
                body={t("chat.emptyBody")}
              />
            </div>
          ) : (
            <div className="mx-auto flex max-w-[720px] flex-col gap-4.5">
              {thread.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  assistantName={t("chat.assistant")}
                />
              ))}
            </div>
          )}
        </div>

        <div className="px-5 pb-4.5">
          <Composer
            backendId={backendId}
            disabled={disabled}
            streaming={streaming}
          />
        </div>
      </div>

      <aside className="overflow-auto border-l border-border bg-card p-4">
        <GenerationPanel backendId={backendId} />
      </aside>
    </div>
  );
}

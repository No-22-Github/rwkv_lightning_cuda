import { memo, useMemo } from "react";
import { ExternalLink } from "lucide-react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { CopyButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/primitives";
import {
  extractHTMLDocuments,
  formatHTMLForMarkdown,
  openHTMLPreview,
} from "@/lib/chat/html";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useChat, type ChatMessage } from "@/stores/chat";

/**
 * One conversation turn. User turns are right-aligned bubbles; assistant turns
 * render Markdown (with the loose-HTML fence fix) on a transparent background.
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  assistantName,
}: {
  message: ChatMessage;
  assistantName: string;
}) {
  const { t } = useI18n();
  // A reply is only "streaming" while its own thread is producing tokens; an
  // empty streaming reply must not flash the "…" placeholder.
  const streaming = useChat((s) => s.active !== null);
  const isUser = message.role === "user";

  const documents = useMemo(
    () => (isUser ? [] : extractHTMLDocuments(message.content)),
    [isUser, message.content],
  );
  const rendered = useMemo(
    () => (isUser ? message.content : formatHTMLForMarkdown(message.content)),
    [isUser, message.content],
  );

  const empty = message.content.trim().length === 0;

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-1.5",
        isUser ? "items-end" : "items-start",
      )}
    >
      <div className="text-[11px] font-medium text-muted-foreground">
        {isUser ? t("chat.you") : assistantName}
      </div>

      {isUser ? (
        <div className="max-w-[86%] rounded-xl border border-border bg-accent px-3.5 py-2.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap">
          {message.content}
        </div>
      ) : (
        <div className="md-body w-full min-w-0">
          <Markdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {empty && !streaming ? "…" : rendered}
          </Markdown>
        </div>
      )}

      {message.error && (
        <Notice tone="danger" className="w-full">
          {message.error}
        </Notice>
      )}

      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5",
          isUser && "justify-end",
        )}
      >
        <CopyButton text={message.content} />
        {documents.length > 0 && (
          <Button
            size="xs"
            onClick={() => openHTMLPreview(documents.at(-1)!)}
          >
            <ExternalLink className="size-3.5" />
            {t("chat.preview")}
          </Button>
        )}
        {message.finishReason && (
          <span className="font-mono text-[11px] text-muted-foreground">
            finish_reason: {message.finishReason}
          </span>
        )}
      </div>
    </article>
  );
});

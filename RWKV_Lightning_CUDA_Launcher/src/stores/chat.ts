import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { generationBody } from "@/lib/api/client";
import { inferenceApi } from "@/lib/api/inference";
import type { StreamEvent } from "@/lib/api/sse";
import { storage, useSettings } from "./settings";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: string;
  finishReason?: string;
}

interface ChatState {
  /** One thread per backend ID: switching nodes never mixes conversations. */
  threads: Record<string, ChatMessage[]>;
  /** Backend ID currently streaming, or null. */
  active: string | null;
  send: (backendId: string, text: string, retry?: boolean) => Promise<void>;
  stop: () => void;
  reset: (backendId: string) => void;
  clearAll: () => void;
}

let controller: AbortController | null = null;

export const useChat = create(
  persist<ChatState>(
    (set, get) => ({
      threads: {},
      active: null,

      send: async (backendId, text, retry = false) => {
        if (!backendId || get().active) return;
        const existing = get().threads[backendId] ?? [];
        if (retry ? existing.length === 0 : !text.trim()) return;

        let history: ChatMessage[];
        if (retry) {
          let last = existing.length - 1;
          while (last >= 0 && existing[last].role !== "user") last--;
          if (last < 0) return;
          history = existing.slice(0, last + 1);
        } else {
          history = [
            ...existing,
            { id: crypto.randomUUID(), role: "user", content: text.trim() },
          ];
        }

        const reply: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
        };
        controller = new AbortController();
        const signal = controller.signal;
        set((s) => ({
          threads: { ...s.threads, [backendId]: [...history, reply] },
          active: backendId,
        }));

        // Throttle store writes: a token stream would otherwise re-render on
        // every single SSE frame.
        let timer: number | undefined;
        const flush = () => {
          if (timer !== undefined) {
            window.clearTimeout(timer);
            timer = undefined;
          }
          set((s) => ({
            threads: {
              ...s.threads,
              [backendId]: (s.threads[backendId] ?? []).map((m) =>
                m.id === reply.id ? { ...reply } : m,
              ),
            },
          }));
        };

        try {
          const generation = useSettings.getState().generation;
          await inferenceApi.streamChat(
            backendId,
            {
              ...generationBody(generation),
              stream: true,
              stop_tokens: [0, 261, 24281],
              messages: history.map(({ role, content }) => ({ role, content })),
            },
            signal,
            (event: StreamEvent) => {
              for (const choice of event.choices ?? []) {
                reply.content += choice.delta?.content ?? "";
                if (choice.finish_reason)
                  reply.finishReason = choice.finish_reason ?? undefined;
              }
              if (timer === undefined) timer = window.setTimeout(flush, 60);
            },
          );
        } catch (error) {
          reply.error = signal.aborted
            ? "Generation stopped."
            : error instanceof Error
              ? error.message
              : String(error);
        } finally {
          flush();
          controller = null;
          set({ active: null });
        }
      },

      stop: () => controller?.abort(),

      reset: (backendId) =>
        set((s) => {
          const threads = { ...s.threads };
          delete threads[backendId];
          return { threads };
        }),

      clearAll: () => {
        controller?.abort();
        controller = null;
        set({ threads: {}, active: null });
      },
    }),
    {
      name: "rwkv-chat-v2",
      version: 2,
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({ threads: s.threads }) as ChatState,
    },
  ),
);

const EMPTY_THREAD: ChatMessage[] = [];

export function useThread(backendId: string) {
  return useChat((s) => s.threads[backendId] ?? EMPTY_THREAD);
}

export function useStreaming(backendId: string) {
  return useChat((s) => s.active === backendId);
}

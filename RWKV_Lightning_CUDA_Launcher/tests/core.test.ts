import { describe, it, expect } from "bun:test";

/**
 * These are pure-logic and server-render tests, but the persisted settings
 * store still touches browser globals. Shim the minimum Bun does not provide.
 */
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: (handler: () => void, timeout?: number) =>
      setTimeout(handler, timeout),
    clearTimeout: (id: number) => clearTimeout(id),
    setInterval: (handler: () => void, timeout?: number) =>
      setInterval(handler, timeout),
    clearInterval: (id: number) => clearInterval(id),
  },
});
import { SSEParser, readSSE } from "../src/lib/api/sse";
import { chunkText, translationPrompt } from "../src/lib/translate/chunk";
import {
  createTranslationScheduler,
  orderedMerge,
  type TranslateChunk,
} from "../src/lib/translate/scheduler";
import { resolveTheme } from "../src/stores/settings";
import { defaultTuning } from "../src/lib/api/launcher";
import { normalizeLanguage } from "../src/lib/translate/languages";
import {
  buildHTMLPreviewDocument,
  extractHTMLDocuments,
  formatHTMLForMarkdown,
} from "../src/lib/chat/html";
import { suggestedQuantizedPath } from "../src/lib/api/launcher";
import {
  adapterFields,
  adapterIDFromFilename,
  generationBody,
} from "../src/lib/api/client";
it("derives an adapter ID for state-like file upload", () => {
  expect(adapterIDFromFilename("adapter-final.pth")).toBe("adapter-final");
  expect(adapterIDFromFilename("HTML.PTH")).toBe("HTML");
  expect(adapterIDFromFilename(".pth")).toBe("adapter");
});
it("omits unset adapter fields and preserves explicit zero scale", () => {
  expect(
    adapterFields({
      adapter_id: "",
      adapter_version: "stale",
      adapter_scale: "1",
    }),
  ).toEqual({});
  expect(adapterFields({ adapter_id: "html", adapter_scale: "" })).toEqual({
    adapter_id: "html",
  });
  expect(
    adapterFields({
      adapter_id: "html",
      adapter_version: "v1",
      adapter_scale: "0",
    }),
  ).toEqual({ adapter_id: "html", adapter_version: "v1", adapter_scale: 0 });
  expect(() =>
    adapterFields({ adapter_id: "html", adapter_scale: "NaN" }),
  ).toThrow();
  expect(
    generationBody({ adapter_id: "", adapter_scale: "", state_id: "initial" }),
  ).toEqual({ state_id: "initial" });
});
const stream = (parts: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const part of parts) c.enqueue(new TextEncoder().encode(part));
      c.close();
    },
  });
const event = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`;
describe("SSE framing and disconnect semantics", () => {
  it("handles every possible text split with LF and CRLF", () => {
    for (const newline of ["\n", "\r\n"]) {
      const input = [
        ": keep alive",
        "data: one",
        "",
        "data: two",
        "data: three",
        "",
        "data: [DONE]",
        "",
        "",
      ].join(newline);
      for (let split = 0; split <= input.length; split++) {
        const output: string[] = [];
        const p = new SSEParser((s) => output.push(s));
        p.push(input.slice(0, split));
        p.push(input.slice(split));
        expect(output).toEqual(["one", "two\nthree", "[DONE]"]);
      }
    }
  });
  it("handles UTF-8 characters split between network bytes", async () => {
    const bytes = new TextEncoder().encode(
      event("你好🙂") + "data: [DONE]\n\n",
    );
    let output = "";
    await readSSE(
      new ReadableStream({
        start(c) {
          for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
          c.close();
        },
      }),
      new AbortController().signal,
      (e) => (output += e.choices?.[0].delta?.content || ""),
    );
    expect(output).toBe("你好🙂");
  });
  it("reports finish reason and preserves partial output on backend disconnect", async () => {
    let output = "";
    await expect(
      readSSE(
        stream([event("partial")]),
        new AbortController().signal,
        (e) => (output += e.choices?.[0].delta?.content || ""),
      ),
    ).rejects.toThrow("disconnected");
    expect(output).toBe("partial");
    let reason = "";
    await readSSE(
      stream([
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
      ]),
      new AbortController().signal,
      (e) => (reason = e.choices?.[0].finish_reason || ""),
    );
    expect(reason).toBe("length");
  });
  it("surfaces malformed and backend error events", async () => {
    await expect(
      readSSE(
        stream(["data: nope\n\n"]),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Malformed");
    await expect(
      readSSE(
        stream(['data: {"error":"CUDA out of memory"}\n\n']),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("CUDA out of memory");
  });
  it("cancels a stalled stream when aborted", async () => {
    const controller = new AbortController();
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    });
    const task = readSSE(body, controller.signal, () => {});
    controller.abort();
    await expect(task).rejects.toThrow();
    expect(canceled).toBe(true);
  });
});
describe("translation line segmentation", () => {
  it("creates one task per non-empty normalized line", () => {
    const chunks = chunkText(
      " First sentence. Second sentence!\r\n\r\n你好，世界。下一段内容！\n final line ",
    );
    expect(chunks).toEqual([
      "First sentence. Second sentence!",
      "你好，世界。下一段内容！",
      "final line",
    ]);
  });
  it("keeps long lines intact and ignores blank lines", () => {
    for (const text of ["🙂".repeat(500), "!?。！？\n\n", "x".repeat(1000)])
      expect(chunkText(text).join("")).toBe(text.trim());
    expect(chunkText("")).toEqual([]);
  });
  it("uses exact language-name continuation prompts", () => {
    expect(translationPrompt("Hello", "English", "Chinese")).toBe(
      "English: Hello\n\nChinese:",
    );
    expect(translationPrompt("你好", "Chinese", "Custom Language")).toBe(
      "Chinese: 你好\n\nCustom Language:",
    );
  });
  it("normalizes removed or unknown saved language values", () => {
    expect(normalizeLanguage("Japanese", "English")).toBe("Japanese");
    expect(normalizeLanguage("Auto", "English")).toBe("English");
  });
});
const chunks = (n: number): TranslateChunk[] =>
  Array.from({ length: n }, (_, id) => ({
    id,
    source: String(id),
    prompt: "",
    translated: "",
    status: "pending",
  }));
describe("worker scheduler", () => {
  it("enforces hard concurrency and merges out-of-order completions by ID", async () => {
    let active = 0,
      max = 0;
    const list = chunks(12);
    const completions: number[] = [];
    const scheduler = createTranslationScheduler({
      chunks: list,
      concurrency: 3,
      onProgress: () => {},
      execute: async (c) => {
        active++;
        max = Math.max(max, active);
        await new Promise((r) => setTimeout(r, (3 - (c.id % 3)) * 5));
        c.translated = String(c.id);
        completions.push(c.id);
        active--;
      },
    });
    await scheduler.run();
    expect(max).toBe(3);
    expect(completions[0]).not.toBe(0);
    expect(orderedMerge([...list].reverse())).toBe(
      list.map((c) => c.id).join("\n\n"),
    );
    expect(list.every((c) => c.status === "done")).toBe(true);
  });
  it("aborts in-flight tasks and dispatches no more after stop", async () => {
    const list = chunks(20);
    let started = 0;
    const scheduler = createTranslationScheduler({
      chunks: list,
      concurrency: 4,
      onProgress: () => {},
      execute: async (_, signal) => {
        started++;
        await new Promise<void>((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      },
    });
    const task = scheduler.run();
    expect(started).toBe(4);
    scheduler.stop();
    await task;
    expect(started).toBe(4);
    expect(list.every((c) => c.status === "pending")).toBe(true);
  });
  it("continues after individual errors and supports retrying only failed chunks", async () => {
    const list = chunks(6);
    await createTranslationScheduler({
      chunks: list,
      concurrency: 2,
      onProgress: () => {},
      execute: async (c) => {
        if (c.id === 2) throw new Error("HTTP 500");
        c.translated = "ok";
      },
    }).run();
    expect(list[2].status).toBe("error");
    expect(list[5].status).toBe("done");
    await createTranslationScheduler({
      chunks: list.filter((c) => c.status === "error"),
      concurrency: 1,
      onProgress: () => {},
      execute: async (c) => {
        c.translated = "retry";
      },
    }).run();
    expect(list[2].translated).toBe("retry");
    expect(list[2].status).toBe("done");
  });
  it("rejects invalid concurrency", () => {
    for (const concurrency of [0, -1, 129, 1.5, NaN])
      expect(() =>
        createTranslationScheduler({
          chunks: [],
          concurrency,
          onProgress: () => {},
          execute: async () => {},
        }),
      ).toThrow();
  });
});

describe("theme selection", () => {
  it("supports explicit dark/light and follows the system preference", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("invalid", true)).toBe("dark");
  });
});

describe("generated HTML previews", () => {
  it("extracts fenced and complete raw HTML without matching prose", () => {
    expect(
      extractHTMLDocuments(
        "Here you go:\n```html\n<!doctype html><h1>Hello</h1>\n```",
      ),
    ).toEqual(["<!doctype html><h1>Hello</h1>"]);
    expect(extractHTMLDocuments("<html><body>raw</body></html>")).toEqual([
      "<html><body>raw</body></html>",
    ]);
    expect(extractHTMLDocuments("Use an <html> element.")).toEqual([]);
    expect(extractHTMLDocuments("```html\n<div>unfinished</div>")).toEqual([]);
  });
  it("wraps standalone HTML for stable Markdown rendering", () => {
    const raw =
      '<!DOCTYPE html>\n<html lang="zh-CN"><body><script>const value = `ok`</script></body></html>';
    const formatted = formatHTMLForMarkdown(raw);
    expect(formatted).toStartWith("```html\n<!DOCTYPE html>");
    expect(formatted).toEndWith("\n```");
    expect(formatHTMLForMarkdown("Here is `<html>`.")).toBe(
      "Here is `<html>`.",
    );
  });
  it("repairs quoted HTML with an orphan closing fence and keeps the explanation", () => {
    const malformed =
      "><!DOCTYPE html>\n" +
      '<html lang="zh-CN"><body>SVG animation</body></html>\n' +
      "```\n" +
      "这是一个完全用 SVG 手绘的鹈鹕骑自行车动画。";
    expect(extractHTMLDocuments(malformed)).toEqual([
      '<!DOCTYPE html>\n<html lang="zh-CN"><body>SVG animation</body></html>',
    ]);
    const formatted = formatHTMLForMarkdown(malformed);
    expect(formatted).toStartWith("```html\n<!DOCTYPE html>");
    expect(formatted).toContain("</html>\n```\n\n这是一个完全用 SVG");
    expect(formatted.match(/```/g)).toHaveLength(2);
  });
  it("renders generated markup in an isolated sandboxed iframe", () => {
    const preview = buildHTMLPreviewDocument(
      '<script>document.body.textContent="ok"</script>',
    );
    expect(preview).toContain(
      'sandbox="allow-scripts allow-forms allow-modals"',
    );
    expect(preview).not.toContain("allow-same-origin");
    expect(preview).toContain("&lt;script&gt;");
  });
  it("adds the preview action only to assistant HTML messages", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { MessageBubble } = await import(
      "../src/components/chat/message-bubble"
    );
    const { translate } = await import("../src/lib/i18n");
    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        assistantName: "RWKV",
        message: {
          id: "answer",
          role: "assistant",
          content: "```html\n<!doctype html><h1>Preview</h1>\n```",
        },
      }),
    );
    expect(html).toContain(translate("zh", "chat.preview"));
  });
  it("displays unfenced assistant HTML as one highlighted code block", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { MessageBubble } = await import(
      "../src/components/chat/message-bubble"
    );
    const { translate } = await import("../src/lib/i18n");
    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        assistantName: "RWKV",
        message: {
          id: "raw-answer",
          role: "assistant",
          content:
            '<!DOCTYPE html>\n<html lang="zh-CN"><head></head><body>ok</body></html>',
        },
      }),
    );
    expect(html).toContain('<code class="hljs language-html">');
    expect(html).toContain("&lt;!DOCTYPE");
    expect(html).toContain('hljs-keyword">html</span>&gt;');
    expect(html).not.toContain("<blockquote>");
    expect(html).toContain(translate("zh", "chat.preview"));
  });
  it("renders the malformed model response as HTML code followed by prose", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { MessageBubble } = await import(
      "../src/components/chat/message-bubble"
    );
    const { translate } = await import("../src/lib/i18n");
    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        assistantName: "RWKV",
        message: {
          id: "quoted-html-answer",
          role: "assistant",
          content:
            "><!DOCTYPE html>\n<html><body>ok</body></html>\n```\n这是后续说明。",
        },
      }),
    );
    expect(html).toContain('<code class="hljs language-html">');
    expect(html).toContain("<p>这是后续说明。</p>");
    expect(html).not.toContain("<blockquote>");
    expect(html).toContain(translate("zh", "chat.preview"));
  });
});

it("suggests quantized model names for both formats", () => {
  expect(suggestedQuantizedPath("/models/demo.pth", "w4a16")).toBe(
    "/models/demo.w4a16.rwkvq",
  );
  expect(suggestedQuantizedPath("C:\\models\\DEMO.PTH", "w8a16")).toBe(
    "C:\\models\\DEMO.w8a16.rwkvq",
  );
});

it("uses the recommended state tuning defaults", () => {
  expect(defaultTuning).toMatchObject({
    ctx: 512,
    chunk: 128,
    epochs: 1,
    lr: 0.0005,
    lr_final: 0.0001,
    warmup_steps: 10,
    save_every: 100,
    batch_size: 16,
    optimizer: "adam",
    wkv_tape: false,
  });
});

it("shows optimizer and shared WKV tape controls", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { TrainingPage } = await import("../src/pages/training-page");
  const html = renderToStaticMarkup(createElement(TrainingPage));
  // The optimizer select is a wire-value select, and MiSS pins it to adam.
  expect(html).toContain('<option value="adam" selected="">adam</option>');
  expect(html).toContain('<option value="muon">muon</option>');
  expect(html).toContain("wkv_tape");
  expect(html).toContain("State tuning");
  expect(html).toContain("MiSS");
});

it("allows arbitrary positive learning-rate decimals in the tuning form", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { TrainingPage } = await import("../src/pages/training-page");
  const html = renderToStaticMarkup(createElement(TrainingPage));
  expect(html.match(/step="any"/g)).toHaveLength(2);
  expect(html).toContain('value="0.0005"');
  expect(html).toContain('value="0.0001"');
});

describe("GPU memory formatting", () => {
  it("spells the unit once so the rail row fits on one line", async () => {
    const { formatGigabytePair } = await import("../src/lib/format");
    const GiB = 1024 ** 3;
    // The 216px rail card leaves ~158px for this row plus the temp/power
    // pair; "61.5 GB / 95.6 GB" overflowed it and wrapped both halves.
    expect(formatGigabytePair(61.5 * GiB, 95.6 * GiB)).toBe("61.5 / 95.6 GB");
    expect(formatGigabytePair(0.6 * GiB, 95.6 * GiB)).toBe("0.6 / 95.6 GB");
  });

  it("reports an em dash when either side is missing", async () => {
    const { formatGigabytePair } = await import("../src/lib/format");
    expect(formatGigabytePair(undefined, 1024 ** 3)).toBe("—");
    expect(formatGigabytePair(1024 ** 3, null)).toBe("—");
    expect(formatGigabytePair(NaN, 1024 ** 3)).toBe("—");
  });
});

describe("loaded model reporting", () => {
  it("does not present a configured path as a loaded model", async () => {
    const { modelName } = await import("../src/components/node-status");
    const config = { model_path: "/models/rwkv-g1k-7b.pth" };
    // Offline node: the mockup shows "—", not the path it was asked to load.
    expect(
      modelName({ status: "offline", config } as never),
    ).toBe("");
    expect(modelName({ status: "ready", config } as never)).toBe(
      "rwkv-g1k-7b.pth",
    );
  });
});

import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";

/* ------------------------------------------------------------------ *
 * Browser shims. Zustand's persist middleware and the hash router both
 * read globals that do not exist in the Bun runtime.
 * ------------------------------------------------------------------ */
const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});
Object.defineProperty(globalThis, "location", {
  configurable: true,
  value: { origin: "http://127.0.0.1:10721", hash: "#/nodes" },
});
// The stores schedule through `window.*` timers; Bun only exposes the bare
// globals.
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    setTimeout: (handler: () => void, timeout?: number) =>
      setTimeout(handler, timeout),
    clearTimeout: (id: number) => clearTimeout(id),
    setInterval: (handler: () => void, timeout?: number) =>
      setInterval(handler, timeout),
    clearInterval: (id: number) => clearInterval(id),
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  },
});

const { useBackends } = await import("../src/stores/backends");
const { useNodes } = await import("../src/stores/nodes");
const { useChat } = await import("../src/stores/chat");
const { useTranslate } = await import("../src/stores/translate");
const { useSettings, useSecret } = await import("../src/stores/settings");
const { useRuntimeForm, useQuantizationForm, useTuningForm } = await import(
  "../src/stores/forms"
);
const { applyDevice, deviceSelection, defaultRuntime } = await import(
  "../src/lib/api/launcher"
);

const fetchTarget = globalThis as unknown as {
  fetch: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
};
const fetchSpy = spyOn(fetchTarget, "fetch");
afterAll(() => fetchSpy.mockRestore());

const sseStream = (text: string, done = true) =>
  new Response(
    `data: ${JSON.stringify({
      choices: [{ index: 0, delta: { content: text } }],
    })}\n\n${done ? "data: [DONE]\n\n" : ""}`,
    { headers: { "Content-Type": "text/event-stream" } },
  );

const batchResponse = (texts: string[]) =>
  Response.json({
    choices: texts.map((text, index) => ({
      index,
      message: { role: "assistant", content: text },
      finish_reason: "stop",
    })),
  });

const json = (body: unknown) => Response.json(body);

/** Requests captured by the current mock, in call order. */
interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

function capture(): Call[] {
  const calls: Call[] = [];
  fetchSpy.mockImplementation(async (input, init) => {
    const url = String(input);
    const raw = init?.body;
    const parsed =
      typeof raw === "string"
        ? (JSON.parse(raw) as Record<string, unknown>)
        : null;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: parsed,
    });
    if (url.includes("/v1/chat/completions")) return sseStream("answer");
    if (url.includes("/v1/batch/completions")) {
      // One choice per prompt, indexed to match `contents[]`.
      const contents = (parsed?.contents as string[] | undefined) ?? [];
      return batchResponse(contents.map((_, index) => `译文 ${index + 1}`));
    }
    if (url.endsWith("/api/v1/backends")) return json({ backends: [] });
    return json({});
  });
  return calls;
}

afterEach(() => {
  useChat.getState().clearAll();
  useTranslate.getState().clear();
  useSettings.getState().reset();
  useSecret.getState().setKey("");
  useRuntimeForm.getState().reset();
  useQuantizationForm.getState().reset();
  useTuningForm.getState().reset();
  useBackends.setState({ list: [], currentId: "", error: "", loaded: false });
  useNodes.setState({ snapshots: {}, busy: {} });
  values.clear();
  fetchSpy.mockReset();
});

const backend = {
  id: "a1b2c3",
  name: "gpu-01",
  base_url: "http://10.0.0.21:18766",
  has_token: true,
  kind: "agent" as const,
  legacy: false,
  capabilities: ["runtime", "tuning_state", "quantization", "metrics", "fs"],
  reachable: true,
  last_probe: 1_758_240_000,
  probe_error: "",
};

describe("backend registry", () => {
  it("lists nodes, keeps the selection and falls back to the first entry", async () => {
    useBackends.setState({ currentId: "gone" });
    fetchSpy.mockImplementation(async () =>
      json({ backends: [backend, { ...backend, id: "local", name: "本机" }] }),
    );
    await useBackends.getState().refresh();
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/v1/backends");
    expect(useBackends.getState().list).toHaveLength(2);
    // The previously selected id no longer exists.
    expect(useBackends.getState().currentId).toBe("a1b2c3");
  });

  it("keeps a still-valid selection across refreshes", async () => {
    fetchSpy.mockImplementation(async () => json({ backends: [backend] }));
    await useBackends.getState().refresh();
    useBackends.getState().select("a1b2c3");
    await useBackends.getState().refresh();
    expect(useBackends.getState().currentId).toBe("a1b2c3");
  });

  it("adds a backend through the Client registry endpoint", async () => {
    fetchSpy.mockImplementation(async () => json(backend));
    const view = await useBackends.getState().add({
      name: "gpu-01",
      base_url: "http://10.0.0.21:18766",
      token: "secret",
    });
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/v1/backends");
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({
      name: "gpu-01",
      base_url: "http://10.0.0.21:18766",
      token: "secret",
    });
    expect(view.id).toBe("a1b2c3");
    expect(useBackends.getState().currentId).toBe("a1b2c3");
  });
});

describe("node snapshots", () => {
  it("polls the node through the backend prefix and keeps jobs alongside", async () => {
    useBackends.setState({ list: [backend], currentId: backend.id });
    fetchSpy.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/node"))
        return json({
          status: "ready",
          running: true,
          error: "",
          logs: [],
          elapsed: 12,
          checkpoint: "",
          progress: null,
          losses: [],
          config: defaultRuntime,
          base_url: "http://127.0.0.1:8000",
          translation_adapter: false,
          available: true,
          visible_devices: "0,1",
          role: "agent",
          version: "dev",
          capabilities: ["runtime", "metrics"],
        });
      if (url.endsWith("/api/v1/jobs"))
        return json({
          jobs: {
            tuning: {
              status: "running",
              running: true,
              error: "",
              logs: [],
              elapsed: 3,
              checkpoint: "",
              progress: { step: 5, total: 10 },
              losses: [],
            },
            quantization: {
              status: "offline",
              running: false,
              error: "",
              logs: [],
              elapsed: 0,
              checkpoint: "",
              progress: null,
              losses: [],
            },
          },
        });
      return json({});
    });

    await useNodes.getState().refresh(backend.id);
    const urls = fetchSpy.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([
      "/api/v1/backends/a1b2c3/api/v1/node",
      "/api/v1/backends/a1b2c3/api/v1/jobs",
    ]);
    const snapshot = useNodes.getState().snapshots[backend.id];
    expect(snapshot.runtime?.status).toBe("ready");
    expect(snapshot.runtime?.visible_devices).toBe("0,1");
    expect(snapshot.jobs?.tuning.running).toBe(true);
    expect(snapshot.error).toBe("");
  });

  it("does not call the Agent API for an inference-only node", async () => {
    useBackends.setState({
      list: [{ ...backend, kind: "inference_only", capabilities: ["inference"] }],
      currentId: backend.id,
    });
    fetchSpy.mockImplementation(async () => json({}));
    await useNodes.getState().refresh(backend.id);
    expect(fetchSpy.mock.calls).toHaveLength(0);
  });

  it("records a probe/refresh failure instead of throwing", async () => {
    useBackends.setState({ list: [backend], currentId: backend.id });
    fetchSpy.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: "dial tcp: refused" }), {
          status: 502,
        }),
    );
    await useNodes.getState().refresh(backend.id);
    expect(useNodes.getState().snapshots[backend.id].error).toContain(
      "dial tcp: refused",
    );
  });
});

describe("runtime control", () => {
  it("starts the runtime with the full config plus the device selection", async () => {
    useBackends.setState({ list: [backend], currentId: backend.id });
    const calls = capture();
    useRuntimeForm.getState().set({ model_path: "/data/models/m.pth" });
    useRuntimeForm.getState().setDevices({ mode: "explicit", value: "0,1" });
    await useNodes
      .getState()
      .startRuntime(
        backend.id,
        applyDevice({ ...useRuntimeForm.getState().config }, { mode: "explicit", value: "0,1" }),
      );
    const start = calls.find((call) => call.url.endsWith("/runtime/start"));
    expect(start?.url).toBe(
      "/api/v1/backends/a1b2c3/api/v1/runtime/start",
    );
    expect(start?.method).toBe("POST");
    expect(start?.body?.model_path).toBe("/data/models/m.pth");
    expect(start?.body?.visible_devices).toBe("0,1");
    // The full config is always submitted: the Agent decodes onto saved state.
    expect(start?.body).toHaveProperty("vocab_path");
    expect(start?.body).toHaveProperty("chunk_size");
    expect(start?.body).toHaveProperty("tune_cache");
  });

  it("omits visible_devices when the selection is 'inherit'", () => {
    const body = applyDevice({ ...defaultRuntime }, { mode: "inherit" });
    expect("visible_devices" in body).toBe(false);
  });

  it("distinguishes the three device-selection states", () => {
    expect(applyDevice({ ...defaultRuntime }, { mode: "none" }).visible_devices).toBe("");
    expect(
      applyDevice({ ...defaultRuntime }, { mode: "explicit", value: " 0 " })
        .visible_devices,
    ).toBe("0");
    expect(deviceSelection(undefined)).toEqual({ mode: "inherit" });
    expect(deviceSelection("")).toEqual({ mode: "none" });
    expect(deviceSelection("0,1")).toEqual({
      mode: "explicit",
      value: "0,1",
    });
  });

  it("accepts an empty body when stopping a job", async () => {
    useBackends.setState({ list: [backend], currentId: backend.id });
    fetchSpy.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/jobs/tuning/stop"))
        return new Response(null, { status: 200 });
      return json({});
    });
    await useNodes.getState().stopJob(backend.id, "tuning");
    const stopCall = fetchSpy.mock.calls.find((call) =>
      String(call[0]).endsWith("/jobs/tuning/stop"),
    );
    expect(stopCall).toBeDefined();
    expect(String(stopCall?.[0])).toBe(
      "/api/v1/backends/a1b2c3/api/v1/jobs/tuning/stop",
    );
  });
});

describe("chat streaming", () => {
  it("streams through the backend prefix and persists the answer", async () => {
    const calls = capture();
    await useChat.getState().send(backend.id, "Say hello");
    const call = calls.find((entry) => entry.url.includes("/v1/chat/completions"));
    expect(call?.url).toBe(
      "/api/v1/backends/a1b2c3/v1/chat/completions",
    );
    expect(call?.body?.stream).toBe(true);
    expect(call?.body?.stop_tokens).toEqual([0, 261, 24281]);
    expect(call?.body?.messages).toEqual([
      { role: "user", content: "Say hello" },
    ]);
    const thread = useChat.getState().threads[backend.id];
    expect(thread).toHaveLength(2);
    expect(thread[1].content).toBe("answer");
    expect(useChat.getState().active).toBeNull();
    expect(values.get("rwkv-chat-v2")).toContain("answer");
  });

  it("sends the selected state, thinking mode and MiSS adapter", async () => {
    const calls = capture();
    useSettings.getState().setGeneration({
      state_id: "roleplay.pth",
      think_type: "free",
      adapter_id: "zh-legal",
      adapter_version: "v1",
      adapter_scale: "0",
    });
    await useChat.getState().send(backend.id, "hello");
    const body = calls.find((entry) =>
      entry.url.includes("/v1/chat/completions"),
    )?.body;
    expect(body?.state_id).toBe("roleplay.pth");
    expect(body?.think_type).toBe("free");
    expect(body?.adapter_id).toBe("zh-legal");
    expect(body?.adapter_version).toBe("v1");
    // An explicit "0" scale must survive as the number 0, not be dropped.
    expect(body?.adapter_scale).toBe(0);
  });

  it("regenerates without duplicating the user message", async () => {
    capture();
    await useChat.getState().send(backend.id, "Say hello");
    await useChat.getState().send(backend.id, "", true);
    const thread = useChat.getState().threads[backend.id];
    expect(thread).toHaveLength(2);
    expect(thread.filter((message) => message.role === "user")).toHaveLength(1);
  });

  it("keeps partial output and reports a stream that ends before [DONE]", async () => {
    fetchSpy.mockImplementation(async () => sseStream("partial", false));
    await useChat.getState().send(backend.id, "hi");
    const reply = useChat.getState().threads[backend.id][1];
    expect(reply.content).toBe("partial");
    expect(reply.error).toContain("disconnected");
  });

  it("keeps one thread per backend", async () => {
    capture();
    await useChat.getState().send("a1b2c3", "first");
    await useChat.getState().send("local", "second");
    expect(useChat.getState().threads.a1b2c3[0].content).toBe("first");
    expect(useChat.getState().threads.local[0].content).toBe("second");
  });
});

describe("parallel translation", () => {
  it("sends one batch request per group of lines to /v1/batch/completions", async () => {
    const calls = capture();
    useTranslate.getState().set({
      source: "one\ntwo\nthree",
      concurrency: 3,
      from: "English",
      to: "Chinese",
    });
    await useTranslate.getState().run(backend.id);
    const batches = calls.filter((entry) =>
      entry.url.includes("/v1/batch/completions"),
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].url).toBe(
      "/api/v1/backends/a1b2c3/v1/batch/completions",
    );
    expect(batches[0].body?.stream).toBe(false);
    expect(batches[0].body?.stop_tokens).toEqual([0]);
    expect(batches[0].body?.contents).toEqual([
      "English: one\n\nChinese:",
      "English: two\n\nChinese:",
      "English: three\n\nChinese:",
    ]);
    const chunks = useTranslate.getState().chunks;
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.status === "done")).toBe(true);
    expect(useTranslate.getState().owner).toBe(backend.id);
  });

  it("caps each native batch at 128 lines", async () => {
    const calls = capture();
    fetchSpy.mockImplementation(async (input, init) => {
      const url = String(input);
      const parsed = JSON.parse(String(init?.body)) as {
        contents: string[];
      };
      calls.push({ url, method: "POST", body: parsed as never });
      return batchResponse(parsed.contents.map(() => "x"));
    });
    const lines = Array.from({ length: 130 }, (_, index) => `line ${index}`);
    useTranslate.getState().set({ source: lines.join("\n"), concurrency: 128 });
    await useTranslate.getState().run(backend.id);
    const sizes = calls
      .filter((entry) => entry.url.includes("/v1/batch/completions"))
      .map((entry) => (entry.body?.contents as string[]).length);
    expect(sizes).toEqual([128, 2]);
  });

  it("keeps results isolated per backend", async () => {
    capture();
    useTranslate.getState().set({ source: "one", concurrency: 1 });
    await useTranslate.getState().run("a1b2c3");
    expect(useTranslate.getState().owner).toBe("a1b2c3");
    const before = fetchSpy.mock.calls.length;
    // Retrying against a different node must not reuse the old results.
    await useTranslate.getState().run("local", [0]);
    expect(fetchSpy.mock.calls.length).toBe(before);
  });
});

describe("theme default", () => {
  it("follows the operating system unless the user picked a theme", async () => {
    const { defaults, resolveTheme, useSettings } = await import(
      "../src/stores/settings"
    );
    expect(defaults.theme).toBe("system");
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
    expect(useSettings.getState().theme).toBe("system");
  });

  it("migrates the old hard-coded dark default to system", async () => {
    const { useSettings } = await import("../src/stores/settings");
    const migrate = useSettings.persist.getOptions().migrate;
    expect(migrate).toBeFunction();
    // v2 stored a flat object; "dark" was the default rather than a choice.
    const fromV2 = migrate!({ theme: "dark", lang: "en" }, 2) as {
      theme: string;
      lang: string;
    };
    expect(fromV2.theme).toBe("system");
    expect(fromV2.lang).toBe("en");
    // An explicit light choice must survive.
    const light = migrate!({ theme: "light" }, 2) as { theme: string };
    expect(light.theme).toBe("light");
    // v1 nested everything under `values`.
    const fromV1 = migrate!({ values: { theme: "dark" } }, 1) as {
      theme: string;
    };
    expect(fromV1.theme).toBe("system");
    // Already-current data is returned untouched.
    const current = migrate!({ theme: "light" }, 3) as { theme: string };
    expect(current.theme).toBe("light");
  });
});

describe("log stream snapshots", () => {
  it("returns one stable reference for every missing stream", async () => {
    const { IDLE_STREAM, selectLogStream, useLogs } = await import(
      "../src/stores/logs"
    );
    // An unstable fallback would make useSyncExternalStore re-render forever,
    // which unmounts the Runtime / Training / Quantization pages.
    const streams = useLogs.getState().streams;
    expect(selectLogStream(streams, "a1b2c3", "runtime")).toBe(IDLE_STREAM);
    expect(selectLogStream(streams, "a1b2c3", "runtime")).toBe(
      selectLogStream(streams, "local", "tuning"),
    );
    // A real stream still wins over the fallback.
    expect(
      selectLogStream(
        { "a1b2c3:runtime": { lines: ["x"], status: "open", error: "" } },
        "a1b2c3",
        "runtime",
      ).lines,
    ).toEqual(["x"]);
  });
});

describe("credentials", () => {
  it("never writes the runtime password or the Agent token to storage", () => {
    useRuntimeForm.getState().set({ password: "runtime-secret" });
    useSecret.getState().setKey("agent-secret");
    const dump = [...values.values()].join("\n");
    expect(dump).not.toContain("runtime-secret");
    expect(dump).not.toContain("agent-secret");
    // The form itself still holds the password for this session.
    expect(useRuntimeForm.getState().config.password).toBe("runtime-secret");
  });

  it("does not persist the quantization form across resets", () => {
    useQuantizationForm.getState().set({ input_path: "/data/model.pth" });
    expect(useQuantizationForm.getState().config.input_path).toBe(
      "/data/model.pth",
    );
    useQuantizationForm.getState().reset();
    expect(useQuantizationForm.getState().config.input_path).toBe("");
  });
});

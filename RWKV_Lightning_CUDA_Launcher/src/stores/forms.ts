import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  defaultQuantization,
  defaultRuntime,
  defaultTuning,
} from "@/lib/api/launcher";
import type {
  DeviceSelection,
  QuantizationConfig,
  RuntimeConfig,
  TuningConfig,
} from "@/lib/api/types";
import { storage } from "./settings";

interface RuntimeFormState {
  config: RuntimeConfig;
  /** Tri-state device selector; kept separate from the wire string. */
  devices: DeviceSelection;
  set: (patch: Partial<RuntimeConfig>) => void;
  setDevices: (selection: DeviceSelection) => void;
  reset: () => void;
}

export const useRuntimeForm = create(
  persist<RuntimeFormState>(
    (set) => ({
      config: defaultRuntime,
      devices: { mode: "inherit" },
      set: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
      setDevices: (devices) => set({ devices }),
      reset: () => set({ config: defaultRuntime, devices: { mode: "inherit" } }),
    }),
    {
      name: "rwkv-runtime-form-v2",
      version: 2,
      storage: createJSONStorage(() => storage),
      // The runtime password never touches disk.
      partialize: (s) =>
        ({
          config: { ...s.config, password: "" },
          devices: s.devices,
        }) as RuntimeFormState,
    },
  ),
);

interface TuningFormState {
  config: TuningConfig;
  devices: DeviceSelection;
  set: (patch: Partial<TuningConfig>) => void;
  setDevices: (selection: DeviceSelection) => void;
  /** Restore every parameter while keeping the chosen paths. */
  resetParameters: () => void;
  reset: () => void;
}

export const useTuningForm = create(
  persist<TuningFormState>(
    (set) => ({
      config: defaultTuning,
      devices: { mode: "inherit" },
      set: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
      setDevices: (devices) => set({ devices }),
      resetParameters: () =>
        set((s) => ({
          config: {
            ...defaultTuning,
            method: s.config.method,
            model: s.config.model,
            data: s.config.data,
            output: s.config.output,
            vocab: s.config.vocab,
          },
        })),
      reset: () => set({ config: defaultTuning, devices: { mode: "inherit" } }),
    }),
    {
      name: "rwkv-tuning-form-v2",
      version: 2,
      storage: createJSONStorage(() => storage),
    },
  ),
);

interface QuantizationFormState {
  config: QuantizationConfig;
  devices: DeviceSelection;
  set: (patch: Partial<QuantizationConfig>) => void;
  setDevices: (selection: DeviceSelection) => void;
  reset: () => void;
}

export const useQuantizationForm = create(
  persist<QuantizationFormState>(
    (set) => ({
      config: defaultQuantization,
      devices: { mode: "inherit" },
      set: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
      setDevices: (devices) => set({ devices }),
      reset: () =>
        set({ config: defaultQuantization, devices: { mode: "inherit" } }),
    }),
    {
      name: "rwkv-quantization-form-v1",
      version: 1,
      storage: createJSONStorage(() => storage),
    },
  ),
);

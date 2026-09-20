import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "./settings";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: "default" | "success" | "error";
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }].slice(-4) }));
    window.setTimeout(
      () => get().dismiss(id),
      toast.variant === "error" ? 8000 : 4200,
    );
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Imperative helper so stores and event handlers can raise toasts. */
export const toast = {
  info: (title: string, description?: string) =>
    useToasts.getState().push({ title, description, variant: "default" }),
  success: (title: string, description?: string) =>
    useToasts.getState().push({ title, description, variant: "success" }),
  error: (title: string, description?: string) =>
    useToasts.getState().push({ title, description, variant: "error" }),
};

export type FsPicker = (path: string) => void;

interface UIState {
  addBackendOpen: boolean;
  /** Set while the shared remote-directory browser is open. */
  fsPicker: FsPicker | null;
  fsInitialPath: string;
  openAddBackend: () => void;
  closeAddBackend: () => void;
  openFsBrowser: (pick: FsPicker, initialPath?: string) => void;
  closeFsBrowser: () => void;
}

export const useUI = create<UIState>((set) => ({
  addBackendOpen: false,
  fsPicker: null,
  fsInitialPath: "",
  openAddBackend: () => set({ addBackendOpen: true }),
  closeAddBackend: () => set({ addBackendOpen: false }),
  openFsBrowser: (fsPicker, fsInitialPath = "") =>
    set({ fsPicker, fsInitialPath }),
  closeFsBrowser: () => set({ fsPicker: null, fsInitialPath: "" }),
}));

/** Whether the workspace rail is collapsed; kept in localStorage. */
interface RailState {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

export const useRail = create(
  persist<RailState>(
    (set) => ({
      collapsed: false,
      toggle: () => set((s) => ({ collapsed: !s.collapsed })),
      setCollapsed: (collapsed) => set({ collapsed }),
    }),
    { name: "rwkv-rail-v1", storage: createJSONStorage(() => storage) },
  ),
);

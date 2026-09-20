import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          markdown: ["react-markdown", "remark-gfm", "rehype-highlight"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:10721",
      "/v1": "http://127.0.0.1:10721",
      "/logs": "http://127.0.0.1:10721",
    },
  },
});

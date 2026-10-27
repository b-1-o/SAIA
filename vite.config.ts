import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { popup: resolve(process.cwd(), "popup.html") } }
  }
});
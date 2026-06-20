import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Vite options for Tauri, applied only in `tauri dev` / `tauri build`.
  clearScreen: false, // don't let Vite hide Rust errors
  server: {
    port: 1420, // Tauri expects this fixed port
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"], // src-tauri is Rust's, not Vite's
    },
  },
}));

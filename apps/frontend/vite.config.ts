import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { wellKnownPlugin } from "./vite-plugins/well-known";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss() as any, wellKnownPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/iw-generator/",        // <-- IMPORTANT for GitHub Project Pages
  build: {
    sourcemap: true,             // helps debug blank screens if something else breaks
  },
});

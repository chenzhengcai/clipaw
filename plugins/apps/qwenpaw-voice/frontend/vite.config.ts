import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vite";

// The console host loads plugin bundles via dynamic `import()` of a blob URL
// (console/src/plugins/usePluginLoader.ts executePluginScript), so the bundle
// MUST be an ES module.  react/react-dom come from the host at runtime
// (window.QwenPaw.host), so they are external and jsxRuntime is "classic"
// (React.createElement) — matching the proven qwenpaw-pet plugin setup.
export default defineConfig({
  plugins: [react({ jsxRuntime: "classic" })],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.tsx"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      external: ["react", "react-dom"],
    },
  },
});

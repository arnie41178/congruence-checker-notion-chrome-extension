import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./src/manifest.json";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      crx({ manifest }),
    ],
    define: {
      VITE_NOTION_CLIENT_ID: JSON.stringify(env.VITE_NOTION_CLIENT_ID ?? ""),
    },
    build: {
      rollupOptions: {
        input: {
          panel: "panel/index.html",
        },
      },
    },
  };
});

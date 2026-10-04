import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
      },
      "/health": "http://127.0.0.1:3000",
    },
  },
});

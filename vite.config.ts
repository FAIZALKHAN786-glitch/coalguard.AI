import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { createHash } from "node:crypto";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "offline-shell",
      writeBundle(_, bundle) {
        const assets = Object.keys(bundle)
          .filter((n) => /\.(js|css|woff2)$/.test(n))
          .map((n) => "/" + n);
        const source = fs
          .readFileSync("public/sw.js", "utf8")
          .replace(
            '"__BUILD_ASSETS__"',
            ["/", "/favicon.svg", "/map-tile-fallback.svg", ...assets]
              .map((a) => JSON.stringify(a))
              .join(","),
          )
          .replace(
            "BUILD_VERSION",
            createHash("sha256")
              .update(assets.join("|"))
              .digest("hex")
              .slice(0, 12),
          );
        fs.writeFileSync("dist/sw.js", source);
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ["recharts"],
          maps: ["leaflet", "react-leaflet"],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: [".e2b.app", "localhost"],
    proxy: { "/api": { target: "http://127.0.0.1:3001", changeOrigin: false } },
  },
});

import { execSync } from "node:child_process";

import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const buildId = (() => {
  const githubSha = process.env.GITHUB_SHA?.trim();

  if (githubSha) {
    return githubSha.slice(0, 7);
  }

  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"]
    })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
})();

const buildTime = new Date().toISOString();

export default defineConfig({
  build: {
    target: "esnext"
  },
  define: {
    __HYPECAST_BUILD_ID__: JSON.stringify(buildId),
    __HYPECAST_BUILD_TIME__: JSON.stringify(buildTime)
  },
  optimizeDeps: {
    exclude: ["@xmtp/wasm-bindings", "@xmtp/browser-sdk"],
    include: ["@xmtp/proto"]
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icons/icon.svg"],
      manifest: {
        name: "Hypecast",
        short_name: "Hypecast",
        description:
          "A PWA-first Farcaster client with wallet-native identity and XMTP messaging.",
        theme_color: "#0b0b0e",
        background_color: "#0b0b0e",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globIgnores: ["**/*.wasm"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith(".wasm"),
            handler: "CacheFirst",
            options: {
              cacheName: "xmtp-wasm",
              expiration: {
                maxEntries: 2,
                maxAgeSeconds: 60 * 60 * 24 * 30
              }
            }
          }
        ]
      }
    })
  ]
});

import path from "node:path";
import { fileURLToPath } from "node:url";

import build from "@hono/vite-build/cloudflare-pages";
import adapter from "@hono/vite-dev-server/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import honox from "honox/vite";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const alias = { "@": path.resolve(__dirname, "app") };

export default defineConfig(({ mode }) => {
  if (mode === "client") {
    return {
      resolve: { alias },
      plugins: [tailwindcss()],
      build: {
        rollupOptions: {
          input: {
            client: "./app/client.ts",
            "passkey-login": "./app/passkey-login.ts",
            "signup-invite": "./app/signup-invite.ts",
            styles: "./app/styles/app.css",
          },
          output: {
            entryFileNames: (chunk) => {
              if (chunk.name === "passkey-login") {
                return "static/passkey-login.js";
              }
              if (chunk.name === "signup-invite") {
                return "static/signup-invite.js";
              }
              if (chunk.name === "client") {
                return "static/client.js";
              }
              return "static/[name].js";
            },
            chunkFileNames: "static/assets/[name]-[hash].js",
            assetFileNames: "static/assets/[name].[ext]",
          },
        },
        emptyOutDir: false,
      },
    };
  }

  return {
    resolve: { alias },
    ssr: {
      external: ["react", "react-dom"],
    },
    plugins: [
      honox({
        devServer: {
          adapter,
        },
        client: {
          input: [
            "./app/client.ts",
            "./app/passkey-login.ts",
            "./app/signup-invite.ts",
            "./app/styles/app.css",
          ],
        },
      }),
      tailwindcss(),
      build({
        emptyOutDir: false,
      }),
    ],
  };
});

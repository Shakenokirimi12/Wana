import { defineConfig } from "vite";

/**
 * @sentry/core: DEBUG_BUILD is `true` when `__SENTRY_DEBUG__` is undefined.
 * In debug mode, makeDsn() rejects project IDs that are not numeric — which breaks Wana string project IDs.
 */
const sentryProdLikeDefine = {
  __SENTRY_DEBUG__: false,
} as const;

export default defineConfig({
  define: sentryProdLikeDefine,
  optimizeDeps: {
    esbuildOptions: {
      define: {
        __SENTRY_DEBUG__: "false",
      },
    },
  },
  server: {
    port: 8790,
    strictPort: true,
  },
});

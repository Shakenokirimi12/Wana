/**
 * SDK install + initialization snippets for the setup wizard.
 *
 * The DSN passed in is Wana-formatted but Sentry-compatible:
 *   https://<public-key>@<ingest-host>/<external-id>
 * <external-id> is the project's numeric DSN surrogate (projects.external_id),
 * not its human-readable project id — @sentry/core rejects non-numeric DSN
 * project ids in most consumer builds (see external_id's doc comment in
 * packages/schema/src/control-plane.ts).
 *
 * For each SDK we render an install command and an init code block with
 * the DSN inlined. We deliberately keep these snippets short — one
 * idiomatic example per SDK, not a full README.
 */

export type SdkKey =
  | "cloudflare"
  | "browser"
  | "node"
  | "react"
  | "python"
  | "curl";

export interface SdkSnippet {
  key: SdkKey;
  label: string;
  /** One-line description shown in the picker. */
  tagline: string;
  install: { lang: "shell"; code: string };
  init: { lang: string; code: string };
  /** Optional test-send snippet for verifying delivery. */
  test?: { lang: string; code: string };
  docsUrl: string;
}

export function buildSdkSnippets(
  dsn: string
): Record<SdkKey, SdkSnippet> {
  return {
    cloudflare: {
      key: "cloudflare",
      label: "Cloudflare Workers",
      tagline: "Workers / Pages Functions の error/log handler に紐付け",
      install: {
        lang: "shell",
        code: `npm install @sentry/cloudflare`,
      },
      init: {
        lang: "typescript",
        code:
          `import * as Sentry from "@sentry/cloudflare";\n` +
          `\n` +
          `export default Sentry.withSentry(\n` +
          `  (env) => ({\n` +
          `    dsn: "${dsn}",\n` +
          `    environment: env.ENVIRONMENT ?? "production",\n` +
          `    tracesSampleRate: 0,\n` +
          `  }),\n` +
          `  {\n` +
          `    async fetch(request, env, ctx) {\n` +
          `      return new Response("ok");\n` +
          `    },\n` +
          `  }\n` +
          `);\n`,
      },
      test: {
        lang: "typescript",
        code:
          `// Trigger a test error to verify delivery.\n` +
          `Sentry.captureException(new Error("Wana setup test"));\n`,
      },
      docsUrl: "https://docs.sentry.io/platforms/javascript/guides/cloudflare/",
    },

    browser: {
      key: "browser",
      label: "Browser (Vanilla JS)",
      tagline: "ブラウザの window.onerror + unhandledrejection を補足",
      install: {
        lang: "shell",
        code: `npm install @sentry/browser`,
      },
      init: {
        lang: "javascript",
        code:
          `import * as Sentry from "@sentry/browser";\n` +
          `\n` +
          `Sentry.init({\n` +
          `  dsn: "${dsn}",\n` +
          `  environment: "production",\n` +
          `  tracesSampleRate: 0,\n` +
          `});\n`,
      },
      test: {
        lang: "javascript",
        code: `Sentry.captureException(new Error("Wana setup test"));\n`,
      },
      docsUrl: "https://docs.sentry.io/platforms/javascript/",
    },

    node: {
      key: "node",
      label: "Node.js",
      tagline: "サーバサイド Node — uncaughtException 含む補足",
      install: {
        lang: "shell",
        code: `npm install @sentry/node`,
      },
      init: {
        lang: "javascript",
        code:
          `// Import as early as possible (before other modules that throw).\n` +
          `import * as Sentry from "@sentry/node";\n` +
          `\n` +
          `Sentry.init({\n` +
          `  dsn: "${dsn}",\n` +
          `  environment: process.env.NODE_ENV ?? "production",\n` +
          `  tracesSampleRate: 0,\n` +
          `});\n`,
      },
      test: {
        lang: "javascript",
        code: `Sentry.captureException(new Error("Wana setup test"));\n`,
      },
      docsUrl: "https://docs.sentry.io/platforms/javascript/guides/node/",
    },

    react: {
      key: "react",
      label: "React",
      tagline: "React アプリ — Error Boundary 付きで補足",
      install: {
        lang: "shell",
        code: `npm install @sentry/react`,
      },
      init: {
        lang: "tsx",
        code:
          `import * as Sentry from "@sentry/react";\n` +
          `\n` +
          `Sentry.init({\n` +
          `  dsn: "${dsn}",\n` +
          `  environment: "production",\n` +
          `  tracesSampleRate: 0,\n` +
          `});\n` +
          `\n` +
          `// Wrap your root with Sentry.ErrorBoundary to capture render errors.\n` +
          `export function App() {\n` +
          `  return (\n` +
          `    <Sentry.ErrorBoundary fallback={<p>Something broke.</p>}>\n` +
          `      <Root />\n` +
          `    </Sentry.ErrorBoundary>\n` +
          `  );\n` +
          `}\n`,
      },
      docsUrl: "https://docs.sentry.io/platforms/javascript/guides/react/",
    },

    python: {
      key: "python",
      label: "Python",
      tagline: "Django / Flask / FastAPI / 単体スクリプト",
      install: {
        lang: "shell",
        code: `pip install --upgrade sentry-sdk`,
      },
      init: {
        lang: "python",
        code:
          `import sentry_sdk\n` +
          `\n` +
          `sentry_sdk.init(\n` +
          `    dsn="${dsn}",\n` +
          `    environment="production",\n` +
          `    traces_sample_rate=0.0,\n` +
          `)\n`,
      },
      test: {
        lang: "python",
        code: `sentry_sdk.capture_exception(RuntimeError("Wana setup test"))\n`,
      },
      docsUrl: "https://docs.sentry.io/platforms/python/",
    },

    curl: {
      key: "curl",
      label: "curl / 手動 HTTP",
      tagline: "Sentry envelope 形式を直接 POST（任意言語の検証用）",
      install: {
        lang: "shell",
        code: `# 依存なし — bash + curl のみ`,
      },
      init: {
        // We render the curl example using the parsed DSN's public key + host.
        lang: "shell",
        code: buildCurlSnippet(dsn),
      },
      docsUrl: "https://develop.sentry.dev/sdk/data-model/envelopes/",
    },
  };
}

function buildCurlSnippet(dsn: string): string {
  let key = "<public-key>";
  let host = "ingest.wana.shakenokiri.me";
  let projectId = "<project-id>";
  try {
    const u = new URL(dsn);
    key = u.username || key;
    host = u.host || host;
    projectId = u.pathname.replace(/^\//, "") || projectId;
  } catch {
    // DSN unparseable — keep placeholders.
  }
  return (
    `# Build a minimal envelope (header + event item) and POST it.\n` +
    `EID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '-' || uuidgen | tr -d '-' | tr A-Z a-z)\n` +
    `printf '%s\\n%s\\n%s\\n' \\\n` +
    `  '{"event_id":"'$EID'","sent_at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' \\\n` +
    `  '{"type":"event"}' \\\n` +
    `  '{"event_id":"'$EID'","platform":"other","level":"error","message":{"formatted":"Wana setup test"}}' \\\n` +
    `| curl -X POST "https://${host}/api/${projectId}/envelope/" \\\n` +
    `  -H "Content-Type: application/x-sentry-envelope" \\\n` +
    `  -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_key=${key}" \\\n` +
    `  --data-binary @-\n`
  );
}

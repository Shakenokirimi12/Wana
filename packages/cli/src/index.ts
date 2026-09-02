#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { cac } from "cac";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve monorepo root (directory containing `pnpm-workspace.yaml`).
 * Falls back to `process.cwd()` when run from a global install.
 */
function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return process.cwd();
}

const REPO_ROOT = findRepoRoot();

const DEPLOY_ORDER = [
  { id: "worker", relPath: "apps/worker" },
  { id: "ingest", relPath: "apps/ingest" },
  { id: "dashboard", relPath: "apps/dashboard" },
  { id: "mcp", relPath: "apps/mcp" },
] as const;

// Resource names (kept in sync with the wrangler.jsonc files).
const RESOURCES = {
  d1Name: "wana-control-plane",
  r2Bucket: "wana-payloads",
  queue: "wana-error-queue",
  dlq: "wana-error-dlq",
  kvBinding: "SYSTEM_CONFIG",
  kvTitle: "wana-system-config",
};

const WORKER_DIR = join(REPO_ROOT, "apps/worker");
const INGEST_DIR = join(REPO_ROOT, "apps/ingest");
const DASHBOARD_DIR = join(REPO_ROOT, "apps/dashboard");
const MCP_DIR = join(REPO_ROOT, "apps/mcp");

function runPackageDeploy(absDir: string): void {
  const result = spawnSync("pnpm", ["run", "deploy"], {
    cwd: absDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function run(cmd: string, args: string[], cwd: string): { ok: boolean; out: string } {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0, out };
}

/** Run a wrangler subcommand from `apps/worker` (has wrangler installed). */
function wrangler(args: string[]): { ok: boolean; out: string } {
  return run("pnpm", ["exec", "wrangler", ...args], WORKER_DIR);
}

/**
 * Replace the value of a fully-quoted JSON key: `"key": "value"`.
 * The key MUST be quoted on both sides so `"id"` does not also match inside
 * `"database_id"` (which would corrupt the D1 binding with the KV id).
 */
function patchConfigValue(file: string, key: string, value: string): boolean {
  if (!existsSync(file)) return false;
  const src = readFileSync(file, "utf8");
  const re = new RegExp(`("${key}"\\s*:\\s*")([^"]*)(")`);
  if (!re.test(src)) return false;
  const next = src.replace(re, `$1${value}$3`);
  if (next === src) return false;
  writeFileSync(file, next);
  return true;
}

const cli = cac("wana");

cli
  .command("doctor", "Check toolchain (node, pnpm, wrangler)")
  .action(() => {
    const node = process.version;
    const pnpm = run("pnpm", ["--version"], REPO_ROOT);
    const wranglerV = wrangler(["--version"]);

    console.log(`Node.js:  ${node}`);
    console.log(`pnpm:     ${pnpm.ok ? pnpm.out : "not found (run corepack enable)"}`);
    console.log(`wrangler: ${wranglerV.ok ? wranglerV.out : "not found (pnpm install)"}`);

    if (!pnpm.ok || !wranglerV.ok) {
      process.exit(1);
    }
  });

cli
  .command(
    "provision",
    "Create Cloudflare resources (D1/R2/Queues/KV) and write their ids into wrangler.jsonc"
  )
  .option("--dry-run", "Print the plan without creating anything")
  .action((options: { dryRun?: boolean }) => {
    const plan = [
      `D1 database    ${RESOURCES.d1Name}`,
      `R2 bucket      ${RESOURCES.r2Bucket}`,
      `Queue          ${RESOURCES.queue}`,
      `Queue (DLQ)    ${RESOURCES.dlq}`,
      `KV namespace   ${RESOURCES.kvTitle} (binding ${RESOURCES.kvBinding})`,
    ];
    if (options.dryRun) {
      console.log("Would create on your Cloudflare account:");
      for (const p of plan) console.log(`  - ${p}`);
      console.log(
        "\nThen write database_id + KV id into apps/{ingest,dashboard,worker,mcp}/wrangler.jsonc"
      );
      console.log("and apply D1 migrations (--remote).");
      return;
    }

    console.log("Provisioning Cloudflare resources (idempotent-ish)…\n");

    // 1) R2 bucket + queues — no id to capture; ignore "already exists".
    const simpleResources: Array<{ label: string; name: string; args: string[] }> = [
      { label: "R2 bucket", name: RESOURCES.r2Bucket, args: ["r2", "bucket", "create", RESOURCES.r2Bucket] },
      { label: "Queue", name: RESOURCES.queue, args: ["queues", "create", RESOURCES.queue] },
      { label: "DLQ", name: RESOURCES.dlq, args: ["queues", "create", RESOURCES.dlq] },
    ];
    for (const { label, name, args } of simpleResources) {
      const r = wrangler(args);
      const exists = /already exists/i.test(r.out);
      console.log(
        `${r.ok || exists ? "✓" : "✗"} ${label}: ${name}${exists ? " (already exists)" : ""}`
      );
      if (!r.ok && !exists) {
        console.error(r.out);
        process.exit(1);
      }
    }

    // 2) D1 database — capture database_id.
    let d1Id = "";
    {
      const r = wrangler(["d1", "create", RESOURCES.d1Name]);
      const m = r.out.match(/database_id\s*[:=]\s*"?([0-9a-f-]{36})"?/i);
      if (m) {
        d1Id = m[1];
      } else if (/already exists/i.test(r.out)) {
        const info = wrangler(["d1", "info", RESOURCES.d1Name, "--json"]);
        d1Id = info.out.match(/"uuid"\s*:\s*"([0-9a-f-]{36})"/i)?.[1] ?? "";
      }
      if (!d1Id) {
        console.error("✗ Could not determine D1 database_id.\n" + r.out);
        process.exit(1);
      }
      console.log(`✓ D1: ${RESOURCES.d1Name} (${d1Id})`);
    }

    // 3) KV namespace — capture id.
    let kvId = "";
    {
      const r = wrangler(["kv", "namespace", "create", RESOURCES.kvBinding]);
      kvId = r.out.match(/"?id"?\s*[:=]\s*"([0-9a-f]{32})"/i)?.[1] ?? "";
      if (!kvId) {
        const list = wrangler(["kv", "namespace", "list"]);
        // Match the namespace whose title ends with the binding name.
        const entry = list.out.match(
          new RegExp(
            `"id"\\s*:\\s*"([0-9a-f]{32})"[^}]*"title"\\s*:\\s*"[^"]*${RESOURCES.kvBinding}"`,
            "i"
          )
        );
        kvId = entry?.[1] ?? "";
      }
      if (!kvId) {
        console.error("✗ Could not determine KV namespace id.\n" + r.out);
        process.exit(1);
      }
      console.log(`✓ KV: ${RESOURCES.kvTitle} (${kvId})`);
    }

    // 4) Write ids into the configs.
    const writes: Array<[string, string, string]> = [
      [join(INGEST_DIR, "wrangler.jsonc"), "database_id", d1Id],
      [join(DASHBOARD_DIR, "wrangler.jsonc"), "database_id", d1Id],
      [join(MCP_DIR, "wrangler.jsonc"), "database_id", d1Id],
      [join(INGEST_DIR, "wrangler.jsonc"), "id", kvId],
      [join(WORKER_DIR, "wrangler.jsonc"), "id", kvId],
      [join(DASHBOARD_DIR, "wrangler.jsonc"), "id", kvId],
    ];
    console.log("\nWriting ids into wrangler.jsonc:");
    for (const [file, key, value] of writes) {
      const done = patchConfigValue(file, key, value);
      console.log(`  ${done ? "✓" : "—"} ${file.replace(REPO_ROOT + "/", "")} (${key})`);
    }

    // 5) Apply D1 migrations to the remote database.
    console.log("\nApplying D1 migrations (--remote)…");
    const mig = run(
      "pnpm",
      ["exec", "wrangler", "d1", "migrations", "apply", RESOURCES.d1Name, "--remote"],
      INGEST_DIR
    );
    console.log(mig.out);
    if (!mig.ok) {
      console.error("✗ Migration apply failed (re-run after fixing).");
      process.exit(1);
    }

    console.log(
      "\n✅ Provisioned. Next: set secrets, then `wana deploy`.\n" +
        "   See README → Self-hosting for the secrets checklist."
    );
  });

cli
  .command("deploy", "Deploy Workers / Pages (worker → ingest → dashboard)")
  .option("--dry-run", "Show steps without running wrangler")
  .option("--skip-migrations", "Do not apply remote D1 migrations first")
  .action((options: { dryRun?: boolean; skipMigrations?: boolean }) => {
    if (options.dryRun) {
      console.log("Would apply remote D1 migrations, then `pnpm run deploy` in:");
      for (const a of DEPLOY_ORDER) {
        console.log(`  - ${a.relPath}`);
      }
      return;
    }

    console.log(`Repository root: ${REPO_ROOT}\n`);

    if (!options.skipMigrations) {
      console.log("── Apply D1 migrations (--remote) ──\n");
      const mig = run(
        "pnpm",
        ["exec", "wrangler", "d1", "migrations", "apply", RESOURCES.d1Name, "--remote"],
        INGEST_DIR
      );
      console.log(mig.out);
      if (!mig.ok) {
        console.error("Migration apply failed; aborting deploy.");
        process.exit(1);
      }
    }

    for (const app of DEPLOY_ORDER) {
      const cwd = join(REPO_ROOT, app.relPath);
      if (!existsSync(cwd)) {
        console.error(`Missing path: ${cwd}`);
        process.exit(1);
      }
      console.log(`\n── Deploy ${app.id} ──\n`);
      runPackageDeploy(cwd);
    }

    console.log("\nAll deployments finished.");
  });

// ── upload-dif ─────────────────────────────────────────────────────────────

/**
 * Parse a Sentry/Wana DSN of the form
 *   https://<publicKey>@<ingestHost>/<projectId>
 * Returns null for anything that doesn't match — callers fall through to a
 * clear error message instead of stumbling into a confusing 404.
 */
function parseDsn(
  raw: string | undefined
): { publicKey: string; host: string; projectId: string } | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const publicKey = u.username || "";
    const projectId = decodeURIComponent(u.pathname.replace(/^\/+|\/+$/g, ""));
    if (!publicKey || !projectId) return null;
    return { publicKey, host: u.host, projectId };
  } catch {
    return null;
  }
}

/**
 * Default the dashboard hostname from the DSN host by stripping a leading
 * `ingest.` (the convention this codebase uses:
 * `ingest.wana.example` → `wana.example`). The caller may override with
 * `--api-url`. Falls back to the ingest host if no `ingest.` prefix exists.
 */
function deriveDashboardOrigin(ingestHost: string): string {
  const host = ingestHost.replace(/^ingest\./i, "");
  return `https://${host}`;
}

/** Resolve `git rev-parse HEAD` + `git remote get-url origin` (best-effort). */
function readGitContext(cwd: string): { sha: string | null; repo: string | null } {
  const shaRes = run("git", ["rev-parse", "HEAD"], cwd);
  const remoteRes = run("git", ["remote", "get-url", "origin"], cwd);
  const sha = shaRes.ok && /^[0-9a-f]{7,64}$/i.test(shaRes.out) ? shaRes.out : null;
  let repo: string | null = null;
  if (remoteRes.ok) {
    // Accepted forms: `https://github.com/<owner>/<repo>(.git)?`
    //                 `git@github.com:<owner>/<repo>(.git)?`
    const m =
      remoteRes.out.match(/github\.com[:/]+([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/);
    if (m) repo = `${m[1]}/${m[2]}`;
  }
  return { sha, repo };
}

/**
 * Walk a directory looking for Mach-O binaries inside `.dSYM` bundles
 * AND `.debug.dylib` sidecars (Xcode 14+ Debug builds keep DWARF in the
 * `.debug.dylib` next to the main binary instead of a `.dSYM`). Returns
 * absolute paths to each binary we'd send to the server.
 */
function findCandidates(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > 8) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (name.endsWith(".dSYM")) {
          // Pull every Mach-O under Contents/Resources/DWARF (one per arch).
          const dwarfDir = join(full, "Contents/Resources/DWARF");
          if (existsSync(dwarfDir)) {
            for (const f of readdirSync(dwarfDir)) {
              out.push(join(dwarfDir, f));
            }
          }
          continue;
        }
        visit(full, depth + 1);
      } else if (st.isFile() && name.endsWith(".debug.dylib")) {
        out.push(full);
      }
    }
  };
  visit(root, 0);
  return out;
}

/**
 * Read Mach-O LC_UUID via `dwarfdump --uuid` (ships with Xcode CLT — this
 * CLI is mac-only because dSYMs are). One row per arch:
 *   `UUID: <hex>-<hex>-...-<hex> (<arch>) <path>`
 * Returns the first arch found; for fat dSYMs we only ship the first slice
 * — Wana's debug_files index is UUID-keyed and we de-dupe per UUID anyway.
 */
function machoUuid(path: string): { uuid: string; arch: string | null } | null {
  const r = run("dwarfdump", ["--uuid", path], process.cwd());
  if (!r.ok) return null;
  const m = r.out.match(
    /UUID:\s*([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})\s*\(([^)]+)\)/i
  );
  if (!m) return null;
  return { uuid: m[1].replace(/-/g, "").toLowerCase(), arch: m[2] || null };
}

async function uploadOne(
  apiUrl: string,
  projectId: string,
  publicKey: string,
  path: string,
  git: { sha: string | null; repo: string | null }
): Promise<{ ok: boolean; uuid?: string; replaced?: boolean; error?: string }> {
  const bytes = readFileSync(path);
  const form = new FormData();
  form.set(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }),
    basename(path)
  );
  if (git.sha) form.set("git_sha", git.sha);
  if (git.repo) form.set("git_repo", git.repo);
  const url = `${apiUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(projectId)}/debug-files`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "X-Sentry-Auth": `sentry_key=${publicKey}` },
      body: form,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const text = await res.text();
  let json: { ok?: boolean; uuid?: string; replaced?: boolean; error?: string } = {};
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON body (e.g. cookie-auth redirect) — surface raw text.
    return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
  if (!res.ok || !json.ok) {
    return { ok: false, error: json.error ?? `HTTP ${res.status}` };
  }
  return { ok: true, uuid: json.uuid, replaced: json.replaced };
}

cli
  .command(
    "upload-dif [path]",
    "Upload dSYM / .debug.dylib symbol files to Wana. Defaults to scanning the cwd."
  )
  .option("--dsn <url>", "Project DSN. Falls back to $WANA_DSN or $SENTRY_DSN.")
  .option(
    "--api-url <url>",
    "Override dashboard origin. Defaults to DSN host with `ingest.` stripped."
  )
  .option("--git-sha <sha>", "Git SHA. Defaults to `git rev-parse HEAD`.")
  .option(
    "--git-repo <owner/repo>",
    "GitHub `owner/repo`. Defaults to parsing `git remote get-url origin`."
  )
  .action(
    async (
      path: string | undefined,
      options: {
        dsn?: string;
        apiUrl?: string;
        gitSha?: string;
        gitRepo?: string;
      }
    ) => {
      const dsnRaw =
        options.dsn ?? process.env.WANA_DSN ?? process.env.SENTRY_DSN;
      const dsn = parseDsn(dsnRaw);
      if (!dsn) {
        console.error(
          "✗ Missing/invalid DSN. Pass --dsn <url>, or set $WANA_DSN.\n" +
            "  Expected: https://<publicKey>@<ingestHost>/<projectId>"
        );
        process.exit(1);
      }
      const apiUrl = options.apiUrl ?? deriveDashboardOrigin(dsn.host);
      const root = path ? path : process.env.DWARF_DSYM_FOLDER_PATH ?? process.cwd();

      // git context: CLI flags > git probe in `root` > git probe in cwd
      const probe = readGitContext(root);
      const probeCwd = readGitContext(process.cwd());
      const git = {
        sha: options.gitSha ?? probe.sha ?? probeCwd.sha,
        repo: options.gitRepo ?? probe.repo ?? probeCwd.repo,
      };

      console.log(`Scanning: ${root}`);
      const files = findCandidates(root);
      if (files.length === 0) {
        console.log("No .dSYM bundles or .debug.dylib sidecars found.");
        return;
      }
      // Dedupe by UUID — Xcode often emits identical thin Mach-O slices in
      // multiple build dirs; uploading the same UUID twice just churns R2.
      const byUuid = new Map<string, { path: string; arch: string | null }>();
      for (const f of files) {
        const info = machoUuid(f);
        if (!info) continue;
        if (!byUuid.has(info.uuid)) byUuid.set(info.uuid, { path: f, arch: info.arch });
      }
      console.log(
        `Found ${byUuid.size} unique image(s). git=${git.sha?.slice(0, 7) ?? "(none)"} repo=${git.repo ?? "(none)"}`
      );

      let okN = 0;
      let failN = 0;
      for (const [uuid, { path: p, arch }] of byUuid) {
        process.stdout.write(`  ${uuid.slice(0, 8)}… (${arch ?? "?"}) ${basename(p)} … `);
        const res = await uploadOne(apiUrl, dsn.projectId, dsn.publicKey, p, git);
        if (res.ok) {
          okN += 1;
          console.log(res.replaced ? "ok (replaced)" : "ok");
        } else {
          failN += 1;
          console.log(`fail: ${res.error}`);
        }
      }
      console.log(`\nDone. uploaded=${okN} failed=${failN}`);
      if (failN > 0) process.exit(1);
    }
  );

cli.help();
cli.version("0.1.0");

cli.parse(process.argv, { run: false });

if (cli.options.help) {
  cli.outputHelp();
  process.exit(0);
}
if (cli.options.version) {
  cli.outputVersion();
  process.exit(0);
}
if (!cli.matchedCommand) {
  cli.outputHelp();
  process.exit(1);
}

cli.runMatchedCommand();

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
        "\nThen write database_id + KV id into apps/{ingest,dashboard,worker}/wrangler.jsonc"
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

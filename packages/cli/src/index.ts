#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

const cli = cac("wana");

cli
  .command("doctor", "Check toolchain (node, pnpm, wrangler)")
  .action(() => {
    const node = process.version;
    const pnpm = run("pnpm", ["--version"], REPO_ROOT);
    const wrangler = run("pnpm", ["exec", "wrangler", "--version"], join(REPO_ROOT, "apps/worker"));

    console.log(`Node.js:  ${node}`);
    console.log(`pnpm:     ${pnpm.ok ? pnpm.out : "not found (run corepack enable)"}`);
    console.log(`wrangler: ${wrangler.ok ? wrangler.out : "not found (pnpm install)"}`);

    if (!pnpm.ok || !wrangler.ok) {
      process.exit(1);
    }
  });

cli
  .command("deploy", "Deploy Workers / Pages (worker → ingest → dashboard)")
  .option("--dry-run", "Show steps without running wrangler")
  .action((options: { dryRun?: boolean }) => {
    if (options.dryRun) {
      console.log("Would run `pnpm run deploy` in:");
      for (const a of DEPLOY_ORDER) {
        console.log(`  - ${a.relPath}`);
      }
      return;
    }

    console.log(`Repository root: ${REPO_ROOT}\n`);

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

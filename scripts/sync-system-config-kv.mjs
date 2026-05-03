#!/usr/bin/env node
/**
 * Copies SYSTEM_CONFIG KV `id` from apps/worker/wrangler.jsonc into ingest + dashboard.
 * Run after: wrangler kv namespace create ... --update-config (see root package.json).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function stripJsoncComments(text) {
	return text.replace(/^\s*\/\/.*$/gm, "");
}

function getSystemConfigKvId(text) {
	const json = JSON.parse(stripJsoncComments(text));
	const entry = json.kv_namespaces?.find((k) => k.binding === "SYSTEM_CONFIG");
	return entry?.id ?? null;
}

const workerPath = join(root, "apps/worker/wrangler.jsonc");
const workerText = readFileSync(workerPath, "utf8");
const id = getSystemConfigKvId(workerText);

if (!id || id === "placeholder-kv-id") {
	console.error(
		`apps/worker/wrangler.jsonc still has no real SYSTEM_CONFIG KV id (got: ${id ?? "missing"}).\n` +
			"Run: pnpm provision:system-config-kv\n" +
			"If the namespace already exists, set \"id\" in apps/worker/wrangler.jsonc from the Cloudflare dashboard or `wrangler kv namespace list`, then run:\n" +
			"  node scripts/sync-system-config-kv.mjs",
	);
	process.exit(1);
}

for (const rel of ["apps/ingest/wrangler.jsonc", "apps/dashboard/wrangler.jsonc"]) {
	const p = join(root, rel);
	const text = readFileSync(p, "utf8");
	const current = getSystemConfigKvId(text);
	if (current === id) {
		continue;
	}
	const replaced = text.replace(
		/("binding"\s*:\s*"SYSTEM_CONFIG"\s*,\s*\n\s*"id"\s*:\s*)"[^"]*"/,
		`$1"${id}"`,
	);
	if (replaced === text) {
		console.error(`Could not find SYSTEM_CONFIG id field to patch in ${rel}`);
		process.exit(1);
	}
	writeFileSync(p, replaced);
	console.log(`Updated ${rel} SYSTEM_CONFIG KV id.`);
}

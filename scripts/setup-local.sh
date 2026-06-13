#!/bin/bash
set -e

echo "🔧 Setting up local development environment..."

cd "$(dirname "$0")/.."

# `pnpm dev` は ingest / dashboard を別プロセスで起動し、それぞれが自分の
# .wrangler/state に別々のローカル D1 persist を持つ。両方に同じ control-plane
# スキーマ＋シードを適用しないと、dashboard 側が "no such table" になる。
# （共有 persist で本番に近い E2E をしたい場合は `pnpm preview` を使う）
echo "📦 Setting up local D1 (control plane) for each dev app..."
for app in ingest dashboard; do
  echo "  → apps/$app"
  (
    cd "apps/$app"
    # Apply Drizzle-generated migrations via wrangler's D1 migration system.
    npx wrangler d1 migrations apply wana-control-plane --local
    npx wrangler d1 execute wana-control-plane --local --file=../../packages/schema/seed.sql
  )
done

echo "✅ Local development environment ready!"
echo ""
echo "Test DSN Key: wana_test_key_abc123"
echo "Project ID: proj_01"
echo ""
echo "To start development:"
echo "  pnpm dev"

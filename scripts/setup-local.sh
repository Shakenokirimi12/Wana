#!/bin/bash
set -e

echo "🔧 Setting up local development environment..."

cd "$(dirname "$0")/.."

# Create local D1 database
echo "📦 Creating local D1 database..."
cd apps/ingest
npx wrangler d1 execute wana-control-plane --local --file=../../packages/schema/migrations/0001_initial.sql
npx wrangler d1 execute wana-control-plane --local --file=../../packages/schema/migrations/0002_auth_admin.sql
npx wrangler d1 execute wana-control-plane --local --file=../../packages/schema/seed.sql
cd ../..

echo "✅ Local development environment ready!"
echo ""
echo "Test DSN Key: wana_test_key_abc123"
echo "Project ID: proj_01"
echo ""
echo "To start development:"
echo "  pnpm dev"

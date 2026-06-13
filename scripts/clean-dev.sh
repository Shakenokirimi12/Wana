#!/usr/bin/env bash
# ローカル dev の後始末。`pnpm dev` がクリーンに終了しなかった場合に残る
# 孤児 workerd / wrangler / vite を停止し、クラッシュした SQLite WAL/SHM を削除する。
# これで次回の dev 起動時の "database is locked (SQLITE_BUSY)" を防ぐ。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🧹 Cleaning up local dev processes for this repo…"
pkill -f "$REPO.*turbo run dev" 2>/dev/null || true
pkill -f "$REPO.*wrangler.*dev" 2>/dev/null || true
pkill -f "$REPO.*vite" 2>/dev/null || true
# miniflare の workerd は親が死ぬと launchd に再ペアレントされ残ることがある
for pid in $(ps ax -o pid=,command= | grep -i workerd | grep -v grep | grep "$REPO" | awk '{print $1}'); do
  kill -9 "$pid" 2>/dev/null || true
done

sleep 1

echo "🧹 Removing stale SQLite WAL/SHM lock files…"
find "$REPO"/apps/*/.wrangler/state \
  \( -name "*.sqlite-wal" -o -name "*.sqlite-shm" \) -delete 2>/dev/null || true

echo "✅ Done. You can now run a dev command again."

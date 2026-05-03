# Wana - Cloudflare Native Error Tracker

Sentry互換のセルフホスト可能なエラートラッカー。Cloudflareのスタック（Workers, D1, Durable Objects, Queues, R2）をフル活用。

## アーキテクチャ

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Sentry SDK  │────▶│   Ingest    │────▶│    Queue    │
│  (Client)   │     │   Worker    │     │             │
└─────────────┘     └─────────────┘     └──────┬──────┘
                           │                    │
                           ▼                    ▼
                    ┌─────────────┐     ┌─────────────┐
                    │     D1      │     │   Worker    │
                    │ (Control)   │     │ (Consumer)  │
                    └─────────────┘     └──────┬──────┘
                                               │
                           ┌───────────────────┼───────────────────┐
                           ▼                   ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
                    │ Durable Obj │     │     R2      │     │  Dashboard  │
                    │  (SQLite)   │     │  (Payload)  │     │  (HonoX)    │
                    └─────────────┘     └─────────────┘     └─────────────┘
```

## プロジェクト構成

```
wana/
├── apps/
│   ├── dashboard/      # Hono + Vite + Tailwind (管理画面)
│   ├── ingest/         # Hono (Sentry 互換 API)
│   └── worker/         # DO + Queue Consumer
├── packages/
│   ├── cli/            # `pnpm wana` / `deploy:cloud`（wrangler ラッパー）
│   ├── schema/         # Drizzle ORM スキーマ
│   └── types/          # 共有型定義
└── plugins/            # Dynamic Worker テンプレート
```

## 開発

### 前提条件

- Node.js 22+
- pnpm 10+
- Cloudflare account (ローカル開発は不要)

### セットアップ

```bash
# 依存関係のインストール
pnpm install

# ローカルD1データベースのセットアップ
chmod +x scripts/setup-local.sh
./scripts/setup-local.sh

# 開発（ingest / worker / dashboard を同時起動）
pnpm dev
```

- **ingest**: `http://127.0.0.1:8787`（Sentry SDK / DSN のホスト）
- **worker**（Queue consumer + DO）: `http://127.0.0.1:8788`
- **dashboard**（Vite）: ターミナルに表示（通常 `http://localhost:5173`）

**近い本番に揃えたいとき（共有 persist + Pages + 自動スモーク）**は `pnpm preview` を使ってください（下記）。

ローカルでは Wrangler のキュー・R2・クロス Worker 連携は環境により異なります。`pnpm preview` は同一 `--persist-to` で ingest / worker / dashboard を揃えますが、ダッシュボードの DO クロス Worker は Miniflare の制限で失敗することがあります。

### フルプレビュー＋スモーク（`pnpm preview`）

1 本のコマンドで次まで行います:

1. `.wrangler/preview-stack`（または `WANNA_PERSIST_DIR`）へ **D1 スキーマ適用＋シード**
2. **ingest :8787 / worker :8788 / dashboard（Pages）:8789** を同じ persist で起動（DevTools 用 **`--inspector-port`** を **9231 / 9232 / 9233** に分離し、既定の `9230` 衝突を避ける）
3. `wait-on` で待ったあと **ingest・worker の `/health`、dashboard の `/`、Sentry envelope POST** を実行

```bash
pnpm preview
```

既に 3 つとも起動済みなら、テストだけ:

```bash
pnpm test:stack
```

URL を変える場合: `INGEST_URL` / `WORKER_URL` / `DASH_URL`、プロジェクトとキー: `SMOKE_PROJECT_ID` / `SMOKE_DSN_KEY`。

### テスト用DSN

```
DSN: http://wana_test_key_abc123@localhost:8787/proj_01
```

### Sentry SDKの設定例

```javascript
import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "http://wana_test_key_abc123@localhost:8787/proj_01",
});
```

### ダッシュボード

- `pnpm --filter @wana/dashboard dev` — ローカル開発（Vite）
- トップ `/` … D1 からプロジェクト一覧
- `/projects/new` … プロジェクト作成・DSN（公開鍵）発行（ガイド **4.2**。公開鍵はこの画面でのみ表示）
- `/p/:projectId` … 該当 DO から issues 一覧（`wana-worker` 上の `ProjectDataStore` を `script_name` バインドで参照）
- `/p/:projectId/issues/:issueId` … issue 詳細・R2 の最新ペイロード表示

`wrangler.jsonc` の `database_id` / KV / Queue は本番用に差し替えてください。DO クロス参照は **`wana-worker` を先にデプロイ**し、ダッシュボード側の `script_name` と一致させます。

### E2E（インジェスト確認・ガイド 3.3）

ingest を `:8787` で起動した状態で:

```bash
./scripts/send-sentry-envelope.sh proj_01 wana_test_key_abc123 http://127.0.0.1:8787
```

（ローカルで ingest・worker・Queue を繋いでも、環境によっては end-to-end が限定されます。）

## API

### POST /api/:projectId/envelope/

Sentry Envelope形式のエラーを受信

**Headers:**
- `X-Sentry-Auth`: `Sentry sentry_version=7, sentry_key=<DSN_KEY>`

**Body:** Sentry Envelope (改行区切りJSON)

## デプロイ

リポジトリルートで Cloudflare にログイン済みであること（`wrangler login`）、各 `wrangler.jsonc` の D1 / KV / Queue / R2 の ID を埋めたこと、**先に `wana-worker` をデプロイ**してからダッシュボードをデプロイしてください（DO の `script_name` と一致させます）。

```bash
# 変更内容を本番へ（各 app の package.json の deploy に従う）
pnpm run deploy:cloud

# ドライラン
pnpm wana deploy --dry-run

# 単体
pnpm --filter @wana/worker deploy
pnpm --filter @wana/ingest deploy
pnpm --filter @wana/dashboard deploy
```

公開 npm に `npx wana` として出す場合は `packages/cli` をビルドして publish します（現状はモノレポ workspace 経由で利用）。

## ライセンス

MIT

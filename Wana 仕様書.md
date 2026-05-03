# **Wana (罠) \- Cloudflare Native Error Tracker 詳細仕様書**

## **1\. プロジェクト概要**

「Wana（ワナ）」は、Cloudflareのスタック（Workers, D1, Durable Objects, Queues, R2）をフル活用して構築された、セルフホスト可能なモダン・エラートラッカーOSSです。  
Sentry互換のIngestionを持ちながら、重厚長大なインフラを必要とせず、npx wana deploy の1コマンドでユーザー自身のCloudflareアカウント上にセキュアかつ低コストなオブザーバビリティ基盤を構築します。

### **コンセプト**

* **Edge-Native:** 全てのコンポーネントがCloudflareネットワーク上で動作し、圧倒的な低レイテンシを実現。  
* **Zero-Friction:** Sentry SDKをそのまま流用可能（DXの維持）。クライアント側の設定変更を最小限に抑える。  
* **Tenant Isolation:** Durable Objects SQLiteによる物理的なテナントデータ分離。  
* **Extensible:** Dynamic Dispatchによる将来的なプラグイン（カスタムWorker）のサポート。

## **2\. システム・アーキテクチャ & データフロー**

システムは「Control Plane（全体管理）」と「Data Plane（高頻度ログ処理）」に分離され、単一障害点やロック競合を排除しています。

### **2.1. データインジェストシーケンス（エラー発生時）**

1. **Client (Sentry SDK)** \-\> POST /api/:project\_id/envelope/  
2. **Ingest Worker (Hono)**  
   * ヘッダーの X-Sentry-Auth から DSN（APIキー）を抽出。  
   * Web Crypto API で DSN を SHA-256 ハッシュ化し、D1（またはKVキャッシュ）と照合。  
   * 認証成功時、Envelope ペイロードと project\_id, do\_id を Queue に送信 (send())。  
   * クライアントへ即座に 200 OK を返却（非同期処理へのオフロード）。  
3. **Queue Consumer Worker**  
   * Queue からメッセージをバッチで受け取る。  
   * ペイロードサイズが大きい（スタックトレースや Breadcrumbs 含む）場合、生データを R2 に保存（put()）。  
   * do\_id を用いて該当プロジェクトの Durable Object インスタンスを取得（env.PROJECT\_DO.idFromString(do\_id)）。  
   * Workers RPC を経由して、DO にエラーのメタデータを一括挿入 (await do.insertEvents(events)).  
4. **Durable Object (DO SQLite)**  
   * 受信したエラー群の Fingerprint を計算・照合し、issues の発生回数をインクリメント（または新規作成）。  
   * events テーブルに発生履歴と R2 のオブジェクトキーを記録。

## **3\. データベーススキーマ設計 (Drizzle ORM 定義イメージ)**

### **3.1. Control Plane (Cloudflare D1)**

横断的な設定データ。更新頻度は低く、読み込みが多い。

* **users テーブル**  
  * id (text, pk): ユーザーID (UUID)  
  * email (text, unique): メールアドレス  
  * name (text): 表示名  
  * created\_at (integer): 作成日時(UNIX Timestamp)  
* **organizations テーブル**  
  * id (text, pk): 組織ID  
  * slug (text, unique): URL用スラグ  
  * name (text): 組織名  
* **projects テーブル**  
  * id (text, pk): プロジェクトID (Sentry SDK の DSN に含まれる ID)  
  * org\_id (text, fk): 所属組織ID  
  * name (text): プロジェクト名  
  * do\_id (text): **Durable Object のインスタンスID（重要）**。これを用いて RPC 呼び出しを行う。  
* **api\_keys テーブル (DSN管理)**  
  * id (text, pk)  
  * project\_id (text, fk)  
  * key\_hash (text): **DSNの SHA-256 ハッシュ値**  
  * hint (text): UI表示用のヒント (例: wana\_live\_...1a2b)  
  * is\_active (integer/boolean): 有効状態

### **3.2. Data Plane (Durable Objects SQLite)**

各プロジェクト専用のローカル DB。1プロジェクト \= 1 DOインスタンス。

* **issues テーブル** (エラーのグループ)  
  * id (text, pk)  
  * fingerprint (text, index): エラーの同一性を判定するハッシュ  
  * type (text): エラーの型 (例: TypeError, ReferenceError)  
  * value (text): エラーメッセージ概要  
  * status (text): unresolved, resolved, ignored  
  * events\_count (integer): 累計発生回数  
  * first\_seen (integer): 初回発生日時  
  * last\_seen (integer): 最終発生日時  
* **events テーブル** (個別の発生履歴)  
  * id (text, pk): イベントID (Sentry の event\_id に準拠)  
  * issue\_id (text, fk)  
  * timestamp (integer): 発生日時  
  * environment (text): production, development など  
  * release (text): アプリのバージョン  
  * r2\_payload\_key (text): **R2 に保存された完全な Envelope ペイロードのキーパス**

## **4\. API 仕様 (Sentry 互換 Ingestion)**

Sentry SDK から送信されるデータ形式 (Envelope) を受け入れるための仕様。

* **Endpoint:** POST /api/:project\_id/envelope/  
* **Headers:**  
  * X-Sentry-Auth: Sentry sentry\_version=7, sentry\_client=sentry.javascript.browser/7.x.x, sentry\_key=\<DSN\_KEY\>  
* **Body Format:** Sentry Envelope フォーマット (改行区切りの JSON)  
  {"event\_id":"12345...","sent\_at":"2023-10-01T12:00:00Z"}  
  {"type":"event","length":412}  
  {"exception":{"values":\[{"type":"Error","value":"Something broke"}\]},"breadcrumbs": \[...\]}

* **処理:**  
  1. ヘッダーの 1 行目 (Item Header) からイベントタイプ (event, transaction など) を特定。  
  2. 2 行目以降 (Item Payload) をパースしてエラー情報を抽出。

## **5\. インフラストラクチャ・リソース構成 (wrangler.toml イメージ)**

Wana は複数の Worker を協調して動作させる構成をとります（Turborepo の各 app に対応）。

### **ingest/wrangler.toml (受信用 Worker)**

name \= "wana-ingest"  
main \= "src/index.ts"  
compatibility\_date \= "2024-04-01"

\[\[kv\_namespaces\]\]  
binding \= "SYSTEM\_CONFIG"  
id \= "..." \# メンテナンスフラグ等の格納用

\[\[d1\_databases\]\]  
binding \= "DB\_CONTROL"  
database\_name \= "wana-control-plane"  
database\_id \= "..."

\[\[queues.producers\]\]  
binding \= "ERROR\_QUEUE"  
queue \= "wana-error-queue"

### **worker/wrangler.toml (処理用 Consumer & DO クラス)**

name \= "wana-worker"  
main \= "src/index.ts"  
compatibility\_date \= "2024-04-01"

\[\[queues.consumers\]\]  
queue \= "wana-error-queue"  
max\_batch\_size \= 100  
max\_batch\_timeout \= 5

\[\[r2\_buckets\]\]  
binding \= "PAYLOAD\_STORAGE"  
bucket\_name \= "wana-payloads"

\[\[durable\_objects.bindings\]\]  
name \= "PROJECT\_DO"  
class\_name \= "ProjectDataStore"

\[\[migrations\]\]  
tag \= "v1"  
new\_sqlite\_classes \= \["ProjectDataStore"\]

## **6\. セキュリティと運用設計**

### **6.1. メンテナンス（計画停止）モードの挙動**

* **手法:** SYSTEM\_CONFIG KV に MAINTENANCE\_MODE=true を設定。  
* **Ingest Worker:** エラーを受信し、Queues に流し続ける（データロスなし）。  
* **Consumer Worker:** KV のフラグを確認し、true の場合は message.retry() を呼び出して処理を遅延させる。デプロイ完了後にフラグを下ろすと一斉に処理が再開される。  
* **Dashboard (HonoX):** ユーザーへ「メンテナンス中（データは裏側で収集中）」の画面を表示。

### **6.2. データリテンション（ストレージ自動パージ）**

* DO の SQLite ストレージコストと R2 容量の肥大化を防ぐため、DO Alarms を活用。  
* DO 内部で定期的に Alarm を発火させ、events テーブル内の保持期限（例: 30日）を過ぎたレコードと、それに紐づく R2 オブジェクト (r2\_payload\_key) を DELETE する。

## **7\. UI / UX ガイドライン (Dashboard)**

Sentry の複雑さに対するアンチテーゼとして、ノイズレスで極限まで洗練されたデザインを提供します。

* **スタック:** HonoX \+ Vite (SPA/Islands) \+ Tailwind CSS  
* **カラーテーマ:** ダークモード優先。背景は \#09090b (Zinc-950)、アクセントに篝火をイメージしたオレンジ/アンバー系を採用。  
* **タイポグラフィ:**  
  * 欧文・数字: Montserrat または Inter  
  * 和文: Noto Sans JP  
* **スペーシング:** 厳格な **8pxベース** のグリッドシステム。情報のグルーピングを余白で表現する。

## **8\. ディレクトリ構造 (モノレポ構成)**

wana/  
├── apps/  
│   ├── dashboard/      \# HonoX (管理画面 UI / DO への RPC 呼び出し)  
│   ├── ingest/         \# Hono (Sentry 互換 API / DSN 認証 / Queue 投下)  
│   └── worker/         \# DO クラス実装 / Queues Consumer ロジック  
├── packages/  
│   ├── cli/            \# \`npx wana\` (Cloudflare への自動プロビジョニングツール)  
│   ├── schema/         \# D1 & DO SQLite のスキーマ定義 (Drizzle ORM)  
│   └── types/          \# アプリケーション全体で共有する TypeScript 型定義  
└── plugins/            \# 公式 Dynamic Worker テンプレート (AI 解説プラグイン等)  

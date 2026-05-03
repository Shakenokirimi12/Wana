# **Wana (罠) \- 実装ステップガイド**

このドキュメントは、Wana仕様書(wana-spec.md)に基づき、ゼロからシステムを構築するためのステップバイステップの実装手順書です。

## **フェーズ 1: 基盤構築とスキーマ定義 (Foundation)**

まずはモノレポの基盤を作り、アプリケーション全体で共有するデータ構造（スキーマと型）を定義します。

### **Step 1.1: モノレポのセットアップ**

1. **pnpm workspaces** または **Turborepo** を使用してモノレポを初期化します。  
2. 仕様書で定義されたディレクトリ構造（apps/, packages/, plugins/）を作成します。  
3. packages/types に、Sentry Envelopeフォーマットの型や、アプリ全体で使う共通の型定義（TS interface）を配置します。

### **Step 1.2: データベーススキーマの定義 (packages/schema)**

1. Drizzle ORM を導入します。  
2. **D1 (Control Plane) 用スキーマ:** users, organizations, projects, api\_keys のテーブル定義を作成します。  
3. **DO SQLite (Data Plane) 用スキーマ:** issues, events のテーブル定義を作成します。  
4. Drizzle Kit を使って初期のマイグレーションファイルを生成します。

### **Step 1.3: ローカルD1の初期化とシードデータ投入**

1. Wranglerを使用してローカル環境にD1データベースを作成します。  
2. 開発・テスト用に、ダミーのプロジェクトとハッシュ化されたDSN（APIキー）を投入するシードスクリプトを作成・実行します。

## **フェーズ 2: エラー受信層の構築 (Ingestion Pipeline)**

クライアント（Sentry SDK）からのエラーを受け取り、キューに流すまでの「入り口」を作ります。

### **Step 2.1: ingest Worker の作成**

1. apps/ingest ディレクトリに Hono アプリケーションをセットアップします。  
2. エンドポイント POST /api/:project\_id/envelope/ を作成します。  
3. リクエストボディの Sentry Envelope（改行区切りのJSON）をパースするユーティリティ関数を実装します。

### **Step 2.2: DSN 認証ロジックの実装**

1. X-Sentry-Auth ヘッダーから DSN を抽出します。  
2. **Web Crypto API** を用いて DSN を SHA-256 ハッシュ化する関数を実装します。  
3. ハッシュ値を D1 (または KV キャッシュ) と照合し、正当なリクエストか検証するミドルウェアを実装します。

### **Step 2.3: Queue への投下**

1. 認証に成功したペイロードを Cloudflare Queues に send() する処理を追加します。  
2. この時点で、Postmanや実際のSentry SDKからローカルの ingest Workerへエラーを送信し、Queueにメッセージが積まれること、そしてクライアントへ即座に 200 OK が返ることを確認します。

## **フェーズ 3: データ処理層の構築 (Data Plane & Workers)**

Queueからエラーを取り出し、恒久的なストレージ（DOとR2）に保存するバックエンドのコア部分を作ります。

### **Step 3.1: Durable Object クラスの定義 (apps/worker)**

1. apps/worker 内に Durable Object クラス（ProjectDataStore 等）を作成します。  
2. DO内部の SQLite API を呼び出すセットアップを行います（Drizzle ORMと結合）。  
3. エラーメタデータを issues と events テーブルに INSERT / UPDATE するメソッド（RPCで呼び出される関数）を実装します。

### **Step 3.2: Queue Consumer の実装**

1. apps/worker に Queues のコンシューマー（queue ハンドラ）を実装します。  
2. メッセージバッチを受け取り、ペイロードサイズを確認します。  
3. ペイロード全体（スタックトレース等）を R2 バケットに put() して保存し、そのキーパス（URL）を取得します。  
4. メッセージの do\_id を用いて対象プロジェクトの Durable Object を取得し、RPC 経由で Step 3.1 で作った保存メソッドにデータを渡します。

### **Step 3.3: インジェストの E2E テスト**

1. ローカル環境（Miniflare）で ingest と worker の両方を起動します。  
2. Sentry SDK からエラーを送信し、R2にJSONファイルが保存され、DO SQLite にレコードが作成されるか、通しで確認します。

## **フェーズ 4: 管理画面の構築 (Dashboard)**

保存されたエラーデータを視覚化するためのフロントエンドUIを構築します。

### **Step 4.1: HonoX プロジェクトのセットアップ (apps/dashboard)**

1. apps/dashboard に HonoX と Vite をセットアップします。  
2. Tailwind CSS を導入し、仕様書で定めたフォント（Montserrat, Noto Sans JP）と8pxベースのグリッドシステムを設定します。

### **Step 4.2: Control Plane (D1) との連携**

1. ダッシュボードのトップ画面で、D1からユーザーが所属するプロジェクト一覧を取得して表示する機能を実装します。  
2. 新規プロジェクトの作成機能と、DSN（APIキー）の発行・ハッシュ化保存機能を実装します。

### **Step 4.3: Data Plane (DO) との RPC 連携**

1. プロジェクト詳細画面（エラー一覧画面）のルーティングを作成します。  
2. **Workers RPC** を使用して、ダッシュボード側の Worker から 対象の Durable Object のメソッド（例: getRecentIssues()）を直接呼び出します。  
3. 取得したデータを一覧表示します。

### **Step 4.4: エラー詳細画面と R2 ペイロードの取得**

1. 特定のエラー（Issue）の詳細画面を作成します。  
2. DO SQLite に保存された r2\_payload\_key を元に、R2 バケットから生のエラー JSON（スタックトレースや Breadcrumbs）を取得し、画面に整形して表示します。

## **フェーズ 5: 運用機能とCLIの構築 (Ops & CLI)**

本番運用に耐えうる機能と、OSSとしての目玉であるワンコマンド・デプロイを実現します。

### **Step 5.1: メンテナンスモード（計画停止）の実装**

1. SYSTEM\_CONFIG KV バインディングを各 Worker に追加します。  
2. worker (Consumer) に、KV の MAINTENANCE\_MODE フラグを確認し、true なら message.retry() で処理を保留するロジックを実装します。  
3. ダッシュボードにメンテナンス中画面を追加します。

### **Step 5.2: データリテンション（自動パージ）の実装**

1. Durable Object クラス内に alarm() ハンドラを実装します。  
2. 一定期間（例: 30日）を過ぎた events レコードと、該当する R2 オブジェクトを削除するロジックを記述します。  
3. 新しいエラーを保存した際などに storage.setAlarm() を呼び出して、定期実行をスケジューリングします。

### **Step 5.3: デプロイ用 CLI の作成 (packages/cli)**

1. cac や commander を使用して Node.js CLI ツールを作成します。  
2. npx wana deploy コマンドを実装します。  
   * ユーザーの Cloudflare API トークンを受け取る処理。  
   * 裏側で wrangler d1 create, wrangler r2 bucket create 等のコマンドを実行し、リソースを自動プロビジョニングする処理。  
   * wrangler.toml にバインディングIDを動的に書き込み、全 Worker をデプロイする一連のスクリプトを完成させます。
import { createApp } from "honox/server";

const app = createApp();

const NOT_FOUND_HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>ページが見つかりません — Wana</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root { color-scheme: light dark; --bg: light-dark(#fafafa, #0a0a0a); --fg: light-dark(#0a0a0a, #fafafa); --sub: light-dark(#71717a, #a1a1aa); --hairline: light-dark(rgba(0,0,0,0.08), rgba(255,255,255,0.08)); --brand: #f59e0b; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { min-height: 100vh; background: var(--bg); color: var(--fg); font-family: 'Inter','Noto Sans JP',ui-sans-serif,system-ui,-apple-system,sans-serif; display: flex; align-items: center; justify-content: center; padding: 2rem; }
    .card { text-align: center; max-width: 28rem; }
    .badge { display: inline-flex; align-items: center; justify-content: center; height: 2.25rem; width: 2.25rem; border-radius: 0.75rem; background: linear-gradient(135deg, #fbbf24, #f97316); color: #0a0a0a; font-weight: 700; font-size: 0.875rem; box-shadow: 0 6px 18px rgba(245, 158, 11, 0.18); margin-bottom: 1.25rem; }
    h1 { font-size: 2.5rem; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 0.5rem; }
    p { color: var(--sub); margin: 0.25rem 0; font-size: 0.95rem; line-height: 1.6; }
    a { display: inline-block; margin-top: 1.5rem; color: var(--brand); font-weight: 600; text-decoration: none; font-size: 0.9rem; padding: 0.5rem 1rem; border-radius: 0.5rem; border: 1px solid var(--hairline); }
    a:hover { background: var(--hairline); }
  </style>
</head>
<body>
  <main class="card">
    <div class="badge">W</div>
    <h1>404</h1>
    <p>お探しのページは見つかりませんでした。</p>
    <p>URL を確認するか、トップに戻ってください。</p>
    <a href="/">← トップへ戻る</a>
  </main>
</body>
</html>`;

app.notFound((c) => c.html(NOT_FOUND_HTML, 404));

export default app;

import { jsxRenderer } from "hono/jsx-renderer";

export const renderer = jsxRenderer((props, c) => {
  const { children } = props;
  const maintenance = c.get("maintenance");

  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#09090b" />
        <meta name="color-scheme" content="dark" />
        <title>Wana</title>
        <link
          rel="stylesheet"
          href={
            import.meta.env.DEV
              ? "/src/styles/app.css"
              : "/static/style.css"
          }
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossorigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body class="min-h-screen font-sans text-zinc-100">
        {maintenance ? (
          <div class="flex items-center justify-center gap-2 border-b border-amber-500/20 bg-gradient-to-r from-amber-950/95 via-amber-900/90 to-amber-950/95 px-4 py-3 text-center text-sm text-amber-100">
            <span class="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400" />
            メンテナンス中 — インジェストはキューに取り込み続けています。処理は再開後に反映されます。
          </div>
        ) : null}
        {children}
      </body>
    </html>
  );
});

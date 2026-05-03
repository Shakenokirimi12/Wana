import { reactRenderer } from "@hono/react-renderer";

export default reactRenderer(({ children, title, c }) => {
  const maintenance = c.get("maintenance") === true;

  return (
    <html lang="ja">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#09090b" />
        <meta name="color-scheme" content="dark" />
        {title ? <title>{title}</title> : <title>Wana</title>}
        {import.meta.env.PROD ? (
          <>
            <script type="module" src="/static/client.js" />
            <link href="/static/assets/styles.css" rel="stylesheet" />
          </>
        ) : (
          <>
            <script type="module" src="/app/client.ts" />
            <link href="/app/styles/app.css" rel="stylesheet" />
          </>
        )}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen font-sans text-zinc-100">
        {maintenance ? (
          <div className="flex items-center justify-center gap-2 border-b border-amber-500/20 bg-gradient-to-r from-amber-950/95 via-amber-900/90 to-amber-950/95 px-4 py-3 text-center text-sm text-amber-100">
            <span
              className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400"
              aria-hidden
            />
            メンテナンス中 — インジェストはキューに取り込み続けています。処理は再開後に反映されます。
          </div>
        ) : null}
        {children}
      </body>
    </html>
  );
});

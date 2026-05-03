import type { Child } from "hono/jsx";

type ShellProps = {
  title: string;
  children: Child;
  /** Shown in footer when set (e.g. Sentry playground dev URL). */
  playgroundUrl?: string;
};

/**
 * App chrome: #09090b, amber accent, sticky blurred header (Wana spec).
 */
export function Shell(props: ShellProps) {
  return (
    <div class="min-h-screen bg-[#09090b] text-zinc-100 antialiased">
      <header class="sticky top-0 z-50 border-b border-zinc-800/80 bg-[#09090b]/75 backdrop-blur-xl backdrop-saturate-150">
        <div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          <div class="flex min-w-0 flex-1 items-center gap-8">
            <a class="group flex shrink-0 items-center gap-3" href="/">
              <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-orange-600 text-sm font-bold text-zinc-950 shadow-lg shadow-amber-500/15 transition group-hover:shadow-amber-500/25">
                W
              </span>
              <span class="hidden font-semibold tracking-tight text-zinc-100 sm:inline sm:text-[15px]">
                Wana
              </span>
            </a>
            <nav class="hidden items-center gap-1 md:flex">
              <a
                class="rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100"
                href="/"
              >
                Projects
              </a>
              <a
                class="rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100"
                href="/projects/new"
              >
                New project
              </a>
            </nav>
          </div>
          <div class="flex min-w-0 shrink-0 items-center justify-end">
            <span
              class="max-w-[12rem] truncate text-right text-xs font-medium uppercase tracking-wider text-zinc-500 md:max-w-[16rem]"
              title={props.title}
            >
              {props.title}
            </span>
          </div>
        </div>
        <nav class="flex gap-2 border-t border-zinc-800/50 px-6 py-2 md:hidden">
          <a
            class="flex-1 rounded-lg bg-zinc-800/40 py-2 text-center text-sm font-medium text-zinc-300"
            href="/"
          >
            Projects
          </a>
          <a
            class="flex-1 rounded-lg bg-amber-500/15 py-2 text-center text-sm font-semibold text-amber-400"
            href="/projects/new"
          >
            New
          </a>
        </nav>
      </header>
      <main class="mx-auto max-w-6xl px-6 py-10 sm:py-12">{props.children}</main>
      <footer class="mx-auto mt-16 max-w-6xl border-t border-zinc-800/60 px-6 py-8">
        <p class="text-center text-xs text-zinc-600">
          Wana — edge-native error tracking
        </p>
        {props.playgroundUrl ? (
          <p class="mt-3 text-center">
            <a
              class="text-xs font-medium text-amber-500/90 hover:text-amber-400"
              href={props.playgroundUrl}
              target="_blank"
              rel="noreferrer"
            >
              Sentry ブラウザテスト (別タブ)
            </a>
          </p>
        ) : null}
      </footer>
    </div>
  );
}

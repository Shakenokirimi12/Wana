import type { ReactNode } from "react";

export type ShellAuth = "signed-in" | "signed-out" | "hidden";

type ShellProps = {
  title: string;
  children: ReactNode;
  /** Shown in footer when set (e.g. Sentry playground dev URL). */
  playgroundUrl?: string;
  /** Active team label (Slack-style). */
  activeTeamName?: string;
  /** Optional links to switch team (GET /team/switch?id=&next=). */
  teamSwitcher?: { id: string; name: string; slug: string }[];
  /**
   * Header / mobile: Sign in vs Sign out.
   * - `signed-in` → /logout
   * - `signed-out` → /login（`loginNext` があれば `?next=`）
   * - `hidden` → どちらも出さない（/login 本体など）
   */
  auth?: ShellAuth;
  /** Used when `auth="signed-out"`（招待 URL からログインに戻るなど） */
  loginNext?: string;
};

function loginHref(next?: string): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return `/login?next=${encodeURIComponent(next)}`;
  }
  return "/login";
}

/**
 * App chrome: #09090b, amber accent, sticky blurred header (Wana spec).
 */
export function Shell(props: ShellProps) {
  const auth = props.auth ?? "hidden";
  const signInHref = loginHref(props.loginNext);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 antialiased">
      <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-[#09090b]/75 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 flex-1 items-center gap-8">
            <a className="group flex shrink-0 items-center gap-3" href="/">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-orange-600 text-sm font-bold text-zinc-950 shadow-lg shadow-amber-500/15 transition group-hover:shadow-amber-500/25">
                W
              </span>
              <span className="hidden font-semibold tracking-tight text-zinc-100 sm:inline sm:text-[15px]">
                Wana
              </span>
            </a>
            <nav className="hidden items-center gap-1 md:flex">
              <a
                className="rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100"
                href="/"
              >
                Projects
              </a>
              <a
                className="rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100"
                href="/projects/new"
              >
                New project
              </a>
              <a
                className="rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100"
                href="/internal/ia"
              >
                IA
              </a>
            </nav>
          </div>
          <div className="flex min-w-0 shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-4">
            {props.teamSwitcher && props.teamSwitcher.length > 1 ? (
              <div className="flex max-w-full flex-wrap justify-end gap-1 text-[11px] text-zinc-500">
                <span className="shrink-0">Team:</span>
                {props.teamSwitcher.map((t) => (
                  <a
                    key={t.id}
                    className="rounded px-1.5 py-0.5 font-medium text-amber-500/90 hover:bg-zinc-800/60 hover:text-amber-400"
                    href={`/team/switch?id=${encodeURIComponent(t.id)}&next=${encodeURIComponent("/")}`}
                    title={t.slug}
                  >
                    {t.name}
                  </a>
                ))}
              </div>
            ) : props.activeTeamName ? (
              <span className="max-w-[10rem] truncate text-right text-[11px] text-zinc-500 sm:max-w-[14rem]">
                {props.activeTeamName}
              </span>
            ) : null}
            <span
              className="max-w-[12rem] truncate text-right text-xs font-medium uppercase tracking-wider text-zinc-500 md:max-w-[16rem]"
              title={props.title}
            >
              {props.title}
            </span>
            {auth === "signed-in" ? (
              <a
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
                href="/logout"
              >
                Sign out
              </a>
            ) : auth === "signed-out" ? (
              <a
                className="shrink-0 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-500/25"
                href={signInHref}
              >
                Sign in
              </a>
            ) : null}
          </div>
        </div>
        <nav className="flex flex-wrap gap-2 border-t border-zinc-800/50 px-6 py-2 md:hidden">
          <a
            className="min-w-[28%] flex-1 rounded-lg bg-zinc-800/40 py-2 text-center text-sm font-medium text-zinc-300"
            href="/"
          >
            Projects
          </a>
          <a
            className="min-w-[28%] flex-1 rounded-lg bg-amber-500/15 py-2 text-center text-sm font-semibold text-amber-400"
            href="/projects/new"
          >
            New
          </a>
          <a
            className="min-w-[28%] flex-1 rounded-lg bg-zinc-800/40 py-2 text-center text-sm font-medium text-zinc-300"
            href="/internal/ia"
          >
            IA
          </a>
          {auth === "signed-in" ? (
            <a
              className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-center text-xs font-medium text-zinc-400"
              href="/logout"
            >
              Out
            </a>
          ) : auth === "signed-out" ? (
            <a
              className="shrink-0 rounded-lg bg-amber-500/20 px-3 py-2 text-center text-xs font-semibold text-amber-400"
              href={signInHref}
            >
              In
            </a>
          ) : null}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10 sm:py-12">{props.children}</main>
      <footer className="mx-auto mt-16 max-w-6xl border-t border-zinc-800/60 px-6 py-8">
        <p className="text-center text-xs text-zinc-600">
          Wana — edge-native error tracking
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs">
          {auth === "signed-in" ? (
            <a
              className="font-medium text-zinc-500 hover:text-zinc-300"
              href="/logout"
            >
              Sign out
            </a>
          ) : auth === "signed-out" ? (
            <a
              className="font-medium text-amber-500/90 hover:text-amber-400"
              href={signInHref}
            >
              Sign in
            </a>
          ) : null}
          {props.playgroundUrl ? (
            <a
              className="font-medium text-zinc-500 hover:text-zinc-400"
              href={props.playgroundUrl}
              target="_blank"
              rel="noreferrer"
            >
              Sentry ブラウザテスト (別タブ)
            </a>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

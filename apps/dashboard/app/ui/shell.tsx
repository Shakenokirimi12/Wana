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

const navLink =
  "rounded-lg px-3 py-2 text-sm text-kumo-subtle transition-colors hover:bg-kumo-base hover:text-kumo-default";

/**
 * App chrome。色は kumo セマンティックトークンに統一（Base UI + Tailwind v4）。
 * ブランドマーク（W）の amber グラデーションのみ Wana 固有の識別子として維持。
 */
export function Shell(props: ShellProps) {
  const auth = props.auth ?? "hidden";
  const signInHref = loginHref(props.loginNext);

  return (
    <div className="min-h-screen bg-kumo-canvas text-kumo-default antialiased">
      <header className="sticky top-0 z-50 border-b border-kumo-hairline bg-kumo-canvas/75 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 flex-1 items-center gap-8">
            <a className="group flex shrink-0 items-center gap-3" href="/">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-orange-600 text-sm font-bold text-zinc-950 shadow-lg shadow-amber-500/15 transition group-hover:shadow-amber-500/25">
                W
              </span>
              <span className="hidden font-semibold tracking-tight text-kumo-default sm:inline sm:text-[15px]">
                Wana
              </span>
            </a>
            <nav className="hidden items-center gap-1 md:flex">
              <a className={navLink} href="/">
                Projects
              </a>
              <a className={navLink} href="/projects/new">
                New project
              </a>
              {auth === "signed-in" ? (
                <a className={navLink} href="/onboarding/create-team">
                  Create team
                </a>
              ) : null}
            </nav>
          </div>
          <div className="flex min-w-0 shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-4">
            {props.teamSwitcher && props.teamSwitcher.length > 1 ? (
              <div className="flex max-w-full flex-wrap justify-end gap-1 text-[11px] text-kumo-subtle">
                <span className="shrink-0">Team:</span>
                {props.teamSwitcher.map((t) => (
                  <a
                    key={t.id}
                    className="rounded px-1.5 py-0.5 font-medium text-kumo-brand hover:bg-kumo-base"
                    href={`/team/switch?id=${encodeURIComponent(t.id)}&next=${encodeURIComponent("/")}`}
                    title={t.slug}
                  >
                    {t.name}
                  </a>
                ))}
              </div>
            ) : props.activeTeamName ? (
              <span className="max-w-[10rem] truncate text-right text-[11px] text-kumo-subtle sm:max-w-[14rem]">
                {props.activeTeamName}
              </span>
            ) : null}
            <span
              className="max-w-[12rem] truncate text-right text-xs font-medium uppercase tracking-wider text-kumo-subtle md:max-w-[16rem]"
              title={props.title}
            >
              {props.title}
            </span>
            {auth === "signed-in" ? (
              <a
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-kumo-subtle hover:bg-kumo-base hover:text-kumo-default"
                href="/settings/account"
              >
                Account
              </a>
            ) : null}
            {auth === "signed-in" ? (
              <a
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-kumo-subtle hover:bg-kumo-base hover:text-kumo-default"
                href="/logout"
              >
                Sign out
              </a>
            ) : auth === "signed-out" ? (
              <a
                className="shrink-0 rounded-lg bg-kumo-brand/15 px-3 py-1.5 text-xs font-semibold text-kumo-brand hover:bg-kumo-brand/25"
                href={signInHref}
              >
                Sign in
              </a>
            ) : null}
          </div>
        </div>
        <nav className="flex flex-wrap gap-2 border-t border-kumo-hairline px-6 py-2 md:hidden">
          <a
            className="min-w-[28%] flex-1 rounded-lg bg-kumo-base py-2 text-center text-sm font-medium text-kumo-default"
            href="/"
          >
            Projects
          </a>
          <a
            className="min-w-[28%] flex-1 rounded-lg bg-kumo-brand/15 py-2 text-center text-sm font-semibold text-kumo-brand"
            href="/projects/new"
          >
            New
          </a>
          {auth === "signed-in" ? (
            <a
              className="min-w-[28%] flex-1 rounded-lg bg-kumo-base py-2 text-center text-sm font-medium text-kumo-default"
              href="/onboarding/create-team"
            >
              Team
            </a>
          ) : null}
          {auth === "signed-in" ? (
            <a
              className="shrink-0 rounded-lg border border-kumo-hairline px-3 py-2 text-center text-xs font-medium text-kumo-subtle"
              href="/logout"
            >
              Out
            </a>
          ) : auth === "signed-out" ? (
            <a
              className="shrink-0 rounded-lg bg-kumo-brand/20 px-3 py-2 text-center text-xs font-semibold text-kumo-brand"
              href={signInHref}
            >
              In
            </a>
          ) : null}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10 sm:py-12">{props.children}</main>
      <footer className="mx-auto mt-16 max-w-6xl border-t border-kumo-hairline px-6 py-8">
        <p className="text-center text-xs text-kumo-subtle">
          Wana — edge-native error tracking
        </p>
        {props.playgroundUrl ? (
          <div className="mt-4 flex justify-center text-xs">
            <a
              className="font-medium text-kumo-subtle hover:text-kumo-default"
              href={props.playgroundUrl}
              target="_blank"
              rel="noreferrer"
            >
              Sentry SDK テストページ (別タブ)
            </a>
          </div>
        ) : null}
      </footer>
    </div>
  );
}

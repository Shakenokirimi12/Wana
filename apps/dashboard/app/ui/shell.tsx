import type { ReactNode } from "react";

export type ShellAuth = "signed-in" | "signed-out" | "hidden";

type ShellProps = {
  title: string;
  children: ReactNode;
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
        {/* TOP ROW — brand + desktop nav + (md+) right-side meta+actions */}
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:h-16 sm:gap-4 sm:px-6">
          <a className="group flex shrink-0 items-center gap-2 sm:gap-3" href="/">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-orange-600 text-sm font-bold text-zinc-950 shadow-lg shadow-amber-500/15 transition group-hover:shadow-amber-500/25">
              W
            </span>
            <span className="hidden font-semibold tracking-tight text-kumo-default sm:inline sm:text-[15px]">
              Wana
            </span>
          </a>
          <nav className="hidden flex-1 items-center gap-1 md:flex">
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
          {/* Page title — shown inline on small screens too so users always
              know where they are. Truncated to keep the row a single line. */}
          <span
            className="min-w-0 flex-1 truncate text-right text-[11px] font-medium uppercase tracking-wider text-kumo-subtle md:flex-none md:text-xs"
            title={props.title}
          >
            {props.title}
          </span>
          {/* Right-side actions — Account / Sign out / Sign in. Only icon-ish
              on phones; full labels on md+. */}
          <div className="hidden shrink-0 items-center gap-1 md:flex md:gap-3">
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

        {/* TEAM CONTEXT ROW — only when there's a switcher or an active team. */}
        {(props.teamSwitcher && props.teamSwitcher.length > 1) ||
        props.activeTeamName ? (
          <div className="mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto whitespace-nowrap px-4 pb-2 text-[11px] text-kumo-subtle sm:px-6 md:pb-1.5">
            <span className="shrink-0">Team:</span>
            {props.teamSwitcher && props.teamSwitcher.length > 1
              ? props.teamSwitcher.map((t) => (
                  <a
                    key={t.id}
                    className="shrink-0 rounded px-1.5 py-0.5 font-medium text-kumo-brand hover:bg-kumo-base"
                    href={`/team/switch?id=${encodeURIComponent(t.id)}&next=${encodeURIComponent("/")}`}
                    title={t.slug}
                  >
                    {t.name}
                  </a>
                ))
              : (
                <span className="shrink-0 text-kumo-default">
                  {props.activeTeamName}
                </span>
              )}
          </div>
        ) : null}

        {/* MOBILE NAV ROW — primary nav + auth action. Always horizontal,
            scrollable rather than wrapping, so the header height stays
            predictable on tiny screens. */}
        <nav className="flex items-center gap-2 overflow-x-auto border-t border-kumo-hairline px-4 py-2 sm:px-6 md:hidden">
          <a
            className="shrink-0 rounded-lg bg-kumo-base px-3 py-1.5 text-xs font-medium text-kumo-default"
            href="/"
          >
            Projects
          </a>
          <a
            className="shrink-0 rounded-lg bg-kumo-brand/15 px-3 py-1.5 text-xs font-semibold text-kumo-brand"
            href="/projects/new"
          >
            New
          </a>
          {auth === "signed-in" ? (
            <a
              className="shrink-0 rounded-lg bg-kumo-base px-3 py-1.5 text-xs font-medium text-kumo-default"
              href="/onboarding/create-team"
            >
              Team
            </a>
          ) : null}
          {auth === "signed-in" ? (
            <a
              className="shrink-0 rounded-lg bg-kumo-base px-3 py-1.5 text-xs font-medium text-kumo-default"
              href="/settings/account"
            >
              Account
            </a>
          ) : null}
          <span className="flex-1" />
          {auth === "signed-in" ? (
            <a
              className="shrink-0 rounded-lg border border-kumo-hairline px-3 py-1.5 text-xs font-medium text-kumo-subtle"
              href="/logout"
            >
              Sign out
            </a>
          ) : auth === "signed-out" ? (
            <a
              className="shrink-0 rounded-lg bg-kumo-brand/20 px-3 py-1.5 text-xs font-semibold text-kumo-brand"
              href={signInHref}
            >
              Sign in
            </a>
          ) : null}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10 md:py-12">
        {props.children}
      </main>
      <footer className="mx-auto mt-12 max-w-6xl border-t border-kumo-hairline px-4 py-6 sm:mt-16 sm:px-6 sm:py-8">
        <p className="text-center text-xs text-kumo-subtle">Wana</p>
      </footer>
    </div>
  );
}

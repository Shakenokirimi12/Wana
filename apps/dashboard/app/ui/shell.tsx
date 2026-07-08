import type { ReactNode } from "react";

import { WanaMark } from "./icons";

export type ShellAuth = "signed-in" | "signed-out" | "hidden";

export type ShellProject = { id: string; name: string };

type ShellProps = {
  title: string;
  children: ReactNode;
  /** Active team label (shown as a chip; opens a switcher when there are 2+). */
  activeTeamName?: string;
  /** Active team slug — used to link the Team chip to /settings/team/[slug]. */
  activeTeamSlug?: string;
  /** Member orgs available to switch to. */
  teamSwitcher?: { id: string; name: string; slug: string }[];
  /** Header right-side state. `hidden` is for /login etc. */
  auth?: ShellAuth;
  /** Used when `auth="signed-out"` (e.g. invite URL → /login?next=…). */
  loginNext?: string;
  /** Current request path — drives nav active-state. Pass `c.req.path`. */
  currentPath?: string;
  /** Projects in the active team (top of sidebar). */
  projects?: ShellProject[];
  /** If the user is inside a project route, pass it so sub-nav appears. */
  currentProject?: ShellProject;
};

function loginHref(next?: string): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return `/login?next=${encodeURIComponent(next)}`;
  }
  return "/login";
}

function isPathActive(href: string, current: string | undefined): boolean {
  if (!current) return false;
  if (href === "/") return current === "/";
  return current === href || current.startsWith(href + "/");
}

interface NavEntry {
  href: string;
  label: string;
  /** When set, also active on descendants of this prefix. */
  matchPrefix?: string;
}

/** Item-link in the sidebar. */
function SideLink({
  href,
  label,
  active,
  variant = "default",
}: {
  href: string;
  label: string;
  active: boolean;
  variant?: "default" | "small";
}) {
  const base =
    variant === "small"
      ? "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs"
      : "flex items-center gap-2 rounded-md px-3 py-2 text-sm";
  const tone = active
    ? "bg-kumo-base font-medium text-kumo-default ring-1 ring-amber-500/40"
    : "text-kumo-subtle hover:bg-kumo-base/60 hover:text-kumo-default";
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${base} ${tone}`}
    >
      <span className="truncate">{label}</span>
    </a>
  );
}

/**
 * Renders the sidebar body. Used both inside the fixed desktop pane and
 * inside the mobile drawer so layout chrome and content stay in sync.
 */
function SidebarBody(props: {
  auth: ShellAuth;
  currentPath?: string;
  projects?: ShellProject[];
  currentProject?: ShellProject;
  activeTeamName?: string;
  activeTeamSlug?: string;
  teamSwitcher?: { id: string; name: string; slug: string }[];
  signInHref: string;
}) {
  const {
    auth,
    currentPath,
    projects,
    currentProject,
    activeTeamName,
    activeTeamSlug,
    teamSwitcher,
    signInHref,
  } = props;

  const projectSubnav: NavEntry[] = currentProject
    ? [
        { href: `/p/${currentProject.id}`, label: "Issues" },
        { href: `/p/${currentProject.id}/releases`, label: "Releases" },
        {
          href: `/p/${currentProject.id}/notifications`,
          label: "Notifications",
        },
        { href: `/p/${currentProject.id}/setup`, label: "Setup" },
        { href: `/p/${currentProject.id}/settings`, label: "Settings" },
      ]
    : [];

  return (
    <div className="flex h-full flex-col gap-4 p-3">
      {/* Brand — sits at the very top of the sidebar. */}
      <a
        href="/"
        className="group flex shrink-0 items-center gap-2 rounded-md px-1 py-1"
        aria-label="Wana home"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 shadow-md shadow-amber-500/15 transition group-hover:shadow-amber-500/25">
          <WanaMark size={22} />
        </span>
        <span className="font-semibold tracking-tight text-kumo-default">
          Wana
        </span>
      </a>

      {auth === "signed-in" ? (
        <>
          {/* PROJECT PICKER — shows current project (when set) or "All projects",
              with a popover listing the active team's projects. */}
          <details className="group relative shrink-0">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-kumo-hairline bg-kumo-recessed px-3 py-2 text-sm text-kumo-default hover:bg-kumo-base">
              <span className="min-w-0 truncate">
                {currentProject ? currentProject.name : "All projects"}
              </span>
              <span className="text-kumo-subtle transition group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="absolute left-0 right-0 z-10 mt-1 max-h-[60vh] overflow-auto rounded-md border border-kumo-line bg-kumo-recessed p-1 shadow-xl ring-1 ring-black/5">
              <a
                href="/"
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${
                  !currentProject
                    ? "bg-kumo-base text-kumo-default"
                    : "text-kumo-default hover:bg-kumo-base"
                }`}
              >
                All projects
              </a>
              {projects && projects.length > 0 ? (
                <div className="my-1 border-t border-kumo-hairline" />
              ) : null}
              {projects?.map((p) => {
                const isActive = currentProject?.id === p.id;
                return (
                  <a
                    key={p.id}
                    href={`/p/${p.id}`}
                    className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs ${
                      isActive
                        ? "bg-kumo-base text-kumo-default"
                        : "text-kumo-default hover:bg-kumo-base"
                    }`}
                    title={p.id}
                  >
                    <span className="truncate">{p.name}</span>
                    {isActive ? (
                      <span className="text-amber-400" aria-label="current">
                        ●
                      </span>
                    ) : null}
                  </a>
                );
              })}
              {!projects?.length ? (
                <p className="px-2 py-1.5 text-xs text-kumo-subtle">
                  プロジェクトなし
                </p>
              ) : null}
            </div>
          </details>

          {/* PER-PROJECT SUB-NAV — only when inside a project route. */}
          {currentProject ? (
            <nav className="space-y-0.5" aria-label="Project sections">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-kumo-subtle">
                Project
              </p>
              {projectSubnav.map((it) => {
                const active =
                  it.href === `/p/${currentProject.id}`
                    ? // Issues tab: active only on exact match or /issues/* — NOT
                      //   on /notifications and /settings (which start with the
                      //   project base path).
                      currentPath === it.href ||
                      (currentPath?.startsWith(it.href + "/issues/") ?? false)
                    : isPathActive(it.href, currentPath);
                return (
                  <SideLink
                    key={it.href}
                    href={it.href}
                    label={it.label}
                    active={active}
                  />
                );
              })}
            </nav>
          ) : null}

          {/* spacer pushes the bottom group to the floor */}
          <div className="flex-1" />

          {/* BOTTOM — team chip + occasional actions + account. */}
          <div className="space-y-2 border-t border-kumo-hairline pt-3">
            {activeTeamName ? (
              <div className="flex items-stretch gap-1">
                {/* The team name itself is a link to the team's settings page —
                    same destination as Cloudflare-style "Account" anchors in
                    the sidebar bottom group. */}
                <a
                  href={
                    activeTeamSlug
                      ? `/settings/team/${encodeURIComponent(activeTeamSlug)}`
                      : "/"
                  }
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-1.5 text-[11px] font-medium text-kumo-subtle hover:bg-kumo-base hover:text-kumo-default"
                  title={
                    activeTeamSlug
                      ? `${activeTeamName} (${activeTeamSlug}) の設定`
                      : activeTeamName
                  }
                  aria-current={
                    activeTeamSlug &&
                    isPathActive(
                      `/settings/team/${encodeURIComponent(activeTeamSlug)}`,
                      currentPath
                    )
                      ? "page"
                      : undefined
                  }
                >
                  <span className="truncate">{activeTeamName}</span>
                </a>
                {/* Switcher chevron — only when 2+ teams exist. Keeping the
                    switch action separate from the name link prevents the
                    "is this a link or a dropdown?" ambiguity. */}
                {teamSwitcher && teamSwitcher.length > 1 ? (
                  <details className="group relative">
                    <summary className="flex h-full cursor-pointer list-none items-center rounded-md px-2 text-kumo-subtle hover:bg-kumo-base hover:text-kumo-default">
                      <span className="transition group-open:rotate-180">▾</span>
                    </summary>
                    <div className="absolute bottom-full right-0 z-10 mb-1 w-48 rounded-md border border-kumo-line bg-kumo-recessed p-1 shadow-xl ring-1 ring-black/5">
                      {teamSwitcher.map((t) => (
                        <a
                          key={t.id}
                          href={`/team/switch?id=${encodeURIComponent(t.id)}&next=${encodeURIComponent("/")}`}
                          className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs text-kumo-default hover:bg-kumo-base"
                          title={t.slug}
                        >
                          <span className="truncate">{t.name}</span>
                          {t.name === activeTeamName ? (
                            <span className="text-amber-400" aria-label="active">
                              ●
                            </span>
                          ) : null}
                        </a>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}

            <SideLink
              href="/projects/new"
              label="New project"
              active={isPathActive("/projects/new", currentPath)}
              variant="small"
            />
            <SideLink
              href="/onboarding/create-team"
              label="Create team"
              active={isPathActive("/onboarding/create-team", currentPath)}
              variant="small"
            />
            <SideLink
              href="/settings/account"
              label="Account"
              active={isPathActive("/settings/account", currentPath)}
              variant="small"
            />
            <a
              href="/logout"
              className="flex items-center gap-2 rounded-md border border-kumo-hairline px-2.5 py-1.5 text-xs text-kumo-subtle hover:bg-kumo-base hover:text-kumo-default"
            >
              Sign out
            </a>
          </div>
        </>
      ) : auth === "signed-out" ? (
        <>
          <div className="flex-1" />
          <a
            className="shrink-0 rounded-md bg-kumo-brand/15 px-3 py-1.5 text-center text-xs font-semibold text-kumo-brand hover:bg-kumo-brand/25"
            href={signInHref}
          >
            Sign in
          </a>
        </>
      ) : null}
    </div>
  );
}

export function Shell(props: ShellProps) {
  const auth = props.auth ?? "hidden";
  const signInHref = loginHref(props.loginNext);

  const sidebarData = {
    auth,
    currentPath: props.currentPath,
    projects: props.projects,
    currentProject: props.currentProject,
    activeTeamName: props.activeTeamName,
    activeTeamSlug: props.activeTeamSlug,
    teamSwitcher: props.teamSwitcher,
    signInHref,
  } as const;

  // `auth="hidden"` is the bare layout used by login / signup — no
  // sidebar, no mobile hamburger, just centered content. Lets the auth
  // pages design their own composition (logo + buttons) without competing
  // chrome.
  // No sidebar / top bar — pages handle their own composition. Width is
  // left to the children: login/signup wrap with `max-w-md`, landing
  // spans the full viewport with its own per-section containers.
  if (auth === "hidden") {
    return (
      <div className="min-h-screen bg-kumo-canvas text-kumo-default antialiased">
        <main className="min-h-screen px-4 py-8">{props.children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-kumo-canvas text-kumo-default antialiased">
      {/* MOBILE TOP BAR — hamburger opens a <details> off-canvas drawer with the
          same sidebar content. Hidden on md+ where the persistent sidebar is
          visible. */}
      <header className="sticky top-0 z-40 border-b border-kumo-hairline bg-kumo-canvas/85 backdrop-blur-xl md:hidden">
        <details className="group">
          <summary className="flex h-14 cursor-pointer list-none items-center gap-3 px-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-kumo-hairline text-kumo-default group-open:bg-kumo-base">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900">
                <WanaMark size={18} />
              </span>
              <span className="truncate font-semibold text-kumo-default">
                {props.currentProject?.name ?? "Wana"}
              </span>
            </span>
          </summary>
          {/* Drawer panel — sits below the header bar. */}
          <div className="border-t border-kumo-hairline bg-kumo-canvas">
            <SidebarBody {...sidebarData} />
          </div>
        </details>
      </header>

      {/* DESKTOP SIDEBAR — fixed left pane. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-kumo-hairline bg-kumo-canvas/95 backdrop-blur md:flex md:flex-col">
        <SidebarBody {...sidebarData} />
      </aside>

      {/* MAIN — leaves room for the sidebar on md+. */}
      <main className="px-4 py-6 sm:px-6 sm:py-10 md:ml-60 md:py-12">
        <div className="mx-auto max-w-5xl">{props.children}</div>
      </main>
    </div>
  );
}

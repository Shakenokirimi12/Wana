import { createRoute } from "honox/factory";

import {
  getUserDisplayById,
  listOrganizationsForUser,
  listProjectsForDashboardUser,
} from "@/data/control-plane";
import {
  getActiveOrgId,
  getDashboardUserId,
  isOpenSignupEnabled,
} from "@/lib/dashboard-user";
import { Badge, Card, LinkPrimary, PageHeader } from "@/ui/components";
import { LandingPage } from "@/ui/landing";
import { Shell } from "@/ui/shell";

export default createRoute(async (c) => {
  const userId = getDashboardUserId(c);
  if (!userId) {
    return c.render(
      <LandingPage
        showSignup={isOpenSignupEnabled(c.env)}
        currentPath={c.req.path}
      />,
      { title: "Wana — Cloudflare-native crash reporting" }
    );
  }

  const activeOrgId = getActiveOrgId(c);
  const teams = await listOrganizationsForUser(c.env.DB_CONTROL, userId);

  if (teams.length === 0) {
    return c.redirect("/onboarding/create-team");
  }

  const rows = await listProjectsForDashboardUser(
    c.env.DB_CONTROL,
    userId,
    activeOrgId
  );

  const me = await getUserDisplayById(c.env.DB_CONTROL, userId);
  const activeTeam = teams.find((t) => t.id === activeOrgId);
  const qOk = c.req.query("ok");

  return c.render(
    <Shell
      currentPath={c.req.path}
      title="Projects"
      activeTeamName={activeTeam?.name}
      activeTeamSlug={activeTeam?.slug}
      teamSwitcher={teams.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
      }))}
      projects={rows.map((p) => ({ id: p.id, name: p.name }))}
      auth="signed-in"
    >
      {qOk === "1" ? (
        <div className="mb-6 rounded-lg border border-emerald-500/25 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          チームに参加しました。アクティブチームを切り替えるにはサイドバーから選択してください。
        </div>
      ) : null}

      <PageHeader
        title="Projects"
        description="アクティブチームのプロジェクト一覧。チーム切替・設定はサイドバー下部から。"
        actions={<LinkPrimary href="/projects/new">New project</LinkPrimary>}
      />

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-6 px-6 py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-kumo-hairline bg-kumo-recessed">
              <span className="text-2xl text-kumo-subtle" aria-hidden="true">
                ◈
              </span>
            </div>
            <div className="max-w-sm space-y-2">
              <p className="font-medium text-kumo-default">プロジェクトがありません</p>
              <p className="text-sm text-kumo-subtle">
                管理者ロールがあれば新規作成できます。メンバーの場合は管理者にご依頼ください。
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <LinkPrimary href="/projects/new">Create project</LinkPrimary>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-kumo-hairline">
            {rows.map((p) => (
              <li
                key={p.id}
                className="group transition-colors hover:bg-kumo-base"
              >
                <a
                  className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between"
                  href={`/p/${p.id}`}
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold tracking-tight text-kumo-default group-hover:text-amber-400">
                        {p.name}
                      </span>
                      <Badge variant="zinc">{p.orgSlug}</Badge>
                    </div>
                    <p className="truncate text-sm text-kumo-subtle">
                      <span className="text-kumo-subtle">{p.orgName}</span>
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-amber-500/90 group-hover:text-amber-400">
                    Open
                    <span aria-hidden="true">→</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Shell>,
    { title: "Projects — Wana" }
  );
});

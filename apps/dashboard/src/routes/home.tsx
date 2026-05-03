import { Hono } from "hono";

import { listProjectsForDashboardUser } from "../data/control-plane";
import { dashboardUserId, playgroundHref } from "../lib/dashboard-user";
import {
  Badge,
  Card,
  LinkPrimary,
  PageHeader,
} from "../ui/components";
import { Shell } from "../ui/shell";
import type { Env } from "../types/bindings";

export const homeRoute = new Hono<{ Bindings: Env }>();

homeRoute.get("/", async (c) => {
  const userId = dashboardUserId(c.env);
  const rows = await listProjectsForDashboardUser(c.env.DB_CONTROL, userId);

  return c.render(
    <Shell title="Projects" playgroundUrl={playgroundHref(c.env)}>
      <PageHeader
        title="Projects"
        description={
          <>
            あなたが所属する組織のプロジェクト一覧（ユーザー{" "}
            <span class="font-mono text-zinc-400">{userId}</span>
            ）。イベントはプロジェクトごとの Durable Object に保存されます。
          </>
        }
        actions={<LinkPrimary href="/projects/new">New project</LinkPrimary>}
      />

      <Card class="overflow-hidden">
        {rows.length === 0 ? (
          <div class="flex flex-col items-center justify-center gap-6 px-6 py-16 text-center">
            <div class="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/30">
              <span class="text-2xl text-zinc-600" aria-hidden="true">
                ◈
              </span>
            </div>
            <div class="max-w-sm space-y-2">
              <p class="font-medium text-zinc-300">プロジェクトがありません</p>
              <p class="text-sm text-zinc-500">
                新規作成するか、ローカル D1 にシードを流し込んでください。
              </p>
            </div>
            <div class="flex flex-wrap items-center justify-center gap-3">
              <LinkPrimary href="/projects/new">Create project</LinkPrimary>
            </div>
            <p class="text-xs text-zinc-600">
              シード: <code class="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-zinc-400">./scripts/setup-local.sh</code>
            </p>
          </div>
        ) : (
          <ul class="divide-y divide-zinc-800/80">
            {rows.map((p) => (
              <li class="group transition-colors hover:bg-zinc-800/20">
                <a
                  class="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between"
                  href={`/p/${p.id}`}
                >
                  <div class="min-w-0 space-y-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-lg font-semibold tracking-tight text-zinc-50 group-hover:text-amber-400">
                        {p.name}
                      </span>
                      <Badge variant="zinc">{p.orgSlug}</Badge>
                    </div>
                    <p class="truncate text-sm text-zinc-500">
                      <span class="text-zinc-400">{p.orgName}</span>
                      <span class="mx-2 text-zinc-700">·</span>
                      <span class="font-mono text-xs text-zinc-500">{p.id}</span>
                    </p>
                  </div>
                  <span class="flex shrink-0 items-center gap-2 text-sm font-medium text-amber-500/90 group-hover:text-amber-400">
                    Open
                    <span aria-hidden="true">→</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Shell>
  );
});

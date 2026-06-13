import { Hono, type Context } from "hono";

import {
  createEndpoint,
  createRule,
  deleteEndpoint,
  deleteRule,
  getProjectRoleForUser,
  getProjectRow,
  listEndpoints,
  listRecentDeliveries,
  listRules,
  rotateEndpointSecret,
  updateEndpoint,
  updateRule,
  userCanAccessProject,
} from "@/data/control-plane";
import { orgRoleAtLeast } from "@/data/services/org-service";
import { dispatchTestSend } from "@/data/services/notification-dispatch-client";
import { getDashboardUserId } from "@/lib/dashboard-user";
import {
  Badge,
  ButtonDestructiveOutline,
  ButtonPrimary,
  ButtonSecondary,
  Card,
  InputField,
  PageHeader,
  TextLink,
} from "@/ui/components";
import { Shell } from "@/ui/shell";
import type { Env } from "@/types/bindings";

export const notificationsRoute = new Hono<{ Bindings: Env }>();

function fmtTime(t: Date | null | undefined): string {
  if (!t) return "—";
  const d = t instanceof Date ? t : new Date(t);
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

notificationsRoute.get("/:projectId/notifications", async (c) => {
  const projectId = c.req.param("projectId");
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");
  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) return c.redirect("/");
  if (!(await userCanAccessProject(c.env.DB_CONTROL, uid, projectId))) {
    return c.redirect("/");
  }
  const role = await getProjectRoleForUser(c.env.DB_CONTROL, uid, projectId);
  if (!role || !orgRoleAtLeast(role, "admin")) {
    return c.redirect(`/p/${projectId}/settings?err=${encodeURIComponent("通知設定は admin 以上が必要です")}`);
  }

  const [endpoints, rules, deliveries] = await Promise.all([
    listEndpoints(c.env.DB_CONTROL, projectId),
    listRules(c.env.DB_CONTROL, projectId),
    listRecentDeliveries(c.env.DB_CONTROL, projectId, 20),
  ]);

  const issuedSecret = c.req.query("secret");
  const issuedEndpoint = c.req.query("endpoint");
  const err = c.req.query("err");
  const ok = c.req.query("ok");
  const testResult = c.req.query("test");

  return c.render(
    <Shell title={`${project.name} — Notifications`} auth="signed-in">
      <div className="mb-8">
        <TextLink href={`/p/${projectId}/settings`}>← Settings</TextLink>
      </div>
      <PageHeader
        title="Notifications"
        description={`${project.name}（${project.orgName}）— Issue が発生したときに webhook を送信します。`}
      />

      {err ? (
        <Card className="mb-4 p-3">
          <p className="text-sm text-rose-400">{err}</p>
        </Card>
      ) : null}
      {ok ? (
        <Card className="mb-4 p-3">
          <p className="text-sm text-emerald-400">{ok}</p>
        </Card>
      ) : null}
      {testResult ? (
        <Card className="mb-4 p-3">
          <p className="text-sm text-kumo-default">{testResult}</p>
        </Card>
      ) : null}

      {issuedSecret && issuedEndpoint ? (
        <Card className="mb-6 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
            シークレットを今すぐコピーしてください
          </h2>
          <p className="mt-2 text-sm text-kumo-subtle">
            この画面を離れると再表示できません。受信側で <code>X-Wana-Signature</code> ヘッダを HMAC-SHA256 検証する際に使います。
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-kumo-hairline bg-kumo-recessed p-3 font-mono text-xs text-kumo-default">
            {issuedSecret}
          </pre>
          <p className="mt-2 text-[11px] text-kumo-subtle">
            送信先 ID: <code className="font-mono">{issuedEndpoint}</code>
          </p>
        </Card>
      ) : null}

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
        送信先 (endpoints)
      </h2>
      <Card className="mb-8 overflow-hidden">
        {endpoints.length === 0 ? (
          <p className="p-6 text-sm text-kumo-subtle">
            送信先がまだありません。下のフォームから追加してください。
          </p>
        ) : (
          <ul className="divide-y divide-kumo-hairline">
            {endpoints.map((ep) => (
              <li
                key={ep.id}
                className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center sm:px-6"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-kumo-default">{ep.name}</span>
                    <Badge variant="zinc">{ep.kind}</Badge>
                    {ep.isActive ? (
                      <Badge variant="emerald">active</Badge>
                    ) : (
                      <Badge variant="zinc">disabled</Badge>
                    )}
                  </div>
                  <p className="break-all font-mono text-xs text-kumo-subtle">{ep.target}</p>
                  <p className="text-[11px] text-kumo-subtle">
                    シークレットヒント <code className="font-mono">…{ep.secretHint}</code>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <form method="post" action={`/p/${projectId}/notifications/endpoints/${ep.id}/toggle`}>
                    <ButtonSecondary type="submit">
                      {ep.isActive ? "無効化" : "有効化"}
                    </ButtonSecondary>
                  </form>
                  <form method="post" action={`/p/${projectId}/notifications/endpoints/${ep.id}/rotate`}>
                    <ButtonSecondary type="submit">鍵を再発行</ButtonSecondary>
                  </form>
                  <form method="post" action={`/p/${projectId}/notifications/endpoints/${ep.id}/delete`}>
                    <ButtonDestructiveOutline type="submit">削除</ButtonDestructiveOutline>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mb-10 p-5">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
          送信先を追加
        </h3>
        <form
          method="post"
          action={`/p/${projectId}/notifications/endpoints/create`}
          className="space-y-3"
        >
          <InputField label="名前" name="name" placeholder="Slack #alerts" required />
          <InputField
            label="Webhook URL (https のみ)"
            name="target"
            placeholder="https://hooks.slack.com/services/..."
            required
          />
          <ButtonPrimary type="submit">作成</ButtonPrimary>
        </form>
      </Card>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
        ルール
      </h2>
      <Card className="mb-8 overflow-hidden">
        {rules.length === 0 ? (
          <p className="p-6 text-sm text-kumo-subtle">
            ルールがまだありません。下のフォームから追加してください。
          </p>
        ) : (
          <ul className="divide-y divide-kumo-hairline">
            {rules.map((r) => (
              <li
                key={r.id}
                className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center sm:px-6"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-kumo-default">{r.name}</span>
                    {r.isActive ? (
                      <Badge variant="emerald">active</Badge>
                    ) : (
                      <Badge variant="zinc">disabled</Badge>
                    )}
                    {r.onIssueCreated ? <Badge variant="zinc">issue.created</Badge> : null}
                  </div>
                  <p className="text-xs text-kumo-subtle">
                    送信先: <span className="font-medium text-kumo-default">{r.endpointName ?? "?"}</span>
                    {" · "}
                    スロットル {r.minIntervalSeconds}s
                    {" · "}
                    last_fired {fmtTime(r.lastFiredAt)}
                  </p>
                  {r.filterQuery ? (
                    <p className="text-xs">
                      <span className="text-kumo-subtle">フィルタ:</span>{" "}
                      <code className="font-mono text-kumo-default">{r.filterQuery}</code>
                    </p>
                  ) : (
                    <p className="text-xs text-kumo-subtle">フィルタなし（毎回 fire）</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <form method="post" action={`/p/${projectId}/notifications/rules/${r.id}/toggle`}>
                    <ButtonSecondary type="submit">
                      {r.isActive ? "無効化" : "有効化"}
                    </ButtonSecondary>
                  </form>
                  <form method="post" action={`/p/${projectId}/notifications/rules/${r.id}/test`}>
                    <ButtonSecondary type="submit">テスト送信</ButtonSecondary>
                  </form>
                  <form method="post" action={`/p/${projectId}/notifications/rules/${r.id}/delete`}>
                    <ButtonDestructiveOutline type="submit">削除</ButtonDestructiveOutline>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mb-10 p-5">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
          ルールを追加
        </h3>
        <form
          method="post"
          action={`/p/${projectId}/notifications/rules/create`}
          className="space-y-3"
        >
          <InputField label="名前" name="name" placeholder="本番の重大エラー" required />
          <div className="space-y-1">
            <label className="block text-xs font-medium uppercase tracking-wider text-kumo-subtle">
              送信先
            </label>
            <select
              name="endpoint_id"
              required
              className="h-9 w-full rounded-lg border border-kumo-hairline bg-kumo-recessed px-3 text-sm text-kumo-default focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
            >
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.name}
                </option>
              ))}
            </select>
            {endpoints.length === 0 ? (
              <p className="text-[11px] text-rose-400">先に送信先を作成してください。</p>
            ) : null}
          </div>
          <InputField
            label="フィルタ（省略可・既存の検索文法）"
            name="filter_query"
            placeholder="environment:prod level:error"
            mono
          />
          <InputField
            label="スロットル秒数（同じルールを連続発火させない間隔）"
            name="min_interval_seconds"
            placeholder="60"
            type="number"
          />
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              name="on_issue_created"
              value="1"
              defaultChecked
              id="on_issue_created"
            />
            <label htmlFor="on_issue_created" className="text-xs text-kumo-default">
              新規 issue が作られたとき
            </label>
          </div>
          <ButtonPrimary type="submit">作成</ButtonPrimary>
        </form>
      </Card>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
        最近の配信履歴
      </h2>
      <Card className="mb-10 overflow-hidden">
        {deliveries.length === 0 ? (
          <p className="p-6 text-sm text-kumo-subtle">配信履歴はまだありません。</p>
        ) : (
          <ul className="divide-y divide-kumo-hairline text-xs">
            {deliveries.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3 sm:px-6"
              >
                <span className="font-mono tabular-nums text-kumo-subtle">
                  {fmtTime(d.createdAt)}
                </span>
                <Badge variant="zinc">{d.eventKind}</Badge>
                {d.status === "delivered" ? (
                  <Badge variant="emerald">delivered</Badge>
                ) : (
                  <Badge variant="rose">{d.status}</Badge>
                )}
                {d.responseStatus != null ? (
                  <span className="text-kumo-subtle">
                    HTTP {d.responseStatus}
                    {d.responseMs != null ? ` · ${d.responseMs}ms` : ""}
                  </span>
                ) : null}
                {d.errorMessage ? (
                  <span className="text-rose-300">{d.errorMessage}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Shell>,
    { title: `${project.name} — Notifications` }
  );
});

// ── POSTs ───────────────────────────────────────────────────────────────────

async function withAdminGuard(
  c: Context<{ Bindings: Env }>,
  projectId: string
): Promise<{ uid: string } | Response> {
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");
  const role = await getProjectRoleForUser(c.env.DB_CONTROL, uid, projectId);
  if (!role || !orgRoleAtLeast(role, "admin")) {
    return c.redirect(`/p/${projectId}/settings?err=${encodeURIComponent("権限がありません")}`);
  }
  return { uid };
}

notificationsRoute.post("/:projectId/notifications/endpoints/create", async (c) => {
  const projectId = c.req.param("projectId");
  const gate = await withAdminGuard(c, projectId);
  if (gate instanceof Response) return gate;
  const body = await c.req.parseBody();
  try {
    const { id, plainSecret } = await createEndpoint(c.env.DB_CONTROL, c.env, {
      projectId,
      actingUserId: gate.uid,
      name: String(body.name ?? ""),
      target: String(body.target ?? ""),
    });
    return c.redirect(
      `/p/${projectId}/notifications?secret=${encodeURIComponent(plainSecret)}&endpoint=${encodeURIComponent(id)}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "作成に失敗しました";
    return c.redirect(`/p/${projectId}/notifications?err=${encodeURIComponent(msg)}`);
  }
});

notificationsRoute.post("/:projectId/notifications/endpoints/:endpointId/toggle", async (c) => {
  const projectId = c.req.param("projectId");
  const endpointId = c.req.param("endpointId");
  const gate = await withAdminGuard(c, projectId);
  if (gate instanceof Response) return gate;
  // Determine current state by re-listing (cheap, low-volume table)
  const eps = await listEndpoints(c.env.DB_CONTROL, projectId);
  const cur = eps.find((e) => e.id === endpointId);
  if (!cur) {
    return c.redirect(`/p/${projectId}/notifications?err=${encodeURIComponent("送信先が見つかりません")}`);
  }
  try {
    await updateEndpoint(c.env.DB_CONTROL, {
      projectId,
      actingUserId: gate.uid,
      endpointId,
      isActive: !cur.isActive,
    });
    return c.redirect(`/p/${projectId}/notifications?ok=${encodeURIComponent("送信先を更新しました")}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "更新に失敗しました";
    return c.redirect(`/p/${projectId}/notifications?err=${encodeURIComponent(msg)}`);
  }
});

notificationsRoute.post("/:projectId/notifications/endpoints/:endpointId/rotate", async (c) => {
  const projectId = c.req.param("projectId");
  const endpointId = c.req.param("endpointId");
  const gate = await withAdminGuard(c, projectId);
  if (gate instanceof Response) return gate;
  try {
    const { plainSecret } = await rotateEndpointSecret(c.env.DB_CONTROL, c.env, {
      projectId,
      actingUserId: gate.uid,
      endpointId,
    });
    return c.redirect(
      `/p/${projectId}/notifications?secret=${encodeURIComponent(plainSecret)}&endpoint=${encodeURIComponent(endpointId)}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "再発行に失敗しました";
    return c.redirect(`/p/${projectId}/notifications?err=${encodeURIComponent(msg)}`);
  }
});

notificationsRoute.post("/:projectId/notifications/endpoints/:endpointId/delete", async (c) => {
  const projectId = c.req.param("projectId");
  const endpointId = c.req.param("endpointId");
  const gate = await withAdminGuard(c, projectId);
  if (gate instanceof Response) return gate;
  try {
    await deleteEndpoint(c.env.DB_CONTROL, {
      projectId,
      actingUserId: gate.uid,
      endpointId,
    });
    return c.redirect(`/p/${projectId}/notifications?ok=${encodeURIComponent("送信先を削除しました")}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "削除に失敗しました";
    return c.redirect(`/p/${projectId}/notifications?err=${encodeURIComponent(msg)}`);
  }
});

notificationsRoute.post("/:projectId/notifications/rules/create", async (c) => {
  const projectId = c.req.param("projectId");
  const gate = await withAdminGuard(c, projectId);
  if (gate instanceof Response) return gate;
  const body = await c.req.parseBody();
  try {
    await createRule(c.env.DB_CONTROL, {
      projectId,
      actingUserId: gate.uid,
      name: String(body.name ?? ""),
      endpointId: String(body.endpoint_id ?? ""),
      onIssueCreated: body.on_issue_created === "1" || body.on_issue_created === "on",
      filterQuery: body.filter_query ? String(body.filter_query) : undefined,
      minIntervalSeconds: body.min_interval_seconds
        ? Number(body.min_interval_seconds)
        : undefined,
    });
    return c.redirect(`/p/${projectId}/notifications?ok=${encodeURIComponent("ルールを作成しました")}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "作成に失敗しました";
    return c.redirect(`/p/${projectId}/notifications?err=${encodeURIComponent(msg)}`);
  }
});

notificationsRoute.post("/:projectId/notifications/rules/:ruleId/toggle", async (c) => {
  const projectId = c.req.param("projectId");
  const ruleId = c.req.param("ruleId");
  const gate = await withAdminGuard(c, projectId);
  if (gate instanceof Response) return gate;
  const rules = await listRules(c.env.DB_CONTROL, projectId);
  const cur = rules.find((r) => r.id === ruleId);
  if (!cur) {
    return c.redirect(`/p/${projectId}/notifications?err=${encodeURIComponent("ルールが見つかりません")}`);
  }
  try {
    await updateRule(c.env.DB_CONTROL, {
      projectId,
      actingUserId: gate.uid,
      ruleId,
      isActive: !cur.isActive,
    });
    return c.redirect(`/p/${projectId}/notifications?ok=${encodeURIComponent("ルールを更新しました")}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "更新に失敗しました";
    return c.redirect(`/p/${projectId}/notifications?err=${encodeURIComponent(msg)}`);
  }
});

notificationsRoute.post("/:projectId/notifications/rules/:ruleId/delete", async (c) => {
  const projectId = c.req.param("projectId");
  const ruleId = c.req.param("ruleId");
  const gate = await withAdminGuard(c, projectId);
  if (gate instanceof Response) return gate;
  try {
    await deleteRule(c.env.DB_CONTROL, {
      projectId,
      actingUserId: gate.uid,
      ruleId,
    });
    return c.redirect(`/p/${projectId}/notifications?ok=${encodeURIComponent("ルールを削除しました")}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "削除に失敗しました";
    return c.redirect(`/p/${projectId}/notifications?err=${encodeURIComponent(msg)}`);
  }
});

notificationsRoute.post("/:projectId/notifications/rules/:ruleId/test", async (c) => {
  const projectId = c.req.param("projectId");
  const ruleId = c.req.param("ruleId");
  const gate = await withAdminGuard(c, projectId);
  if (gate instanceof Response) return gate;
  const rules = await listRules(c.env.DB_CONTROL, projectId);
  const r = rules.find((r) => r.id === ruleId);
  if (!r) {
    return c.redirect(`/p/${projectId}/notifications?err=${encodeURIComponent("ルールが見つかりません")}`);
  }
  try {
    const result = await dispatchTestSend(c.env, {
      projectId,
      endpointId: r.endpointId,
      triggeredByUserId: gate.uid,
    });
    const msg = `テスト送信: ${result.status}${
      result.responseStatus != null ? ` (HTTP ${result.responseStatus})` : ""
    }${result.errorMessage ? ` — ${result.errorMessage}` : ""}`;
    return c.redirect(`/p/${projectId}/notifications?test=${encodeURIComponent(msg)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "テスト送信に失敗しました";
    return c.redirect(`/p/${projectId}/notifications?err=${encodeURIComponent(msg)}`);
  }
});

export default notificationsRoute;

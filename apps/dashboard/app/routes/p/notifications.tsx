import { Hono, type Context } from "hono";

import {
  createEndpoint,
  createRule,
  deleteEndpoint,
  deleteRule,
  getProjectFeatures,
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
import { loadShellSidebar } from "@/lib/shell-data";
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
import {
  DiscordIcon,
  MailIcon,
  PlusIcon,
  SlackIcon,
  WebhookIcon,
} from "@/ui/icons";
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

  const [endpoints, rules, deliveries, features, sidebar] = await Promise.all([
    listEndpoints(c.env.DB_CONTROL, projectId),
    listRules(c.env.DB_CONTROL, projectId),
    listRecentDeliveries(c.env.DB_CONTROL, projectId, 20),
    getProjectFeatures(c.env.DB_CONTROL, projectId),
    loadShellSidebar(c, uid),
  ]);

  const issuedSecret = c.req.query("secret");
  const issuedEndpoint = c.req.query("endpoint");
  const err = c.req.query("err");
  const ok = c.req.query("ok");
  const testResult = c.req.query("test");
  // Add-new workflow step:
  //   ""        → just show the endpoint list (no add form open)
  //   "pick"    → show the channel picker (Slack / Mail / Discord / Webhook)
  //   "slack"…  → show the form for that specific kind
  const addRaw = c.req.query("add") ?? "";
  type AddStep = "" | "pick" | "slack" | "email" | "discord" | "webhook";
  const addStep: AddStep =
    addRaw === "pick" ||
    addRaw === "slack" ||
    addRaw === "email" ||
    addRaw === "discord" ||
    addRaw === "webhook"
      ? (addRaw as AddStep)
      : "";
  const baseHref = `/p/${projectId}/notifications`;

  return c.render(
    <Shell
      currentPath={c.req.path}
      title={`${project.name} — Notifications`}
      auth="signed-in"
      {...sidebar}
      currentProject={{ id: project.id, name: project.name }}
    >
      <PageHeader
        title="Notifications"
        description={`${project.name}（${project.orgName}）— Issue が発生したときに Slack / メール / 任意の Webhook へ通知します。`}
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

      {/* NEW ENDPOINT — gated behind a `+ 送信先を追加` button.
          Step 1: click button → ?add=pick (channel picker)
          Step 2: click a channel → ?add=<kind> (channel-specific form)
          Step 3: submit form → endpoint created, redirect back here */}
      {addStep === "pick" ? (
        <Card className="mb-8 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-kumo-default">
              送信先の種類を選択
            </h2>
            <TextLink href={baseHref}>キャンセル</TextLink>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <a
              href={`${baseHref}?add=slack`}
              className="group flex flex-col gap-2 rounded-lg border border-kumo-hairline bg-kumo-recessed p-4 transition hover:border-kumo-line hover:bg-kumo-base"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#4A154B] text-white">
                  <SlackIcon size={18} />
                </span>
                <span className="text-sm font-semibold text-kumo-default">Slack</span>
              </div>
              <p className="text-xs text-kumo-subtle">
                Slack Incoming Webhook で #channel に投稿。
              </p>
            </a>
            {features.emailNotifications ? (
              <a
                href={`${baseHref}?add=email`}
                className="group flex flex-col gap-2 rounded-lg border border-kumo-hairline bg-kumo-recessed p-4 transition hover:border-kumo-line hover:bg-kumo-base"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-600 text-white">
                    <MailIcon size={18} />
                  </span>
                  <span className="text-sm font-semibold text-kumo-default">Mail</span>
                </div>
                <p className="text-xs text-kumo-subtle">
                  指定したメールアドレスへ通知を送信。
                </p>
              </a>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border border-dashed border-kumo-hairline bg-kumo-recessed p-4 opacity-60">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-600 text-white">
                    <MailIcon size={18} />
                  </span>
                  <span className="text-sm font-semibold text-kumo-default">Mail</span>
                </div>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  組織プランで有効化が必要。
                </p>
              </div>
            )}
            <a
              href={`${baseHref}?add=discord`}
              className="group flex flex-col gap-2 rounded-lg border border-kumo-hairline bg-kumo-recessed p-4 transition hover:border-kumo-line hover:bg-kumo-base"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#5865F2] text-white">
                  <DiscordIcon size={18} />
                </span>
                <span className="text-sm font-semibold text-kumo-default">Discord</span>
              </div>
              <p className="text-xs text-kumo-subtle">
                Discord ウェブフックでサーバへ embed 投稿。
              </p>
            </a>
            <a
              href={`${baseHref}?add=webhook`}
              className="group flex flex-col gap-2 rounded-lg border border-kumo-hairline bg-kumo-recessed p-4 transition hover:border-kumo-line hover:bg-kumo-base"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-700 text-kumo-default">
                  <WebhookIcon size={18} />
                </span>
                <span className="text-sm font-semibold text-kumo-default">Webhook</span>
              </div>
              <p className="text-xs text-kumo-subtle">
                任意のサーバへ HMAC 署名付き JSON を POST。
              </p>
            </a>
          </div>
        </Card>
      ) : null}

      {addStep === "slack" ? (
        <Card className="mb-8 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#4A154B] text-white">
                <SlackIcon size={18} />
              </span>
              <h2 className="text-sm font-semibold text-kumo-default">
                Slack を追加
              </h2>
            </div>
            <TextLink href={`${baseHref}?add=pick`}>← 種類を選び直す</TextLink>
          </div>
          <p className="mb-4 text-xs text-kumo-subtle">
            Slack Incoming Webhook で #channel に投稿します。Slack 側で App の
            Webhook URL を発行して貼り付けてください。
          </p>
          <form
            method="post"
            action={`/p/${projectId}/notifications/endpoints/create`}
            className="max-w-xl space-y-3"
          >
            <input type="hidden" name="kind" value="slack" />
            <InputField label="名前" name="name" placeholder="#alerts" required />
            <InputField
              label="Slack Webhook URL"
              name="target"
              placeholder="https://hooks.slack.com/services/T.../B.../..."
              mono
              required
            />
            <ButtonPrimary type="submit">追加</ButtonPrimary>
          </form>
        </Card>
      ) : null}

      {addStep === "email" ? (
        <Card className="mb-8 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-600 text-white">
                <MailIcon size={18} />
              </span>
              <h2 className="text-sm font-semibold text-kumo-default">
                Mail を追加
              </h2>
            </div>
            <TextLink href={`${baseHref}?add=pick`}>← 種類を選び直す</TextLink>
          </div>
          {features.emailNotifications ? (
            <>
              <p className="mb-4 text-xs text-kumo-subtle">
                指定したメールアドレスへ通知を送信します。送信元は{" "}
                <code className="font-mono">wana@shakenokiri.me</code> 固定です。
              </p>
              <form
                method="post"
                action={`/p/${projectId}/notifications/endpoints/create`}
                className="max-w-xl space-y-3"
              >
                <input type="hidden" name="kind" value="email" />
                <InputField
                  label="名前"
                  name="name"
                  placeholder="on-call ML"
                  required
                />
                <InputField
                  label="メールアドレス"
                  name="target"
                  placeholder="alerts@example.com"
                  required
                />
                <ButtonPrimary type="submit">追加</ButtonPrimary>
              </form>
            </>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              メール通知は組織プランで有効化されると選択できます。
            </p>
          )}
        </Card>
      ) : null}

      {addStep === "discord" ? (
        <Card className="mb-8 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#5865F2] text-white">
                <DiscordIcon size={18} />
              </span>
              <h2 className="text-sm font-semibold text-kumo-default">
                Discord を追加
              </h2>
            </div>
            <TextLink href={`${baseHref}?add=pick`}>← 種類を選び直す</TextLink>
          </div>
          <p className="mb-4 text-xs text-kumo-subtle">
            Discord サーバ設定 → 連携サービス → ウェブフックで作成。投稿先
            チャンネルは作成時に指定したものに固定されます。
          </p>
          <form
            method="post"
            action={`/p/${projectId}/notifications/endpoints/create`}
            className="max-w-xl space-y-3"
          >
            <input type="hidden" name="kind" value="discord" />
            <InputField
              label="名前（社内識別用）"
              name="name"
              placeholder="本番アラート"
              required
            />
            <InputField
              label="Discord Webhook URL"
              name="target"
              placeholder="https://discord.com/api/webhooks/<id>/<token>"
              mono
              required
            />
            <InputField
              label="スレッド ID（任意・forum / 既存スレッド宛て）"
              name="thread_id"
              placeholder="1234567890123456789"
              mono
            />
            <ButtonPrimary type="submit">追加</ButtonPrimary>
          </form>
        </Card>
      ) : null}

      {addStep === "webhook" ? (
        <Card className="mb-8 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-700 text-kumo-default">
                <WebhookIcon size={18} />
              </span>
              <h2 className="text-sm font-semibold text-kumo-default">
                Webhook を追加
              </h2>
            </div>
            <TextLink href={`${baseHref}?add=pick`}>← 種類を選び直す</TextLink>
          </div>
          <p className="mb-4 text-xs text-kumo-subtle">
            任意のサーバへ HMAC 署名付き JSON を POST。シークレットは作成時に
            一度だけ表示します（<code>X-Wana-Signature</code> 検証用）。
          </p>
          <form
            method="post"
            action={`/p/${projectId}/notifications/endpoints/create`}
            className="max-w-xl space-y-3"
          >
            <input type="hidden" name="kind" value="webhook" />
            <InputField
              label="名前"
              name="name"
              placeholder="prod ingest"
              required
            />
            <InputField
              label="URL"
              name="target"
              placeholder="https://example.com/wana-webhook"
              mono
              required
            />
            <ButtonPrimary type="submit">追加</ButtonPrimary>
          </form>
        </Card>
      ) : null}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
          送信先 (endpoints)
        </h2>
        {addStep === "" ? (
          <a
            href={`${baseHref}?add=pick`}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 shadow-sm transition hover:bg-amber-400"
          >
            <PlusIcon size={14} />
            送信先を追加
          </a>
        ) : null}
      </div>
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
                  {ep.kind === "discord" && ep.configJson
                    ? (() => {
                        try {
                          const cfg = JSON.parse(ep.configJson);
                          const tid =
                            cfg && typeof cfg.threadId === "string"
                              ? cfg.threadId
                              : null;
                          return tid ? (
                            <p className="text-[11px] text-kumo-subtle">
                              スレッド{" "}
                              <code className="font-mono">{tid}</code>
                            </p>
                          ) : null;
                        } catch {
                          return null;
                        }
                      })()
                    : null}
                  {ep.kind === "webhook" ? (
                    <p className="text-[11px] text-kumo-subtle">
                      シークレットヒント <code className="font-mono">…{ep.secretHint}</code>
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <form method="post" action={`/p/${projectId}/notifications/endpoints/${ep.id}/toggle`}>
                    <ButtonSecondary type="submit">
                      {ep.isActive ? "無効化" : "有効化"}
                    </ButtonSecondary>
                  </form>
                  {ep.kind === "webhook" ? (
                    <form method="post" action={`/p/${projectId}/notifications/endpoints/${ep.id}/rotate`}>
                      <ButtonSecondary type="submit">鍵を再発行</ButtonSecondary>
                    </form>
                  ) : null}
                  <form method="post" action={`/p/${projectId}/notifications/endpoints/${ep.id}/delete`}>
                    <ButtonDestructiveOutline type="submit">削除</ButtonDestructiveOutline>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
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
                    {r.onIssueResolved ? <Badge variant="zinc">issue.resolved</Badge> : null}
                    {r.onIssueRegressed ? <Badge variant="zinc">issue.regressed</Badge> : null}
                    {r.onSpike ? <Badge variant="zinc">issue.spike</Badge> : null}
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
          <fieldset className="space-y-1.5">
            <legend className="mb-1 block text-xs font-medium uppercase tracking-wider text-kumo-subtle">
              通知するイベント
            </legend>
            <label className="flex items-center gap-2 text-xs text-kumo-default">
              <input
                type="checkbox"
                name="on_issue_created"
                value="1"
                defaultChecked
              />
              新規 issue が作られたとき
            </label>
            <label className="flex items-center gap-2 text-xs text-kumo-default">
              <input
                type="checkbox"
                name="on_issue_resolved"
                value="1"
              />
              issue が resolved になったとき
            </label>
            <label className="flex items-center gap-2 text-xs text-kumo-default">
              <input
                type="checkbox"
                name="on_issue_regressed"
                value="1"
              />
              resolved になった issue が再発したとき（regressed）
            </label>
            <label className="flex items-center gap-2 text-xs text-kumo-default">
              <input
                type="checkbox"
                name="on_spike"
                value="1"
              />
              スパイク発生時（直近5分のレートがベースラインの3倍以上 かつ ≥10 events）
            </label>
          </fieldset>
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
  const kindRaw = String(body.kind ?? "webhook");
  const kind: "webhook" | "email" | "slack" | "discord" =
    kindRaw === "email" || kindRaw === "slack" || kindRaw === "discord"
      ? kindRaw
      : "webhook";
  try {
    let config: Record<string, unknown> | null = null;
    if (kind === "discord") {
      const t = String(body.thread_id ?? "").trim();
      if (t) config = { threadId: t };
    }
    const { id, plainSecret } = await createEndpoint(c.env.DB_CONTROL, c.env, {
      projectId,
      actingUserId: gate.uid,
      name: String(body.name ?? ""),
      kind,
      target: String(body.target ?? ""),
      config,
    });
    if (plainSecret) {
      return c.redirect(
        `/p/${projectId}/notifications?secret=${encodeURIComponent(plainSecret)}&endpoint=${encodeURIComponent(id)}`
      );
    }
    return c.redirect(
      `/p/${projectId}/notifications?ok=${encodeURIComponent("送信先を作成しました")}`
    );
  } catch (err) {
    // Keep the user on the same kind-specific form so they don't have to
    // re-click through "+ → pick → kind" to fix a typo.
    const msg = err instanceof Error ? err.message : "作成に失敗しました";
    return c.redirect(
      `/p/${projectId}/notifications?add=${encodeURIComponent(kind)}&err=${encodeURIComponent(msg)}`
    );
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
      onIssueResolved:
        body.on_issue_resolved === "1" || body.on_issue_resolved === "on",
      onIssueRegressed:
        body.on_issue_regressed === "1" || body.on_issue_regressed === "on",
      onSpike: body.on_spike === "1" || body.on_spike === "on",
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

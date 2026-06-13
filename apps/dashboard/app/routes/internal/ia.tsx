import { createRoute } from "honox/factory";

import { getDashboardUserId, playgroundHref } from "@/lib/dashboard-user";
import { Card, PageHeader, TextLink } from "@/ui/components";
import { Shell } from "@/ui/shell";

/** ダッシュボード情報設計（ワイヤー）— サインイン必須（ルートマップを公開しない） */
export default createRoute(async (c) => {
  const pg = playgroundHref(c.env);
  const uid = getDashboardUserId(c);
  if (!uid) {
    return c.redirect("/login");
  }
  return c.render(
    <Shell title="IA" playgroundUrl={pg} auth="signed-in">
      <PageHeader
        title="ダッシュボード情報設計"
        description="パスキー・Slack 方式チーム・招待・RBAC・厳密削除に沿った URL と遷移のたたき台。"
      />
      <div className="space-y-6">
        <Card className="overflow-x-auto p-6">
          <table className="w-full min-w-[36rem] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="border-b border-kumo-hairline text-xs uppercase tracking-wider text-kumo-subtle">
                <th className="pb-3 pr-4 font-medium">Path</th>
                <th className="pb-3 pr-4 font-medium">Purpose</th>
                <th className="pb-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="text-kumo-default">
              <tr className="border-b border-kumo-hairline">
                <td className="py-3 pr-4 font-mono text-xs text-amber-200/90">
                  /
                </td>
                <td className="py-3 pr-4">アクティブチームのプロジェクト一覧</td>
                <td className="py-3 text-kumo-subtle">
                  未認証 → /login。チーム切替は /team/switch?id=
                </td>
              </tr>
              <tr className="border-b border-kumo-hairline">
                <td className="py-3 pr-4 font-mono text-xs text-amber-200/90">
                  /login
                </td>
                <td className="py-3 pr-4">サインイン（WebAuthn 予定）</td>
                <td className="py-3 text-kumo-subtle">
                  dev: DASHBOARD_DEV_FALLBACK + DASHBOARD_USER_ID
                </td>
              </tr>
              <tr className="border-b border-kumo-hairline">
                <td className="py-3 pr-4 font-mono text-xs text-amber-200/90">
                  /projects/new
                </td>
                <td className="py-3 pr-4">プロジェクト作成（admin+）</td>
                <td className="py-3 text-kumo-subtle">組織は admin/owner のみ選択可</td>
              </tr>
              <tr className="border-b border-kumo-hairline">
                <td className="py-3 pr-4 font-mono text-xs text-amber-200/90">
                  /p/:id
                </td>
                <td className="py-3 pr-4">Issue ストリーム・ライブ</td>
                <td className="py-3 text-kumo-subtle">
                  危険領域: プロジェクト厳密削除（確認 UI + サーバ検証）
                </td>
              </tr>
              <tr className="border-b border-kumo-hairline">
                <td className="py-3 pr-4 font-mono text-xs text-amber-200/90">
                  /settings/team/:slug
                </td>
                <td className="py-3 pr-4">チーム設定・スラッグ・メンバー・招待</td>
                <td className="py-3 text-kumo-subtle">
                  旧スラッグ → organization_slug_redirects
                </td>
              </tr>
              <tr className="border-b border-kumo-hairline">
                <td className="py-3 pr-4 font-mono text-xs text-amber-200/90">
                  /invite/:token
                </td>
                <td className="py-3 pr-4">招待受諾</td>
                <td className="py-3 text-kumo-subtle">link / email</td>
              </tr>
              <tr className="border-b border-kumo-hairline">
                <td className="py-3 pr-4 font-mono text-xs text-amber-200/90">
                  /logout
                </td>
                <td className="py-3 pr-4">セッション終了</td>
                <td className="py-3 text-kumo-subtle">
                  D1 sessions 行削除 + Cookie クリア → /login
                </td>
              </tr>
              <tr className="border-b border-kumo-hairline">
                <td className="py-3 pr-4 font-mono text-xs text-amber-200/90">
                  POST /dev/session
                </td>
                <td className="py-3 pr-4">開発用セッション発行</td>
                <td className="py-3 text-kumo-subtle">
                  DASHBOARD_DEV_FALLBACK 時のみ。login からフォーム POST
                </td>
              </tr>
              <tr className="border-b border-kumo-hairline">
                <td className="py-3 pr-4 font-mono text-xs text-amber-200/90">
                  /team/switch
                </td>
                <td className="py-3 pr-4">アクティブチーム切替</td>
                <td className="py-3 text-kumo-subtle">GET ?id=&amp;next=</td>
              </tr>
              <tr className="border-b border-kumo-hairline">
                <td className="py-3 pr-4 font-mono text-xs text-amber-200/90">
                  /onboarding/create-team
                </td>
                <td className="py-3 pr-4">新規チーム作成（登録導線）</td>
                <td className="py-3 text-kumo-subtle">実装済み</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <TextLink href="/">← Home</TextLink>
      </div>
    </Shell>,
    { title: "IA — Wana" }
  );
});

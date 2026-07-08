import { createRoute } from "honox/factory";

import { createOrganization } from "@/data/control-plane";
import { getDashboardUserId } from "@/lib/dashboard-user";
import { loadShellSidebar } from "@/lib/shell-data";
import { ButtonPrimary, Card, InputField, PageHeader, TextLink } from "@/ui/components";
import { Shell } from "@/ui/shell";

/**
 * 登録直後など、所属チームがないユーザー向けのチーム作成導線。
 */
export default createRoute(async (c) => {
  const uid = getDashboardUserId(c);
  if (!uid) {
    return c.redirect("/login");
  }
  const sidebar = await loadShellSidebar(c, uid);

  return c.render(
    <Shell
      currentPath={c.req.path}
      title="Create team"
      auth="signed-in"
      {...sidebar}
    >
      <PageHeader
        title="チームを作成"
        description="Wana を利用するための最初の組織（チーム）を作成します。チーム名と URL 用のスラッグを指定してください。"
      />
      <Card className="max-w-lg p-6 sm:p-8">
        <form method="post" action="/onboarding/create-team" className="space-y-6">
          <InputField
            label="チーム名"
            name="name"
            placeholder="My Team"
            required
          />
          <InputField
            label="スラッグ (URL 用)"
            name="slug"
            placeholder="my-team"
            mono
            required
          />
          <p className="text-xs text-kumo-subtle leading-relaxed">
            スラッグは 2〜63 文字の英小文字・数字・ハイフンが使用できます。
            プロジェクトの URL や識別に使用されます。
          </p>
          <div className="pt-2">
            <ButtonPrimary type="submit" className="w-full sm:w-auto">
              チームを作成して開始
            </ButtonPrimary>
          </div>
        </form>
        <div className="mt-8 border-t border-kumo-hairline pt-4">
          <TextLink href="/">← Home</TextLink>
        </div>
      </Card>
    </Shell>,
    { title: "Create team — Wana" }
  );
});

export const POST = createRoute(async (c) => {
  const uid = getDashboardUserId(c);
  if (!uid) {
    return c.redirect("/login");
  }

  const body = await c.req.parseBody();
  const name = String(body.name ?? "");
  const slugRaw = String(body.slug ?? "");

  try {
    const result = await createOrganization(c.env.DB_CONTROL, {
      name,
      slugRaw,
      actingUserId: uid,
    });
    // 作成成功したらトップへ（自動的に作成したチームがアクティブになる）
    return c.redirect(`/?ok=1&team=${encodeURIComponent(result.slug)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "作成に失敗しました";
    const sidebar = await loadShellSidebar(c, uid);
    return c.render(
      <Shell
        currentPath={c.req.path}
        title="Error"
        auth="signed-in"
        {...sidebar}
      >
        <PageHeader title="エラー" description="チームの作成中に問題が発生しました。" />
        <Card className="p-8">
          <p className="text-sm text-rose-400 font-medium">{message}</p>
          <div className="mt-6">
            <TextLink href="/onboarding/create-team">← Back</TextLink>
          </div>
        </Card>
      </Shell>,
      { title: "Error — Wana" }
    );
  }
});

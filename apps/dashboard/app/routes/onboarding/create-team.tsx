import { createRoute } from "honox/factory";

import { getDashboardUserId, playgroundHref } from "@/lib/dashboard-user";
import { Card, PageHeader, TextLink } from "@/ui/components";
import { Shell } from "@/ui/shell";

/**
 * Slack 方式では通常ここに来ない（登録直後はチーム作成＋所有者）。将来の導線用プレースホルダー。
 */
export default createRoute(async (c) => {
  const pg = playgroundHref(c.env);
  const uid = getDashboardUserId(c);
  return c.render(
    <Shell
      title="Create team"
      playgroundUrl={pg}
      auth={uid ? "signed-in" : "signed-out"}
    >
      <PageHeader
        title="チームを作成"
        description="組織（チーム）作成フローは今後ここに実装します。ローカルではシードの組織を利用してください。"
      />
      <Card className="max-w-lg p-6">
        <TextLink href="/">← Home</TextLink>
      </Card>
    </Shell>,
    { title: "Create team — Wana" }
  );
});

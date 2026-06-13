import { createRoute } from "honox/factory";

import {
  createProjectWithApiKey,
  listOrganizationsForProjectCreation,
} from "@/data/control-plane";
import {
  ingestPublicOrigin,
  getActiveOrgId,
  getDashboardUserId,
} from "@/lib/dashboard-user";
import {
  ButtonPrimary,
  Card,
  InputField,
  LinkPrimary,
  PageHeader,
  SelectField,
  TextLink,
} from "@/ui/components";
import { Shell } from "@/ui/shell";
import CopyButton from "@/islands/copy-button";

export default createRoute(async (c) => {
  const uid = getDashboardUserId(c);
  if (!uid) {
    return c.redirect("/login");
  }
  const orgs = await listOrganizationsForProjectCreation(c.env.DB_CONTROL, uid);
  const activeOrgId = getActiveOrgId(c);

  if (orgs.length === 0) {
    return c.render(
      <Shell title="New project" auth="signed-in">
        <PageHeader
          title="プロジェクトを作成"
          description="プロジェクトを作るには、まずチームが必要です。"
        />
        <Card className="max-w-lg p-6 sm:p-8">
          <p className="text-sm leading-relaxed text-kumo-subtle">
            あなたが作成・管理できるチームがまだありません。最初のチームを作成すると、
            その中でプロジェクトと DSN を発行できます。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <LinkPrimary href="/onboarding/create-team">チームを作成</LinkPrimary>
            <TextLink href="/">← ホーム</TextLink>
          </div>
        </Card>
      </Shell>,
      { title: "New project — Wana" }
    );
  }

  return c.render(
    <Shell title="New project" auth="signed-in">
      <PageHeader
        title="New project"
        description="チームを選びプロジェクトを作成します。DSN の公開鍵は作成直後の画面でのみ表示されるため、必ずその場でコピーしてください。"
      />

      <Card className="max-w-lg p-6 sm:p-8">
        <form className="space-y-6" method="post" action="/projects/new">
          <SelectField
            label="Organization"
            name="orgId"
            required
            defaultValue={
              orgs.some((o) => o.id === activeOrgId)
                ? activeOrgId!
                : orgs[0]?.id
            }
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.slug})
              </option>
            ))}
          </SelectField>
          <InputField
            label="Project name"
            name="name"
            required
            placeholder="My service"
          />
          <InputField
            label="Project ID（任意・空なら自動生成）"
            name="projectId"
            mono
            placeholder="my-app-prod"
          />
          <p className="text-xs leading-relaxed text-kumo-subtle">
            ID は英字または <code className="font-mono">_</code> で始めるか、数字のみにしてください。
            先頭が「数字＋英字」の組み合わせは一部の SDK で短縮される場合があります。
          </p>
          <div className="pt-2">
            <ButtonPrimary type="submit">Create project &amp; API key</ButtonPrimary>
          </div>
        </form>
      </Card>
    </Shell>,
    { title: "New project — Wana" }
  );
});

export const POST = createRoute(async (c) => {
  const uid = getDashboardUserId(c);
  if (!uid) {
    return c.redirect("/login");
  }
  const body = await c.req.parseBody();
  const orgId = String(body.orgId ?? "");
  const name = String(body.name ?? "");
  const projectIdRaw = body.projectId
    ? String(body.projectId).trim()
    : undefined;

  try {
    const result = await createProjectWithApiKey(c.env.DB_CONTROL, c.env, {
      orgId,
      name,
      projectId: projectIdRaw || undefined,
      actingUserId: uid,
    });

    const ingestUrl = new URL(ingestPublicOrigin(c.env));
    const dsn = `${ingestUrl.protocol}//${result.plainKey}@${ingestUrl.host}/${result.projectId}`;

    return c.render(
      <Shell title="Save your DSN" auth="signed-in">
        <PageHeader
          title="すぐにコピーしてください"
          description={
            <>
              公開鍵は再表示しません。保存後に確認できるのはヒント{" "}
              <span className="font-mono text-kumo-default">{result.hint}</span>{" "}
              のみです。
            </>
          }
        />

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-kumo-hairline px-5 py-3 sm:px-6">
              <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
                Public key
              </div>
              <CopyButton value={result.plainKey} label="Public key をコピー" />
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-kumo-default sm:p-6">
              {result.plainKey}
            </pre>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-kumo-hairline px-5 py-3 sm:px-6">
              <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
                DSN
              </div>
              <CopyButton value={dsn} label="DSN をコピー" />
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-kumo-default sm:p-6">
              {dsn}
            </pre>
          </Card>

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <LinkPrimary href={`/p/${result.projectId}`}>
              Open project →
            </LinkPrimary>
            <TextLink href="/">All projects</TextLink>
          </div>
        </div>
      </Shell>,
      { title: "Save your DSN — Wana" }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "作成に失敗しました";
    return c.render(
      <Shell title="Error" auth="signed-in">
        <Card className="p-8">
          <p className="text-sm text-rose-400">{message}</p>
          <div className="mt-6">
            <TextLink href="/projects/new">← Back</TextLink>
          </div>
        </Card>
      </Shell>,
      { title: "Error — Wana" }
    );
  }
});

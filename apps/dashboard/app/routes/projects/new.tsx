import { createRoute } from "honox/factory";

import {
  createProjectWithApiKey,
  listOrganizationsForProjectCreation,
} from "@/data/control-plane";
import {
  ingestPublicOrigin,
  getActiveOrgId,
  getDashboardUserId,
  playgroundHref,
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

export default createRoute(async (c) => {
  const uid = getDashboardUserId(c);
  if (!uid) {
    return c.redirect("/login");
  }
  const orgs = await listOrganizationsForProjectCreation(c.env.DB_CONTROL, uid);
  const pg = playgroundHref(c.env);
  const activeOrgId = getActiveOrgId(c);

  if (orgs.length === 0) {
    return c.render(
      <Shell title="New project" playgroundUrl={pg} auth="signed-in">
        <Card className="p-8">
          <p className="text-sm leading-relaxed text-kumo-subtle">
            D1 に organization がありません。シード（
            <code className="rounded bg-kumo-base px-1.5 py-0.5 font-mono text-sm text-kumo-default">
              scripts/setup-local.sh
            </code>
            ）を実行するか、手動で行を追加してください。
          </p>
          <div className="mt-6">
            <TextLink href="/">← Home</TextLink>
          </div>
        </Card>
      </Shell>,
      { title: "New project — Wana" }
    );
  }

  return c.render(
    <Shell title="New project" playgroundUrl={pg} auth="signed-in">
      <PageHeader
        title="New project"
        description="組織を選びプロジェクトを作成します。DSN の公開鍵はこの画面でのみ表示されます（DB にはハッシュのみ保存）。"
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
            label="Project ID（任意・DSN の公開鍵 URL に使われます。空なら自動採番）"
            name="projectId"
            mono
            placeholder="my-app-prod"
          />
          <p className="text-xs leading-relaxed text-kumo-subtle">
            Sentry のブラウザ SDK は、数字で始まりその後に英字などが続く ID（例:
            生の UUID）を先頭の数字だけに短縮します。英字・
            <code className="font-mono">_</code>
            で始めるか、数字のみにしてください。
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
  const pg = playgroundHref(c.env);
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
      <Shell title="Save your DSN" playgroundUrl={pg} auth="signed-in">
        <PageHeader
          title="すぐにコピーしてください"
          description={
            <>
              公開鍵（sentry_key）は再表示しません。ヒントとして保存するのは{" "}
              <span className="font-mono text-kumo-default">{result.hint}</span>{" "}
              のみです。
            </>
          }
        />

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="border-b border-kumo-hairline px-5 py-3 sm:px-6">
              <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
                Public key
              </div>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-kumo-default sm:p-6">
              {result.plainKey}
            </pre>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-kumo-hairline px-5 py-3 sm:px-6">
              <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
                DSN（ingest ホストを置換）
              </div>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-kumo-default sm:p-6">
              {dsn}
            </pre>
          </Card>

          <p className="text-xs text-kumo-subtle">
            Ingest の公開 URL はダッシュボードの{" "}
            <code className="rounded bg-kumo-base px-1 font-mono text-kumo-subtle">
              INGEST_PUBLIC_URL
            </code>{" "}
            （wrangler vars）で変えられます。
          </p>

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
      <Shell title="Error" playgroundUrl={pg} auth="signed-in">
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

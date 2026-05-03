import { Hono } from "hono";

import {
  createProjectWithApiKey,
  listOrganizationsForUser,
} from "../data/control-plane";
import { ingestPublicOrigin, dashboardUserId, playgroundHref } from "../lib/dashboard-user";
import {
  ButtonPrimary,
  Card,
  InputField,
  LinkPrimary,
  PageHeader,
  SelectField,
  TextLink,
} from "../ui/components";
import { Shell } from "../ui/shell";
import type { Env } from "../types/bindings";

/** Step 4.2: create project + issue DSN (public key shown once). */
export const projectSetupRoute = new Hono<{ Bindings: Env }>();

projectSetupRoute.get("/new", async (c) => {
  const uid = dashboardUserId(c.env);
  const orgs = await listOrganizationsForUser(c.env.DB_CONTROL, uid);
  const pg = playgroundHref(c.env);

  if (orgs.length === 0) {
    return c.render(
      <Shell title="New project" playgroundUrl={pg}>
        <Card class="p-8">
          <p class="text-sm leading-relaxed text-zinc-400">
            D1 に organization がありません。シード（
            <code class="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-sm text-zinc-300">
              scripts/setup-local.sh
            </code>
            ）を実行するか、手動で行を追加してください。
          </p>
          <div class="mt-6">
            <TextLink href="/">← Home</TextLink>
          </div>
        </Card>
      </Shell>
    );
  }

  return c.render(
    <Shell title="New project" playgroundUrl={pg}>
      <PageHeader
        title="New project"
        description="組織を選びプロジェクトを作成します。DSN の公開鍵はこの画面でのみ表示されます（DB にはハッシュのみ保存）。"
      />

      <Card class="max-w-lg p-6 sm:p-8">
        <form class="space-y-6" method="post" action="/projects/new">
          <SelectField label="Organization" name="orgId" required>
            {orgs.map((o) => (
              <option value={o.id}>
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
            label="Project ID（任意・DSN のパス末尾に使う。空なら wan_ + UUID）"
            name="projectId"
            mono
            placeholder="my-app-prod"
          />
          <p class="text-xs leading-relaxed text-zinc-500">
            Sentry のブラウザ SDK は、数字で始まりその後に英字などが続く ID（例: 生の
            UUID）を先頭の数字だけに短縮します。英字・<code class="font-mono">_</code>
            で始めるか、数字のみにしてください。
          </p>
          <div class="pt-2">
            <ButtonPrimary type="submit">Create project &amp; API key</ButtonPrimary>
          </div>
        </form>
      </Card>
    </Shell>
  );
});

projectSetupRoute.post("/new", async (c) => {
  const uid = dashboardUserId(c.env);
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
      <Shell title="Save your DSN" playgroundUrl={pg}>
        <PageHeader
          title="すぐにコピーしてください"
          description={
            <>
              公開鍵（sentry_key）は再表示しません。ヒントとして保存するのは{" "}
              <span class="font-mono text-zinc-300">{result.hint}</span>{" "}
              のみです。
            </>
          }
        />

        <div class="space-y-6">
          <Card class="overflow-hidden">
            <div class="border-b border-zinc-800/80 px-5 py-3 sm:px-6">
              <div class="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Public key
              </div>
            </div>
            <pre class="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-zinc-200 sm:p-6">
              {result.plainKey}
            </pre>
          </Card>

          <Card class="overflow-hidden">
            <div class="border-b border-zinc-800/80 px-5 py-3 sm:px-6">
              <div class="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                DSN（ingest ホストを置換）
              </div>
            </div>
            <pre class="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-zinc-200 sm:p-6">
              {dsn}
            </pre>
          </Card>

          <p class="text-xs text-zinc-500">
            Ingest の公開 URL はダッシュボードの{" "}
            <code class="rounded bg-zinc-800/80 px-1 font-mono text-zinc-400">
              INGEST_PUBLIC_URL
            </code>{" "}
           （wrangler vars）で変えられます。
          </p>

          <div class="flex flex-wrap items-center gap-4 pt-2">
            <LinkPrimary href={`/p/${result.projectId}`}>
              Open project →
            </LinkPrimary>
            <TextLink href="/">All projects</TextLink>
          </div>
        </div>
      </Shell>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "作成に失敗しました";
    return c.render(
      <Shell title="Error" playgroundUrl={pg}>
        <Card class="p-8">
          <p class="text-sm text-rose-400">{message}</p>
          <div class="mt-6">
            <TextLink href="/projects/new">← Back</TextLink>
          </div>
        </Card>
      </Shell>
    );
  }
});

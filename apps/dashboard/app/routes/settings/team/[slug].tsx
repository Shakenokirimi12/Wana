import { createRoute } from "honox/factory";

import {
  createOrganizationInvite,
  getOrgMembership,
  listOrganizationMembersWithProfiles,
  listPendingInvitesForOrg,
  orgRoleAtLeast,
  resolveOrganizationBySlug,
  revokeOrganizationInvite,
  updateOrganizationDisplayName,
  updateOrganizationSlugWithRedirect,
  setMemberRole,
  removeMember,
  transferOwnership,
  listAuditEventsForOrg,
} from "@/data/control-plane";
import { sendTransactionalEmail } from "@/lib/email";
import {
  getDashboardUserId,
  isDashboardDevFallback,
  playgroundHref,
} from "@/lib/dashboard-user";
import {
  Badge,
  ButtonDestructiveOutline,
  ButtonPrimary,
  ButtonSecondary,
  Card,
  InputField,
  PageHeader,
  SelectField,
  TextLink,
} from "@/ui/components";
import { Shell } from "@/ui/shell";

function roleBadgeVariant(role: string): "zinc" | "amber" {
  if (role === "owner") return "amber";
  return "zinc";
}

export default createRoute(async (c) => {
  const rawSlug = c.req.param("slug") ?? "";
  const userId = getDashboardUserId(c);
  const pg = playgroundHref(c.env);
  const qErr = c.req.query("e");
  const qOk = c.req.query("ok");

  if (!userId) {
    return c.redirect("/login");
  }

  const resolved = await resolveOrganizationBySlug(c.env.DB_CONTROL, rawSlug);

  if (!resolved) {
    return c.render(
      <Shell title="Team not found" playgroundUrl={pg} auth="signed-in">
        <PageHeader title="チームが見つかりません" description="" />
        <Card className="max-w-lg p-6">
          <p className="text-sm text-kumo-subtle">
            slug{" "}
            <span className="font-mono text-kumo-subtle">{rawSlug}</span>{" "}
            に一致する組織がありません。
          </p>
          <div className="mt-6">
            <TextLink href="/">← Projects</TextLink>
          </div>
        </Card>
      </Shell>,
      { title: "Not found — Wana" }
    );
  }

  if (resolved.slug !== rawSlug) {
    return c.redirect(`/settings/team/${encodeURIComponent(resolved.slug)}`, 301);
  }

  const role = await getOrgMembership(
    c.env.DB_CONTROL,
    userId,
    resolved.orgId
  );
  if (!role) {
    return c.render(
      <Shell title="Access denied" playgroundUrl={pg} auth="signed-in">
        <PageHeader
          title="このチームにアクセスできません"
          description="メンバーではありません。"
        />
        <Card className="max-w-lg p-6">
          <TextLink href="/">← Projects</TextLink>
        </Card>
      </Shell>,
      { title: "Access — Wana" }
    );
  }

  const canAdmin = orgRoleAtLeast(role, "admin");
  const members = await listOrganizationMembersWithProfiles(
    c.env.DB_CONTROL,
    resolved.orgId
  );
  const invites = canAdmin
    ? await listPendingInvitesForOrg(c.env.DB_CONTROL, resolved.orgId)
    : [];
  const auditLog = canAdmin
    ? await listAuditEventsForOrg(c.env.DB_CONTROL, resolved.orgId, 30)
    : [];
  const isOwner = role === "owner";
  const redirectBase = `/settings/team/${encodeURIComponent(resolved.slug)}`;

  return c.render(
    <Shell
      title={`Team ${resolved.slug}`}
      playgroundUrl={pg}
      auth="signed-in"
    >
      <PageHeader
        title={resolved.name}
        description={
          <>
            スラッグ{" "}
            <span className="font-mono text-kumo-subtle">{resolved.slug}</span>
            {" · "}
            あなたのロール: <Badge variant="zinc">{role}</Badge>
            {isDashboardDevFallback(c.env, c) ? (
              <span className="ml-2 text-xs text-kumo-subtle">
                （dev fallback 有効）
              </span>
            ) : null}
          </>
        }
      />

      {qErr ? (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          {qErr}
        </div>
      ) : null}
      {qOk === "1" ? (
        <div className="mb-6 rounded-lg border border-emerald-500/25 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          保存しました。
        </div>
      ) : null}

      {canAdmin ? (
        <div className="mb-8 grid gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
              チーム名・スラッグ
            </h2>
            <form
              method="post"
              action={`/settings/team/${encodeURIComponent(resolved.slug)}`}
              className="space-y-4"
            >
              <input type="hidden" name="action" value="update_team_profile" />
              <InputField
                label="表示名"
                name="team_name"
                required
                defaultValue={resolved.name}
              />
              <InputField
                label="URL スラッグ（変更すると旧スラッグはリダイレクトに記録されます）"
                name="team_slug"
                required
                mono
                defaultValue={resolved.slug}
              />
              <ButtonPrimary type="submit">保存</ButtonPrimary>
            </form>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
              招待を作成
            </h2>
            <form
              method="post"
              action={`/settings/team/${encodeURIComponent(resolved.slug)}`}
              className="space-y-4"
            >
              <input type="hidden" name="action" value="create_invite" />
              <SelectField
                label="付与ロール（最大 admin）"
                name="invite_role"
                required
                defaultValue="member"
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </SelectField>
              <InputField
                label="有効期限（時間・既定 24）"
                name="ttl_hours"
                type="number"
                placeholder="24"
              />
              <InputField
                label="最大利用回数（既定 1）"
                name="max_uses"
                type="number"
                placeholder="1"
              />
              <SelectField
                label="チャネル"
                name="invite_channel"
                required
                defaultValue="link"
              >
                <option value="link">リンク招待（誰でも／上限と期限で制御）</option>
                <option value="email">
                  メール宛招待（そのメールのアカウントのみ・送信を試行）
                </option>
              </SelectField>
              <InputField
                label="招待メールアドレス（チャネルがメールのとき）"
                name="invited_email"
                placeholder="colleague@example.com"
              />
              <p className="text-xs text-kumo-subtle">
                作成後、秘密トークン付き URL を一度だけ画面に表示します。メール送信は{" "}
                <code className="font-mono text-kumo-subtle">SEND_MAIL</code>{" "}
                設定時のみ。
              </p>
              <ButtonSecondary type="submit">招待を作成</ButtonSecondary>
            </form>
          </Card>
        </div>
      ) : null}

      <Card className="max-w-3xl overflow-hidden">
        <div className="border-b border-kumo-hairline px-5 py-3 sm:px-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
            メンバー
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-kumo-hairline text-xs text-kumo-subtle">
                <th className="px-5 py-3 font-medium sm:px-6">名前</th>
                <th className="px-3 py-3 font-medium">メール</th>
                <th className="px-3 py-3 font-medium">ユーザー名</th>
                <th className="px-5 py-3 font-medium sm:px-6">ロール</th>
                {canAdmin ? (
                  <th className="px-5 py-3 font-medium sm:px-6">操作</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="text-kumo-default">
              {members.map((m) => {
                const isSelf = m.userId === userId;
                const targetOwner = m.role === "owner";
                return (
                  <tr
                    key={m.userId}
                    className="border-b border-kumo-hairline last:border-0"
                  >
                    <td className="px-5 py-3 sm:px-6">
                      <span className="font-medium text-kumo-default">
                        {m.name}
                        {isSelf ? (
                          <span className="ml-1 text-xs text-kumo-subtle">
                            (you)
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-kumo-subtle">{m.email}</td>
                    <td className="px-3 py-3 font-mono text-xs text-kumo-subtle">
                      {m.username ?? "—"}
                    </td>
                    <td className="px-5 py-3 sm:px-6">
                      <Badge variant={roleBadgeVariant(m.role)}>{m.role}</Badge>
                    </td>
                    {canAdmin ? (
                      <td className="px-5 py-3 sm:px-6">
                        {targetOwner || isSelf ? (
                          <span className="text-xs text-kumo-subtle">—</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <form method="post" action={redirectBase} className="flex items-center gap-1">
                              <input type="hidden" name="action" value="set_member_role" />
                              <input type="hidden" name="target_user_id" value={m.userId} />
                              <select
                                name="role"
                                defaultValue={m.role}
                                className="h-8 rounded-md border border-kumo-hairline bg-kumo-base px-2 text-xs text-kumo-default"
                              >
                                <option value="member">member</option>
                                <option value="admin">admin</option>
                              </select>
                              <ButtonSecondary type="submit">変更</ButtonSecondary>
                            </form>
                            <form method="post" action={redirectBase}>
                              <input type="hidden" name="action" value="remove_member" />
                              <input type="hidden" name="target_user_id" value={m.userId} />
                              <ButtonDestructiveOutline type="submit">削除</ButtonDestructiveOutline>
                            </form>
                            {isOwner ? (
                              <form method="post" action={redirectBase}>
                                <input type="hidden" name="action" value="transfer_ownership" />
                                <input type="hidden" name="target_user_id" value={m.userId} />
                                <ButtonDestructiveOutline type="submit">
                                  オーナー移譲
                                </ButtonDestructiveOutline>
                              </form>
                            ) : null}
                          </div>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {canAdmin && invites.length > 0 ? (
        <Card className="mt-8 max-w-3xl overflow-hidden">
          <div className="border-b border-kumo-hairline px-5 py-3 sm:px-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
              未処理の招待
            </h2>
          </div>
          <ul className="divide-y divide-kumo-hairline">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="min-w-0 space-y-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="zinc">{inv.role}</Badge>
                    <span className="text-kumo-subtle">
                      {inv.useCount}/{inv.maxUses} 回 · 期限{" "}
                      {inv.expiresAt.toISOString().slice(0, 16).replace("T", " ")}{" "}
                      UTC
                    </span>
                  </div>
                  <p className="truncate text-xs text-kumo-subtle">
                    {inv.invitedEmail
                      ? `メール: ${inv.invitedEmail}`
                      : inv.invitedUsername
                        ? "リンク招待（レガシー・ユーザー名拘束は無効）"
                        : "リンク招待"}
                  </p>
                </div>
                <form
                  method="post"
                  action={`/settings/team/${encodeURIComponent(resolved.slug)}`}
                  className="shrink-0"
                >
                  <input type="hidden" name="action" value="revoke_invite" />
                  <input type="hidden" name="invite_id" value={inv.id} />
                  <ButtonDestructiveOutline type="submit">
                    取り消し
                  </ButtonDestructiveOutline>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {canAdmin && auditLog.length > 0 ? (
        <Card className="mt-8 max-w-3xl overflow-hidden">
          <div className="border-b border-kumo-hairline px-5 py-3 sm:px-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
              監査ログ（最近 30 件）
            </h2>
          </div>
          <ul className="divide-y divide-kumo-hairline text-sm">
            {auditLog.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 sm:px-6">
                <span className="font-mono text-[11px] tabular-nums text-kumo-subtle">
                  {a.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </span>
                <Badge variant="zinc">{a.action}</Badge>
                <span className="truncate font-mono text-xs text-kumo-subtle">
                  {a.payloadJson ?? ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="mt-8">
        <TextLink href="/">← Projects</TextLink>
      </p>
    </Shell>,
    { title: `${resolved.name} — Team` }
  );
});

export const POST = createRoute(async (c) => {
  const rawSlug = c.req.param("slug") ?? "";
  const userId = getDashboardUserId(c);
  const pg = playgroundHref(c.env);

  if (!userId) {
    return c.redirect("/login");
  }

  const resolved = await resolveOrganizationBySlug(c.env.DB_CONTROL, rawSlug);
  if (!resolved) {
    return c.text("Not found", 404);
  }

  const role = await getOrgMembership(
    c.env.DB_CONTROL,
    userId,
    resolved.orgId
  );
  if (!role || !orgRoleAtLeast(role, "admin")) {
    return c.text("Forbidden", 403);
  }

  const body = await c.req.parseBody();
  const action = String(body.action ?? "");

  const redirectBase = `/settings/team/${encodeURIComponent(resolved.slug)}`;

  if (action === "update_team_profile") {
    const name = String(body.team_name ?? "").trim();
    const slugInput = String(body.team_slug ?? "").trim();
    try {
      await updateOrganizationDisplayName(c.env.DB_CONTROL, {
        orgId: resolved.orgId,
        actingUserId: userId,
        name,
      });
      const slugResult = await updateOrganizationSlugWithRedirect(
        c.env.DB_CONTROL,
        {
          orgId: resolved.orgId,
          actingUserId: userId,
          newSlugRaw: slugInput,
        }
      );
      return c.redirect(
        `/settings/team/${encodeURIComponent(slugResult.slug)}?ok=1`,
        302
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "保存に失敗しました";
      return c.redirect(`${redirectBase}?e=${encodeURIComponent(msg)}`);
    }
  }

  if (action === "set_member_role") {
    const targetUserId = String(body.target_user_id ?? "");
    const newRole = body.role === "admin" ? "admin" : "member";
    try {
      await setMemberRole(c.env.DB_CONTROL, {
        orgId: resolved.orgId,
        actorUserId: userId,
        targetUserId,
        role: newRole,
      });
      return c.redirect(`${redirectBase}?ok=1`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "変更に失敗しました";
      return c.redirect(`${redirectBase}?e=${encodeURIComponent(msg)}`);
    }
  }

  if (action === "remove_member") {
    const targetUserId = String(body.target_user_id ?? "");
    try {
      await removeMember(c.env.DB_CONTROL, {
        orgId: resolved.orgId,
        actorUserId: userId,
        targetUserId,
      });
      return c.redirect(`${redirectBase}?ok=1`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "削除に失敗しました";
      return c.redirect(`${redirectBase}?e=${encodeURIComponent(msg)}`);
    }
  }

  if (action === "transfer_ownership") {
    const targetUserId = String(body.target_user_id ?? "");
    try {
      await transferOwnership(c.env.DB_CONTROL, {
        orgId: resolved.orgId,
        actorUserId: userId,
        targetUserId,
      });
      return c.redirect(`${redirectBase}?ok=1`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "移譲に失敗しました";
      return c.redirect(`${redirectBase}?e=${encodeURIComponent(msg)}`);
    }
  }

  if (action === "revoke_invite") {
    const inviteId = String(body.invite_id ?? "");
    try {
      await revokeOrganizationInvite(c.env.DB_CONTROL, {
        orgId: resolved.orgId,
        inviteId,
        actingUserId: userId,
      });
      return c.redirect(`${redirectBase}?ok=1`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "取り消しに失敗しました";
      return c.redirect(`${redirectBase}?e=${encodeURIComponent(msg)}`);
    }
  }

  if (action === "create_invite") {
    const inviteRole = body.invite_role === "admin" ? "admin" : "member";
    const maxUses = Number(body.max_uses) || 1;
    const ttlHours = Number(body.ttl_hours) || 24;
    const channel = String(body.invite_channel ?? "link");
    let invitedEmail: string | null = null;
    if (channel === "email") {
      invitedEmail = String(body.invited_email ?? "").trim() || null;
      if (!invitedEmail) {
        return c.redirect(
          `${redirectBase}?e=${encodeURIComponent("メールアドレスを入力してください")}`
        );
      }
    }

    try {
      const { plainToken } = await createOrganizationInvite(c.env.DB_CONTROL, {
        orgId: resolved.orgId,
        actingUserId: userId,
        role: inviteRole,
        maxUses,
        ttlHours,
        invitedEmail,
      });

      const origin = new URL(c.req.url).origin;
      const inviteUrl = `${origin}/invite/${encodeURIComponent(plainToken)}`;

      let emailNote: { ok: boolean; text: string } | null = null;
      if (channel === "email" && invitedEmail) {
        const res = await sendTransactionalEmail(c.env, {
          to: invitedEmail,
          subject: `${resolved.name} からの Wana 招待`,
          text: `次のリンクから参加できます（期限内・回数制限あり）:\n${inviteUrl}\n`,
        });
        emailNote = res.ok
          ? { ok: true, text: `${invitedEmail} 宛にメールを送信しました。` }
          : {
              ok: false,
              text: `メール送信は行われませんでした（${res.error ?? "未設定"}）。上の URL を手動で共有してください。`,
            };
      }

      return c.render(
        <Shell title="招待を作成しました" playgroundUrl={pg} auth="signed-in">
          <PageHeader
            title="招待 URL（この画面を離れると再表示できません）"
            description="リンクをコピーして共有してください。"
          />
          <Card className="max-w-3xl space-y-4 p-6">
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-kumo-hairline bg-kumo-recessed p-4 font-mono text-sm text-amber-100/90">
              {inviteUrl}
            </pre>
            {emailNote ? (
              <p
                className={`text-xs ${emailNote.ok ? "text-emerald-400" : "text-amber-400"}`}
              >
                {emailNote.text}
              </p>
            ) : null}
            <TextLink href={redirectBase}>← チーム設定へ</TextLink>
          </Card>
        </Shell>,
        { title: "Invite created — Wana" }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "作成に失敗しました";
      return c.redirect(`${redirectBase}?e=${encodeURIComponent(msg)}`);
    }
  }

  return c.redirect(redirectBase);
});

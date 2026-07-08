import { createRoute } from "honox/factory";

import {
  getUserDisplayById,
  updateUserDisplayName,
  listWebAuthnCredentialsForUser,
  deleteWebAuthnCredential,
} from "@/data/control-plane";
import { getDashboardUserId } from "@/lib/dashboard-user";
import { loadShellSidebar } from "@/lib/shell-data";
import {
  ButtonDestructiveOutline,
  ButtonPrimary,
  Card,
  InputField,
  PageHeader,
  TextLink,
} from "@/ui/components";
import { Shell } from "@/ui/shell";
import AddPasskey from "@/islands/add-passkey";

function shortCredId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
}

export default createRoute(async (c) => {
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");

  const user = await getUserDisplayById(c.env.DB_CONTROL, uid);
  if (!user) return c.redirect("/login");
  const passkeys = await listWebAuthnCredentialsForUser(c.env.DB_CONTROL, uid);
  const sidebar = await loadShellSidebar(c, uid);
  const err = c.req.query("e");
  const ok = c.req.query("ok");

  return c.render(
    <Shell
      currentPath={c.req.path}
      title="Account settings"
      auth="signed-in"
      {...sidebar}
    >
      <PageHeader
        title="アカウント設定"
        description="表示名とパスキー（ログイン用の認証器）を管理します。"
      />

      {err ? (
        <Card className="mb-6 p-4">
          <p className="text-sm text-rose-400">{err}</p>
        </Card>
      ) : null}
      {ok ? (
        <Card className="mb-6 p-4">
          <p className="text-sm text-emerald-400">保存しました。</p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
            プロフィール
          </h2>
          <form method="post" action="/settings/account" className="space-y-4">
            <input type="hidden" name="action" value="rename" />
            <InputField label="表示名" name="name" required defaultValue={user.name} />
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wider text-kumo-subtle">
                メールアドレス
              </p>
              <p className="font-mono text-sm text-kumo-default">{user.email}</p>
            </div>
            {user.username ? (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-kumo-subtle">
                  ユーザー名
                </p>
                <p className="font-mono text-sm text-kumo-default">{user.username}</p>
              </div>
            ) : null}
            <ButtonPrimary type="submit">保存</ButtonPrimary>
          </form>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
              パスキー（{passkeys.length}）
            </h2>
            <AddPasskey email={user.email} />
          </div>
          {passkeys.length === 0 ? (
            <p className="text-sm text-kumo-subtle">
              登録済みのパスキーがありません。
            </p>
          ) : (
            <ul className="divide-y divide-kumo-hairline">
              {passkeys.map((k) => (
                <li
                  key={k.credentialId}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <code className="font-mono text-xs text-kumo-default">
                      {shortCredId(k.credentialId)}
                    </code>
                    <p className="text-[11px] text-kumo-subtle">
                      登録 {k.createdAt.toISOString().slice(0, 10)}
                    </p>
                  </div>
                  <form method="post" action="/settings/account">
                    <input type="hidden" name="action" value="remove_passkey" />
                    <input type="hidden" name="credential_id" value={k.credentialId} />
                    <ButtonDestructiveOutline type="submit">
                      削除
                    </ButtonDestructiveOutline>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-kumo-subtle">
            最後のパスキーは削除できません（ロックアウト防止）。
          </p>
        </Card>
      </div>

      <div className="mt-8 flex items-center gap-6">
        <TextLink href="/">← Projects</TextLink>
        <a
          className="text-sm font-medium text-kumo-subtle hover:text-kumo-default"
          href="/logout"
        >
          サインアウト
        </a>
      </div>
    </Shell>,
    { title: "アカウント設定 — Wana" }
  );
});

export const POST = createRoute(async (c) => {
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");
  const body = await c.req.parseBody();
  const action = String(body.action ?? "");

  if (action === "rename") {
    try {
      await updateUserDisplayName(c.env.DB_CONTROL, uid, String(body.name ?? ""));
      return c.redirect("/settings/account?ok=1");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "保存に失敗しました";
      return c.redirect(`/settings/account?e=${encodeURIComponent(msg)}`);
    }
  }

  if (action === "remove_passkey") {
    try {
      await deleteWebAuthnCredential(
        c.env.DB_CONTROL,
        uid,
        String(body.credential_id ?? "")
      );
      return c.redirect("/settings/account?ok=1");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "削除に失敗しました";
      return c.redirect(`/settings/account?e=${encodeURIComponent(msg)}`);
    }
  }

  return c.redirect("/settings/account");
});

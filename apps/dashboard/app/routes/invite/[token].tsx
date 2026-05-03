import { createRoute } from "honox/factory";

import {
  acceptOrganizationInvite,
  getInviteDetailsForAccept,
  getUserIdentityForInvite,
} from "@/data/control-plane";
import {
  getDashboardUserId,
  playgroundHref,
} from "@/lib/dashboard-user";
import {
  ButtonPrimary,
  Card,
  LinkOutline,
  LinkPrimary,
  PageHeader,
  TextLink,
} from "@/ui/components";
import { Shell } from "@/ui/shell";

export default createRoute(async (c) => {
  const raw = c.req.param("token") ?? "";
  const pg = playgroundHref(c.env);
  const uid = getDashboardUserId(c);
  const qErr = c.req.query("e");

  const details = await getInviteDetailsForAccept(c.env.DB_CONTROL, raw);

  if (!details) {
    const loginNext = `/invite/${encodeURIComponent(raw)}`;
    return c.render(
      <Shell
        title="Invitation"
        playgroundUrl={pg}
        auth="signed-out"
        loginNext={loginNext}
      >
        <PageHeader
          title="無効な招待"
          description="リンクが期限切れか、既に失効しています。"
        />
        <Card className="max-w-lg p-6">
          <TextLink href="/login">Sign in</TextLink>
        </Card>
      </Shell>,
      { title: "Invitation — Wana" }
    );
  }

  const now = Date.now();
  const expired = details.expiresAt.getTime() <= now;
  const depleted = details.useCount >= details.maxUses;

  let eligibilityHint: string | null = null;
  if (uid && !expired && !depleted) {
    const identity = await getUserIdentityForInvite(c.env.DB_CONTROL, uid);
    if (details.invitedEmail && identity) {
      if (identity.email.toLowerCase() !== details.invitedEmail.toLowerCase()) {
        eligibilityHint =
          "ログイン中アカウントのメールアドレスが招待と一致しません。";
      }
    }
  }

  const loginNext = `/invite/${encodeURIComponent(raw)}`;

  return c.render(
    <Shell
      title="Invitation"
      playgroundUrl={pg}
      auth={uid ? "signed-in" : "signed-out"}
      loginNext={uid ? undefined : loginNext}
    >
      <PageHeader
        title={`${details.orgName} への招待`}
        description={
          <>
            ロール: <span className="text-zinc-300">{details.role}</span>
            {" · "}
            利用 {details.useCount}/{details.maxUses}
            {" · "}
            期限{" "}
            {details.expiresAt.toISOString().slice(0, 16).replace("T", " ")}{" "}
            UTC
          </>
        }
      />

      {qErr ? (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          {qErr}
        </div>
      ) : null}

      {expired || depleted ? (
        <Card className="max-w-lg p-6">
          <p className="text-sm text-zinc-400">
            {expired
              ? "この招待の有効期限が切れています。"
              : "この招待の利用回数が上限に達しています。"}
          </p>
        </Card>
      ) : !uid ? (
        <Card className="max-w-lg space-y-6 p-6">
          <p className="text-sm leading-relaxed text-zinc-400">
            参加するにはアカウントが必要です。既にアカウントがある場合はログインし、はじめての場合はこの招待から新規作成してください。
          </p>
          <div className="flex flex-col gap-3">
            <LinkPrimary
              href={`/login?next=${encodeURIComponent(loginNext)}`}
            >
              既存のアカウントでログイン
            </LinkPrimary>
            <LinkOutline
              href={`/signup?invite=${encodeURIComponent(raw)}`}
            >
              新規アカウントを作成
            </LinkOutline>
          </div>
          <p className="text-xs text-zinc-600">
            新規作成ではメール（招待で指定されている場合は固定）とパスキーを登録します。
          </p>
        </Card>
      ) : eligibilityHint ? (
        <Card className="max-w-lg space-y-4 p-6">
          <p className="text-sm text-amber-200/90">{eligibilityHint}</p>
          <TextLink href="/">← Home</TextLink>
        </Card>
      ) : (
        <Card className="max-w-lg space-y-6 p-6">
          <form method="post" action={`/invite/${encodeURIComponent(raw)}`}>
            <p className="mb-4 text-sm text-zinc-400">
              「参加する」でチームに追加されます。
            </p>
            <ButtonPrimary type="submit">このチームに参加する</ButtonPrimary>
          </form>
        </Card>
      )}
    </Shell>,
    { title: `Invite — ${details.orgName}` }
  );
});

export const POST = createRoute(async (c) => {
  const raw = c.req.param("token") ?? "";
  const uid = getDashboardUserId(c);
  if (!uid) {
    return c.redirect(
      `/login?next=${encodeURIComponent(`/invite/${encodeURIComponent(raw)}`)}`
    );
  }

  const result = await acceptOrganizationInvite(
    c.env.DB_CONTROL,
    raw,
    uid
  );

  if (!result.ok) {
    return c.redirect(
      `/invite/${encodeURIComponent(raw)}?e=${encodeURIComponent(result.reason)}`
    );
  }

  return c.redirect(
    `/team/switch?id=${encodeURIComponent(result.orgId)}&next=${encodeURIComponent("/?ok=1")}`
  );
});

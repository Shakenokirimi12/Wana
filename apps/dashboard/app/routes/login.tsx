import { createRoute } from "honox/factory";

import {
  getDashboardUserId,
  isOpenSignupEnabled,
  isWebAuthnEmailEnrollmentEnabled,
} from "@/lib/dashboard-user";
import { pendingInviteNextPath } from "@/lib/pending-invite";
import {
  ButtonPrimary,
  ButtonSecondary,
  Card,
  TextLink,
} from "@/ui/components";
import { WanaMark } from "@/ui/icons";
import { Shell } from "@/ui/shell";

function safeNextPath(raw: string | undefined): string | undefined {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) {
    return undefined;
  }
  return raw;
}

export default createRoute(async (c) => {
  const uid = getDashboardUserId(c);
  // Pending-invite cookie wins over the default landing when ?next= is
  // unset, so a user who clicked an invite email and then drifted into
  // /login still ends up on /invite/[token] after auth.
  const explicitNext = safeNextPath(c.req.query("next"));
  const fallbackNext = pendingInviteNextPath(c) ?? "/";
  const next = explicitNext ?? fallbackNext;
  if (uid) {
    return c.redirect(next);
  }
  const enrollment = isWebAuthnEmailEnrollmentEnabled(c.env);
  const nextAttr = next;

  return c.render(
    <Shell currentPath={c.req.path} title="Sign in" auth="hidden">
      {/* Auth pages center themselves; the bare hidden shell no longer
          imposes a max width so the marketing landing can go full-bleed. */}
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
      <div className="mb-8 flex flex-col items-center gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-zinc-900 shadow-lg shadow-amber-500/15">
          <WanaMark size={40} />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">
          Wana
        </h1>
      </div>

      <Card className="p-8 sm:p-10">
        <div
          id="passkey-login-root"
          className="flex flex-col gap-5"
          data-enrollment={enrollment ? "true" : "false"}
          data-next={nextAttr}
        >
          {enrollment ? (
            <div className="w-full space-y-2">
              <label className="block text-xs font-medium uppercase tracking-wider text-kumo-subtle">
                メールアドレス（パスキー登録のときだけ）
              </label>
              <input
                name="email"
                type="email"
                autoComplete="username webauthn"
                placeholder="you@example.com"
                className="w-full rounded-lg border border-kumo-hairline bg-kumo-recessed px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
              />
            </div>
          ) : null}

          <p
            data-passkey-status
            className="min-h-[1.25rem] text-center text-sm text-rose-400"
          />

          <div className="flex w-full flex-col gap-2">
            <ButtonPrimary
              type="button"
              data-action="passkey-login"
              className="w-full justify-center text-base"
            >
              パスキーでサインイン
            </ButtonPrimary>
            {enrollment ? (
              <ButtonSecondary
                type="button"
                data-action="passkey-register"
                className="w-full justify-center"
              >
                パスキーを登録（初回）
              </ButtonSecondary>
            ) : null}
          </div>
        </div>
        <script type="module" src="/static/passkey-login.js" />
      </Card>

      {isOpenSignupEnabled(c.env) ? (
        <p className="mt-6 text-center text-sm text-kumo-subtle">
          アカウントをお持ちでない方は{" "}
          <TextLink href="/signup">新規登録</TextLink>
        </p>
      ) : null}
      </div>
    </Shell>,
    { title: "Sign in — Wana" }
  );
});

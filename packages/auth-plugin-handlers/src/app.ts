import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { Hono } from "hono";

import {
  getUserByEmail,
  getUserById,
  getWebAuthnCredentialByCredentialId,
  insertWebAuthnCredential,
  inviteTokenAllowsWebAuthnRegistration,
  listWebAuthnCredentialIdsForUser,
  updateWebAuthnCredentialCounter,
} from "./db.js";
import type { AuthPluginEnv } from "./env.js";
import {
  isWebAuthnEmailEnrollmentEnabled,
  isOpenSignupEnabled,
  OPEN_SIGNUP_TOKEN,
} from "./env.js";
import {
  putWebAuthnChallenge,
  takeWebAuthnChallenge,
} from "./challenge-kv.js";
import { createDashboardSession, getSessionUserId } from "./session.js";
import {
  webauthnExpectedOrigins,
  webauthnExpectedRpIds,
  webauthnRpId,
  webauthnRpName,
} from "./webauthn-request.js";

function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/";
  }
  return raw;
}

export function createAuthPluginApp(): Hono<{ Bindings: AuthPluginEnv }> {
  const app = new Hono<{ Bindings: AuthPluginEnv }>();

  app.post("/api/webauthn/login/options", async (c) => {
    let body: { email?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const email = typeof body.email === "string" ? body.email : "";
    const user = await getUserByEmail(c.env.DB_CONTROL, email);
    // Anti-enumeration: "no such account" and "account without a passkey" return
    // an IDENTICAL response so a caller can't probe which emails are registered.
    // Always do the credential lookup (even for a missing user, against a throwaway
    // id) so the two paths take a similar amount of work.
    const credIds = user
      ? await listWebAuthnCredentialIdsForUser(c.env.DB_CONTROL, user.id)
      : [];
    if (!user || credIds.length === 0) {
      return c.json(
        {
          error: "login_unavailable",
          message:
            "このメールアドレスではサインインできません。パスキーが未登録の場合は「パスキーを登録」から登録してください。",
        },
        400
      );
    }
    const rpID = webauthnRpId(c.req.url, c.env);
    const options = await generateAuthenticationOptions({
      rpID,
      timeout: 60000,
      allowCredentials: credIds.map((id) => ({
        id,
        type: "public-key" as const,
      })),
      // Require user verification (PIN/biometric), not just presence, so a
      // stolen-but-locked authenticator cannot be used.
      userVerification: "required",
    });
    const challengeKey = crypto.randomUUID();
    await putWebAuthnChallenge(c.env.SYSTEM_CONFIG, challengeKey, {
      kind: "authentication",
      challenge: options.challenge,
      userId: user.id,
    });
    return c.json({ optionsJSON: options, challengeKey });
  });

  app.post("/api/webauthn/login/verify", async (c) => {
    let body: {
      challengeKey?: string;
      credential?: AuthenticationResponseJSON;
      next?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const challengeKey = typeof body.challengeKey === "string" ? body.challengeKey : "";
    const credential = body.credential;
    if (!challengeKey || !credential) {
      return c.json({ error: "invalid_body" }, 400);
    }

    const stored = await takeWebAuthnChallenge(c.env.SYSTEM_CONFIG, challengeKey);
    if (!stored || stored.kind !== "authentication") {
      return c.json({ error: "invalid_challenge" }, 400);
    }

    const row = await getWebAuthnCredentialByCredentialId(
      c.env.DB_CONTROL,
      credential.id
    );
    if (!row || row.userId !== stored.userId) {
      return c.json({ error: "credential_mismatch" }, 401);
    }

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: webauthnExpectedOrigins(c.req.url, c.env),
      expectedRPID: webauthnExpectedRpIds(c.req.url, c.env),
      credential: {
        id: row.credentialId,
        publicKey: isoBase64URL.toBuffer(row.publicKey, "base64url"),
        counter: row.counter,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      return c.json({ error: "verification_failed" }, 401);
    }

    await updateWebAuthnCredentialCounter(
      c.env.DB_CONTROL,
      verification.authenticationInfo.credentialID,
      verification.authenticationInfo.newCounter
    );

    await createDashboardSession(c, stored.userId);
    return c.json({ ok: true, next: safeNext(body.next) });
  });

  app.post("/api/webauthn/register/options", async (c) => {
    let body: { email?: string; inviteToken?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const email = typeof body.email === "string" ? body.email : "";
    const inviteToken =
      typeof body.inviteToken === "string" ? body.inviteToken.trim() : "";

    const enrollment = isWebAuthnEmailEnrollmentEnabled(c.env);
    const openSignup =
      inviteToken === OPEN_SIGNUP_TOKEN && isOpenSignupEnabled(c.env);
    const inviteOk =
      inviteToken.length > 0 &&
      inviteToken !== OPEN_SIGNUP_TOKEN &&
      (await inviteTokenAllowsWebAuthnRegistration(
        c.env.DB_CONTROL,
        inviteToken,
        email
      ));
    const sessionUserId = await getSessionUserId(c);
    const baseAllow = enrollment || inviteOk || openSignup;
    if (!baseAllow && !sessionUserId) {
      return c.json({ error: "enrollment_disabled" }, 403);
    }

    // Resolve the target account. When the ONLY authorization is the active
    // session (authed-self), derive the target purely from `sessionUserId` and
    // never trust the body `email` to pick a different account — a logged-in
    // user can only add a passkey to their OWN account.
    let user: { id: string; email: string; name: string } | null;
    if (!baseAllow && sessionUserId) {
      user = await getUserById(c.env.DB_CONTROL, sessionUserId);
      if (user && email && email.trim().toLowerCase() !== user.email.toLowerCase()) {
        return c.json({ error: "email_mismatch" }, 400);
      }
    } else {
      user = await getUserByEmail(c.env.DB_CONTROL, email);
    }
    if (!user) {
      return c.json({ error: "unknown_email" }, 404);
    }

    const authedSelf = !!sessionUserId && sessionUserId === user.id;
    if (!baseAllow && !authedSelf) {
      return c.json({ error: "enrollment_disabled" }, 403);
    }

    const rpID = webauthnRpId(c.req.url, c.env);
    const existing = await listWebAuthnCredentialIdsForUser(
      c.env.DB_CONTROL,
      user.id
    );
    // Open signup is first-passkey enrollment only — never add a credential to
    // an account that already has one via the open-signup token.
    if (openSignup && existing.length > 0) {
      return c.json({ error: "already_registered" }, 409);
    }

    const uidBuf = new TextEncoder().encode(user.id);
    const options = await generateRegistrationOptions({
      rpName: webauthnRpName(c.env),
      rpID,
      userID: uidBuf,
      userName: user.email,
      userDisplayName: user.name,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      excludeCredentials: existing.map((id) => ({
        id,
        type: "public-key" as const,
      })),
    });

    const challengeKey = crypto.randomUUID();
    await putWebAuthnChallenge(c.env.SYSTEM_CONFIG, challengeKey, {
      kind: "registration",
      challenge: options.challenge,
      userId: user.id,
    });

    return c.json({ optionsJSON: options, challengeKey });
  });

  app.post("/api/webauthn/register/verify", async (c) => {
    let body: {
      email?: string;
      challengeKey?: string;
      credential?: RegistrationResponseJSON;
      next?: string;
      inviteToken?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const challengeKey = typeof body.challengeKey === "string" ? body.challengeKey : "";
    const credential = body.credential;
    const email = typeof body.email === "string" ? body.email : "";
    const inviteToken =
      typeof body.inviteToken === "string" ? body.inviteToken.trim() : "";
    if (!challengeKey || !credential || !email) {
      return c.json({ error: "invalid_body" }, 400);
    }

    const enrollment = isWebAuthnEmailEnrollmentEnabled(c.env);
    const openSignup =
      inviteToken === OPEN_SIGNUP_TOKEN && isOpenSignupEnabled(c.env);
    const inviteOk =
      inviteToken.length > 0 &&
      inviteToken !== OPEN_SIGNUP_TOKEN &&
      (await inviteTokenAllowsWebAuthnRegistration(
        c.env.DB_CONTROL,
        inviteToken,
        email
      ));
    const sessionUserId = await getSessionUserId(c);
    const baseAllow = enrollment || inviteOk || openSignup;
    if (!baseAllow && !sessionUserId) {
      return c.json({ error: "enrollment_disabled" }, 403);
    }

    // Mirror register/options: in the authed-self path the target is the
    // session user, never the body email.
    let user: { id: string; email: string; name: string } | null;
    if (!baseAllow && sessionUserId) {
      user = await getUserById(c.env.DB_CONTROL, sessionUserId);
      if (user && email.trim().toLowerCase() !== user.email.toLowerCase()) {
        return c.json({ error: "email_mismatch" }, 400);
      }
    } else {
      user = await getUserByEmail(c.env.DB_CONTROL, email);
    }
    if (!user) {
      return c.json({ error: "unknown_email" }, 404);
    }

    const authedSelf = !!sessionUserId && sessionUserId === user.id;
    if (!baseAllow && !authedSelf) {
      return c.json({ error: "enrollment_disabled" }, 403);
    }

    if (openSignup) {
      const existingCreds = await listWebAuthnCredentialIdsForUser(
        c.env.DB_CONTROL,
        user.id
      );
      if (existingCreds.length > 0) {
        return c.json({ error: "already_registered" }, 409);
      }
    }

    const stored = await takeWebAuthnChallenge(c.env.SYSTEM_CONFIG, challengeKey);
    if (!stored || stored.kind !== "registration" || stored.userId !== user.id) {
      return c.json({ error: "invalid_challenge" }, 400);
    }

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: webauthnExpectedOrigins(c.req.url, c.env),
      expectedRPID: webauthnExpectedRpIds(c.req.url, c.env),
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: "verification_failed" }, 400);
    }

    const webauthnCred = verification.registrationInfo.credential;
    const publicKeyB64 = isoBase64URL.fromBuffer(webauthnCred.publicKey, "base64url");
    const transportsJson =
      webauthnCred.transports && webauthnCred.transports.length > 0
        ? JSON.stringify(webauthnCred.transports)
        : null;

    try {
      await insertWebAuthnCredential(c.env.DB_CONTROL, {
        userId: user.id,
        credentialId: webauthnCred.id,
        publicKeyBase64Url: publicKeyB64,
        counter: webauthnCred.counter,
        transportsJson,
      });
    } catch {
      return c.json({ error: "credential_exists" }, 409);
    }

    await createDashboardSession(c, user.id);

    const next =
      typeof body.next === "string" &&
      body.next.startsWith("/") &&
      !body.next.startsWith("//")
        ? body.next
        : "/";
    return c.json({ ok: true, next });
  });

  return app;
}

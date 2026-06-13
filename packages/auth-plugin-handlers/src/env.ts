/** Bindings required by the default WebAuthn auth plugin (subset of dashboard Env). */
export type AuthPluginEnv = {
  SYSTEM_CONFIG: KVNamespace;
  DB_CONTROL: D1Database;
  DASHBOARD_DEV_FALLBACK?: string;
  DASHBOARD_USER_ID?: string;
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_ORIGIN?: string;
  WEBAUTHN_RP_NAME?: string;
  WEBAUTHN_ALLOW_EMAIL_ENROLLMENT?: string;
  /** When "true", anyone may self-register an account (open signup). */
  ALLOW_OPEN_SIGNUP?: string;
  DASHBOARD_DISABLE_LOOPBACK_REDIRECT?: string;
};

export function isWebAuthnEmailEnrollmentEnabled(env: AuthPluginEnv): boolean {
  const v = env.WEBAUTHN_ALLOW_EMAIL_ENROLLMENT;
  return v === "true" || v === "1";
}

/** Open self-service signup (anyone can create an account). Default off. */
export function isOpenSignupEnabled(env: AuthPluginEnv): boolean {
  const v = env.ALLOW_OPEN_SIGNUP;
  return v === "true" || v === "1";
}

/** Sentinel token used by the open-signup flow (not a real invite). */
export const OPEN_SIGNUP_TOKEN = "open-signup";

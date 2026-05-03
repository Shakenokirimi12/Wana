const PREFIX = "wa:ch:";
const TTL_SEC = 300;

type ChallengeKv = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>;
  delete(key: string): Promise<void>;
};

export type AuthChallengePayload = {
  kind: "authentication";
  challenge: string;
  userId: string;
};

export type RegChallengePayload = {
  kind: "registration";
  challenge: string;
  userId: string;
};

export async function putWebAuthnChallenge(
  kv: ChallengeKv,
  key: string,
  payload: AuthChallengePayload | RegChallengePayload
): Promise<void> {
  await kv.put(`${PREFIX}${key}`, JSON.stringify(payload), {
    expirationTtl: TTL_SEC,
  });
}

export async function takeWebAuthnChallenge(
  kv: ChallengeKv,
  key: string
): Promise<AuthChallengePayload | RegChallengePayload | null> {
  const k = `${PREFIX}${key}`;
  const raw = await kv.get(k);
  if (!raw) {
    return null;
  }
  await kv.delete(k);
  try {
    return JSON.parse(raw) as AuthChallengePayload | RegChallengePayload;
  } catch {
    return null;
  }
}

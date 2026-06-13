/**
 * KEK-wrapped webhook signing secrets + HMAC body signing.
 *
 * Webhook receivers verify `X-Wana-Signature: t=<unix>, v1=<hex>` where
 * v1 = HMAC_SHA256(secret, t + "." + raw_body). The raw secret is hex-encoded
 * 32 random bytes; it is shown to the user exactly ONCE at creation and stored
 * encrypted at rest with AES-GCM using a Worker-secret KEK. A `kek_version`
 * column lets us rotate the KEK without re-keying every endpoint at once.
 */

const KEK_KEY_LEN_BYTES = 32; // AES-256
const NONCE_LEN_BYTES = 12;   // AES-GCM standard
const SECRET_LEN_BYTES = 32;  // 256 bits → 64 hex chars

function b64encode(buf: Uint8Array): string {
  let s = "";
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

function b64decode(s: string): ArrayBuffer {
  const bin = atob(s);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return buf;
}

function toAB(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.length);
  new Uint8Array(ab).set(u8);
  return ab;
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < arr.length; i++) {
    s += arr[i].toString(16).padStart(2, "0");
  }
  return s;
}

async function importKekFromBase64(kekB64: string): Promise<CryptoKey> {
  const raw = b64decode(kekB64);
  if (raw.byteLength !== KEK_KEY_LEN_BYTES) {
    throw new Error(
      `WEBHOOK_KEK must decode to ${KEK_KEY_LEN_BYTES} bytes, got ${raw.byteLength}`
    );
  }
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Generate a fresh hex-encoded webhook signing secret. Shown to user once. */
export function generateWebhookSecret(): string {
  const buf = new Uint8Array(SECRET_LEN_BYTES);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

/** Last 4 chars of the hex secret — surfaced in the UI so users recognise it later. */
export function webhookSecretHint(secretHex: string): string {
  return secretHex.length >= 4 ? secretHex.slice(-4) : secretHex;
}

export interface SealedSecret {
  secretEnc: string;     // base64 ciphertext+tag
  secretNonce: string;   // base64 12-byte nonce
  secretHint: string;    // last 4 chars
  kekVersion: number;
}

export async function sealWebhookSecret(
  kekB64: string,
  secretHex: string,
  kekVersion: number
): Promise<SealedSecret> {
  const key = await importKekFromBase64(kekB64);
  const nonceBytes = new Uint8Array(NONCE_LEN_BYTES);
  crypto.getRandomValues(nonceBytes);
  const nonce = toAB(nonceBytes);
  const plaintext = toAB(new TextEncoder().encode(secretHex));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    plaintext
  );
  return {
    secretEnc: b64encode(new Uint8Array(ct)),
    secretNonce: b64encode(nonceBytes),
    secretHint: webhookSecretHint(secretHex),
    kekVersion,
  };
}

export async function openWebhookSecret(
  kekB64: string,
  sealed: { secretEnc: string; secretNonce: string }
): Promise<string> {
  const key = await importKekFromBase64(kekB64);
  const nonce = b64decode(sealed.secretNonce);
  const ct = b64decode(sealed.secretEnc);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    ct
  );
  return new TextDecoder().decode(pt);
}

/** Hex HMAC-SHA256 of `t + "." + body`. */
export async function signWebhookBody(
  secretHex: string,
  body: string,
  unixTs: number
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toAB(new TextEncoder().encode(secretHex)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = toAB(new TextEncoder().encode(`${unixTs}.${body}`));
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return toHex(sig);
}

/** Build the `X-Wana-Signature` header value: `t=<unix>, v1=<hex>`. */
export function buildSignatureHeader(unixTs: number, hexSig: string): string {
  return `t=${unixTs}, v1=${hexSig}`;
}

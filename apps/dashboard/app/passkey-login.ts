/// <reference lib="dom" />
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { startAuthentication } from "@simplewebauthn/browser";
import { startRegistration } from "@simplewebauthn/browser";

function msg(el: HTMLElement | null, text: string): void {
  if (el) {
    el.textContent = text;
  }
}

function readRoot(): {
  root: HTMLElement;
  /**
   * Optional — login no longer asks for an email (we use the WebAuthn
   * discoverable-credential flow instead). Still present on signup flows
   * that explicitly want to bind the new passkey to a specific address.
   */
  emailInput: HTMLInputElement | null;
  statusEl: HTMLElement | null;
  enrollment: boolean;
  next: string;
} | null {
  const root = document.getElementById("passkey-login-root");
  if (!root) {
    return null;
  }
  const emailInput = root.querySelector<HTMLInputElement>('input[name="email"]');
  const statusEl = root.querySelector<HTMLElement>("[data-passkey-status]");
  const enrollment = root.dataset.enrollment === "true";
  const next = root.dataset.next?.trim() || "/";
  return { root, emailInput, statusEl, enrollment, next };
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; data: T; status: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T;
  return { ok: res.ok, data, status: res.status };
}

async function runLogin(
  email: string,
  next: string,
  statusEl: HTMLElement | null
): Promise<void> {
  msg(statusEl, "");
  // Empty `email` triggers the server's discoverable-credential branch.
  const opt = await postJson<{ optionsJSON: unknown; challengeKey: string } & {
    error?: string;
    message?: string;
  }>("/api/webauthn/login/options", email ? { email } : {});

  if (!opt.ok) {
    const err = opt.data as { error?: string; message?: string };
    msg(
      statusEl,
      err.message ??
        (err.error === "unknown_email"
          ? "そのメールアドレスのユーザーが見つかりません。"
          : err.error === "no_credentials"
            ? "このアカウントにパスキーが登録されていません。下の「パスキーを登録」から登録してください。"
            : "サインインの準備に失敗しました。")
    );
    return;
  }

  const { optionsJSON, challengeKey } = opt.data;
  let credential;
  try {
    credential = await startAuthentication({
      optionsJSON: optionsJSON as PublicKeyCredentialRequestOptionsJSON,
    });
  } catch (e) {
    msg(
      statusEl,
      e instanceof Error ? e.message : "パスキー操作がキャンセルされました。"
    );
    return;
  }

  const fin = await postJson<{ ok?: boolean; next?: string; error?: string }>(
    "/api/webauthn/login/verify",
    { challengeKey, credential, next }
  );
  if (!fin.ok) {
    msg(statusEl, "サインインの検証に失敗しました。");
    return;
  }
  const n = fin.data.next?.startsWith("/") ? fin.data.next : next;
  window.location.assign(n);
}

async function runRegister(
  email: string,
  next: string,
  statusEl: HTMLElement | null
): Promise<void> {
  msg(statusEl, "");
  const opt = await postJson<{ optionsJSON: unknown; challengeKey: string } & {
    error?: string;
  }>("/api/webauthn/register/options", { email });

  if (!opt.ok) {
    const err = opt.data as { error?: string };
    msg(
      statusEl,
      err.error === "unknown_email"
        ? "そのメールアドレスのユーザーが見つかりません。"
        : err.error === "enrollment_disabled"
          ? "パスキー登録は現在無効です。"
          : "登録の準備に失敗しました。"
    );
    return;
  }

  const { optionsJSON, challengeKey } = opt.data;
  let credential;
  try {
    credential = await startRegistration({
      optionsJSON: optionsJSON as PublicKeyCredentialCreationOptionsJSON,
    });
  } catch (e) {
    msg(
      statusEl,
      e instanceof Error ? e.message : "パスキー操作がキャンセルされました。"
    );
    return;
  }

  const fin = await postJson<{ ok?: boolean; next?: string }>(
    "/api/webauthn/register/verify",
    { email, challengeKey, credential, next }
  );
  if (!fin.ok) {
    msg(statusEl, "パスキー登録の検証に失敗しました。");
    return;
  }
  const n = fin.data.next?.startsWith("/") ? fin.data.next : next;
  window.location.assign(n);
}

function bind(): void {
  const ctx = readRoot();
  if (!ctx) {
    return;
  }
  const { emailInput, statusEl, enrollment, next } = ctx;

  const loginBtn = ctx.root.querySelector<HTMLButtonElement>(
    "[data-action='passkey-login']"
  );
  const regBtn = ctx.root.querySelector<HTMLButtonElement>(
    "[data-action='passkey-register']"
  );

  loginBtn?.addEventListener("click", async () => {
    // Email is optional on login — the empty case uses discoverable
    // credentials and the browser shows every passkey for this RP.
    const email = emailInput?.value.trim() ?? "";
    loginBtn.disabled = true;
    try {
      await runLogin(email, next, statusEl);
    } finally {
      loginBtn.disabled = false;
    }
  });

  if (enrollment && regBtn) {
    regBtn.addEventListener("click", async () => {
      const email = emailInput?.value.trim() ?? "";
      if (!email) {
        msg(statusEl, "メールアドレスを入力してください。");
        return;
      }
      regBtn.disabled = true;
      try {
        await runRegister(email, next, statusEl);
      } finally {
        regBtn.disabled = false;
      }
    });
  }
}

bind();

/// <reference lib="dom" />
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { startRegistration } from "@simplewebauthn/browser";

function msg(el: HTMLElement | null, text: string): void {
  if (el) {
    el.textContent = text;
  }
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

function readCtx(): {
  root: HTMLElement;
  token: string;
  emailLocked: boolean;
  emailInput: HTMLInputElement | null;
  statusEl: HTMLElement | null;
  next: string;
} | null {
  const root = document.getElementById("signup-invite-root");
  if (!root) {
    return null;
  }
  const token = root.dataset.token?.trim() ?? "";
  if (!token) {
    return null;
  }
  const emailLocked = root.dataset.emailLocked === "true";
  const emailInput = root.querySelector<HTMLInputElement>('input[name="email"]');
  const statusEl = root.querySelector<HTMLElement>("[data-signup-status]");
  const next = root.dataset.next?.trim() || "/";
  return { root, token, emailLocked, emailInput, statusEl, next };
}

async function run(): Promise<void> {
  const ctx = readCtx();
  if (!ctx) {
    return;
  }
  const { token, emailLocked, emailInput, statusEl, next } = ctx;

  const btn = ctx.root.querySelector<HTMLButtonElement>(
    "[data-action='signup-passkey']"
  );
  btn?.addEventListener("click", async () => {
    msg(statusEl, "");

    let emailForBootstrap: string | undefined;
    if (emailLocked) {
      emailForBootstrap = ctx.root.dataset.email?.trim();
    } else {
      emailForBootstrap = emailInput?.value.trim();
    }

    if (!emailLocked && !emailForBootstrap) {
      msg(statusEl, "メールアドレスを入力してください。");
      return;
    }

    btn.disabled = true;
    try {
      const boot = await postJson<{
        ok?: boolean;
        email?: string;
        created?: boolean;
        reason?: string;
      }>("/api/invite/bootstrap-user", {
        token,
        ...(emailLocked ? {} : { email: emailForBootstrap }),
      });

      if (!boot.ok) {
        msg(
          statusEl,
          boot.data.reason ?? "アカウント作成の準備に失敗しました。"
        );
        return;
      }

      const email = boot.data.email ?? emailForBootstrap;
      if (!email) {
        msg(statusEl, "メールアドレスを取得できませんでした。");
        return;
      }

      const opt = await postJson<
        { optionsJSON: unknown; challengeKey: string } & { error?: string }
      >("/api/webauthn/register/options", {
        email,
        inviteToken: token,
      });

      if (!opt.ok) {
        msg(statusEl, "パスキー登録の準備に失敗しました。");
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
        {
          email,
          challengeKey,
          credential,
          inviteToken: token,
          next,
        }
      );

      if (!fin.ok) {
        msg(statusEl, "パスキー登録の検証に失敗しました。");
        return;
      }
      const n = fin.data.next?.startsWith("/") ? fin.data.next : next;
      window.location.assign(n);
    } finally {
      btn.disabled = false;
    }
  });
}

run();

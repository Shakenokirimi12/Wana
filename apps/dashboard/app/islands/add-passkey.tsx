import { useState } from "react";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { startRegistration } from "@simplewebauthn/browser";

/**
 * Adds a new passkey to the logged-in user's own account (account settings).
 * The WebAuthn register handler authorizes this via the active session
 * (authed-self), so it works without the email-enrollment flag.
 */
export default function AddPasskey(props: { email: string }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    setStatus("");
    setBusy(true);
    try {
      const optRes = await fetch("/api/webauthn/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: props.email }),
      });
      const opt = (await optRes.json()) as {
        optionsJSON?: PublicKeyCredentialCreationOptionsJSON;
        challengeKey?: string;
        error?: string;
      };
      if (!optRes.ok || !opt.optionsJSON || !opt.challengeKey) {
        setStatus("パスキー登録の準備に失敗しました。");
        return;
      }
      let credential;
      try {
        credential = await startRegistration({ optionsJSON: opt.optionsJSON });
      } catch {
        setStatus("パスキー操作がキャンセルされました。");
        return;
      }
      const finRes = await fetch("/api/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: props.email,
          challengeKey: opt.challengeKey,
          credential,
          next: "/settings/account",
        }),
      });
      if (finRes.ok) {
        location.reload();
      } else {
        setStatus("パスキーの登録に失敗しました。");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={add}
        disabled={busy}
        className="inline-flex h-9 items-center rounded-lg border border-kumo-hairline bg-kumo-base px-3 text-sm font-medium text-kumo-default transition-colors hover:bg-kumo-recessed disabled:opacity-50"
      >
        ＋ パスキーを追加
      </button>
      {status ? <span className="text-xs text-rose-400">{status}</span> : null}
    </div>
  );
}

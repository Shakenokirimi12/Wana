import * as Sentry from "@sentry/browser";
import { makeDsn } from "@sentry/core";
import type { SeverityLevel } from "@sentry/core";

const dsnInput = document.querySelector<HTMLInputElement>("#dsn");
const envInput = document.querySelector<HTMLInputElement>("#env");
const releaseInput = document.querySelector<HTMLInputElement>("#release");
const msgInput = document.querySelector<HTMLInputElement>("#msg");
const logEl = document.querySelector<HTMLDivElement>("#log");
const burstInput = document.querySelector<HTMLInputElement>("#burst");

let initialized = false;

type LastAction =
  | { kind: "exception"; produce: () => Error }
  | { kind: "message"; text: string; level: SeverityLevel };

let lastAction: LastAction | null = null;

function log(line: string) {
  if (!logEl) return;
  logEl.textContent = `${new Date().toISOString()} ${line}\n${logEl.textContent ?? ""}`.slice(
    0,
    12000
  );
}

function normalizeDsn(raw: string): string {
  return raw
    .replace(/\u200b/g, "")
    .replace(/\ufeff/g, "")
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function customText(): string {
  return msgInput?.value.trim() || "Wana playground — custom text";
}

function ensureReady(): boolean {
  if (!initialized) {
    log("先に Initialize SDK を実行してください");
    return false;
  }
  return true;
}

async function flush(): Promise<void> {
  const ok = await Sentry.flush(4000);
  log(ok ? "flush OK" : "flush タイムアウト（Network を確認）");
}

// —— 各シナリオは別関数＝スタック先頭が異なり、別 Issue になる ——

function produceCheckoutError(): TypeError {
  return new TypeError("Cannot read properties of undefined (reading 'total')");
}

function produceAuthError(): Error {
  return new Error("Session expired — please sign in again");
}

function produceChunkError(): Error {
  return new Error(
    "Failed to fetch dynamically imported module: https://cdn.example.com/chunk-7.js"
  );
}

function producePolyfillError(): ReferenceError {
  return new ReferenceError("structuredClone is not defined");
}

function produceHydrationError(): Error {
  return new Error(
    "Hydration failed because the initial UI does not match what was rendered on the server."
  );
}

function sendException(produce: () => Error, label: string): void {
  if (!ensureReady()) return;
  const err = produce();
  const id = Sentry.captureException(err);
  lastAction = { kind: "exception", produce };
  log(`captureException (${label}) → ${id}`);
  void flush();
}

function sendMessage(text: string, level: SeverityLevel, label: string): void {
  if (!ensureReady()) return;
  const id = Sentry.captureMessage(text, level);
  lastAction = { kind: "message", text, level };
  log(`captureMessage (${label}, ${level}) → ${id}`);
  void flush();
}

function repeatLast(): void {
  if (!ensureReady() || !lastAction) {
    log("直近のシナリオがありません");
    return;
  }
  if (lastAction.kind === "exception") {
    const id = Sentry.captureException(lastAction.produce());
    log(`repeat captureException → ${id}`);
  } else {
    const id = Sentry.captureMessage(lastAction.text, lastAction.level);
    log(`repeat captureMessage → ${id}`);
  }
  void flush();
}

function burstLast(): void {
  if (!ensureReady() || !lastAction) {
    log("先にシナリオを 1 回送ってください");
    return;
  }
  const raw = burstInput?.value ?? "3";
  const n = Math.min(50, Math.max(1, parseInt(raw, 10) || 3));
  for (let i = 0; i < n; i++) {
    if (lastAction.kind === "exception") {
      Sentry.captureException(lastAction.produce());
    } else {
      Sentry.captureMessage(lastAction.text, lastAction.level);
    }
  }
  log(`burst ×${n}（同一 Issue にイベントが増える想定）`);
  void flush();
}

const defaultDsn = import.meta.env.VITE_DEFAULT_DSN?.trim();
if (defaultDsn && dsnInput && !dsnInput.value) {
  dsnInput.value = defaultDsn;
}

document.querySelector("#btn-init")?.addEventListener("click", async () => {
  const raw = dsnInput?.value ?? "";
  const dsn = normalizeDsn(raw);
  if (!dsn) {
    log("DSN が空です");
    return;
  }
  if (raw !== dsn) {
    log("DSN から空白・改行を取り除きました");
  }

  const parsed = makeDsn(dsn);
  if (!parsed) {
    log(
      "DSN をパースできません。形式は http(s)://公開鍵@ホスト:ポート/PROJECT_ID です。"
    );
    return;
  }

  await Sentry.close(2000);
  Sentry.init({
    dsn,
    release: releaseInput?.value.trim() || "wana-playground@1.0.0",
    environment: envInput?.value.trim() || "playground",
    tracesSampleRate: 0,
    beforeSend(event) {
      log(`beforeSend event_id=${event.event_id ?? "?"}`);
      return event;
    },
  });

  const client = Sentry.getClient();
  if (!client?.getDsn()) {
    log("初期化後も DSN がありません");
    return;
  }
  initialized = true;
  lastAction = null;
  log(
    `Sentry.init OK（env=${envInput?.value}, release=${releaseInput?.value}） — DevTools → Network で envelope を確認`
  );
});

document.querySelectorAll("[data-scenario]").forEach((el) => {
  el.addEventListener("click", () => {
    const id = el.getAttribute("data-scenario");
    switch (id) {
      case "checkout":
        sendException(produceCheckoutError, "checkout TypeError");
        break;
      case "auth":
        sendException(produceAuthError, "auth session");
        break;
      case "chunk":
        sendException(produceChunkError, "chunk load");
        break;
      case "polyfill":
        sendException(producePolyfillError, "polyfill ReferenceError");
        break;
      case "hydration":
        sendException(produceHydrationError, "hydration");
        break;
      case "custom-ex":
        sendException(() => new Error(customText()), "custom Error");
        break;
      case "msg-info":
        sendMessage(
          "Inventory cache warmed (playground)",
          "info",
          "cache info"
        );
        break;
      case "msg-warn":
        sendMessage(
          "Retrying payments API — attempt 2 (playground)",
          "warning",
          "retry warn"
        );
        break;
      case "msg-custom":
        sendMessage(customText(), "info", "custom message");
        break;
      default:
        log(`unknown scenario ${id}`);
    }
  });
});

document.querySelector("#btn-rich-checkout")?.addEventListener("click", () => {
  if (!ensureReady()) return;
  Sentry.withScope((scope) => {
    scope.setTag("feature", "checkout");
    scope.setTag("experiment", "promo_banner_v2");
    scope.setContext("order", { orderId: "ord_demo_123", currency: "JPY" });
    scope.setUser({
      id: "user_playground_01",
      email: "buyer@example.com",
    });
    scope.addBreadcrumb({
      category: "ui.click",
      message: "Pay button clicked",
      level: "info",
    });
    const err = produceCheckoutError();
    const eid = Sentry.captureException(err);
    log(`rich checkout captureException → ${eid}`);
    lastAction = { kind: "exception", produce: produceCheckoutError };
  });
  void flush();
});

document.querySelector("#btn-repeat")?.addEventListener("click", () => {
  repeatLast();
});

document.querySelector("#btn-burst")?.addEventListener("click", () => {
  burstLast();
});

document.querySelector("#btn-error")?.addEventListener("click", () => {
  sendException(() => new Error(customText()), "manual exception");
});

document.querySelector("#btn-message")?.addEventListener("click", () => {
  sendMessage(customText(), "info", "manual message");
});

log(
  "Ready. DSN → Initialize → シナリオで複数 Issue を試せます（同一ボタン連打で Event 増加）。"
);

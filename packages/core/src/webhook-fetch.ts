/**
 * Constrained outbound HTTP for webhook delivery.
 *
 * Cloudflare Workers cannot fetch RFC1918 from the public edge, so the IP
 * check below is mostly defense-in-depth — catching `localhost` literals in
 * the URL, IPv4-mapped IPv6, CG-NAT, and a few other footguns that the edge
 * does not necessarily block. The real protection is the protocol restriction
 * (https only) + manual redirect handling.
 */

export interface ValidatedTarget {
  url: string;
  host: string;
}

export interface FetchResult {
  status: number;
  ms: number;
  errorMessage?: string;
}

const PRIVATE_V4_PREFIXES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // 100.64.0.0/10 (CG-NAT)
  /^0\./,
  /^224\./,
  /^240\./,
  /^192\.0\.2\./,    // TEST-NET-1
  /^198\.51\.100\./, // TEST-NET-2
  /^203\.0\.113\./,  // TEST-NET-3
];

function isDangerousV4(ip: string): boolean {
  return PRIVATE_V4_PREFIXES.some((re) => re.test(ip));
}

function isDangerousV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;       // ULA
  if (lower.startsWith("fe80")) return true;                                // link-local
  // IPv4-mapped form ::ffff:127.0.0.1 etc — extract the trailing v4 and re-check.
  const m = lower.match(/^::ffff:([0-9.]+)$/);
  if (m) return isDangerousV4(m[1]);
  return false;
}

/**
 * Validate a webhook target URL: https only, well-formed, and the host
 * is not a literal private/loopback IP. Hostnames are resolved + checked
 * via `assertHostResolvesToPublic` at fetch time.
 */
export function validateWebhookUrl(input: string): ValidatedTarget {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new Error("URL の形式が不正です");
  }
  if (u.protocol !== "https:") {
    throw new Error("Webhook URL は https:// で始まる必要があります");
  }
  if (!u.hostname) {
    throw new Error("Webhook URL のホストが空です");
  }
  // Strip a trailing zone-id from IPv6 literals and reject dangerous shapes.
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host.toLowerCase() === "localhost") {
    throw new Error("localhost への配信は許可されていません");
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isDangerousV4(host)) {
      throw new Error("プライベート / ループバック IP への配信は許可されていません");
    }
  } else if (host.includes(":")) {
    if (isDangerousV6(host)) {
      throw new Error("プライベート / ループバック IPv6 への配信は許可されていません");
    }
  }
  return { url: u.toString(), host };
}

/**
 * Resolve a hostname via Cloudflare DNS-over-HTTPS and refuse if any returned
 * IP is in a private/loopback/CG-NAT/TEST-NET range. Defense in depth on top
 * of the platform's own private-IP block.
 */
async function assertHostResolvesToPublic(host: string): Promise<void> {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    // Literal IP — already validated by validateWebhookUrl.
    return;
  }
  for (const t of ["A", "AAAA"] as const) {
    const r = await fetch(
      `https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=${t}`,
      { headers: { Accept: "application/dns-json" } }
    );
    if (!r.ok) continue;
    const j = (await r.json()) as { Answer?: { type: number; data: string }[] };
    for (const a of j.Answer ?? []) {
      const data = a.data;
      if (t === "A" && isDangerousV4(data)) {
        throw new Error(`ホスト ${host} のIPがプライベート / ループバック / 予約範囲です`);
      }
      if (t === "AAAA" && isDangerousV6(data)) {
        throw new Error(`ホスト ${host} のIPv6 がプライベート / ループバック範囲です`);
      }
    }
  }
}

/**
 * Send a signed webhook. Validates target, resolves DNS, fetches with manual
 * redirects (re-resolved each hop), 8s timeout, max 64 KB response. Throws
 * on a hard error; returns the {status, ms} for delivery records.
 */
export async function deliverWebhook(opts: {
  url: string;
  body: string;
  signatureHeader: string;
  userAgent: string;
  timeoutMs?: number;
  maxRedirects?: number;
}): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const maxRedirects = opts.maxRedirects ?? 3;
  const started = Date.now();

  let currentUrl = opts.url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const target = validateWebhookUrl(currentUrl);
    await assertHostResolvesToPublic(target.host);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(target.url, {
        method: "POST",
        body: opts.body,
        redirect: "manual",
        signal: ac.signal,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": opts.userAgent,
          "X-Wana-Signature": opts.signatureHeader,
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const ms = Date.now() - started;
      return { status: 0, ms, errorMessage: err instanceof Error ? err.message : "fetch failed" };
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) {
        return { status: res.status, ms: Date.now() - started };
      }
      if (hop === maxRedirects) {
        return {
          status: res.status,
          ms: Date.now() - started,
          errorMessage: "リダイレクト回数が上限を超えました",
        };
      }
      currentUrl = new URL(loc, target.url).toString();
      continue;
    }
    return { status: res.status, ms: Date.now() - started };
  }
  return {
    status: 0,
    ms: Date.now() - started,
    errorMessage: "リダイレクト回数が上限を超えました",
  };
}

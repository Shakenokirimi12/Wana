/**
 * Invite-email content. Returns both plain-text and HTML versions of the
 * same message so the recipient's mail client picks whichever it can
 * render. Styling is inline + table-based so it survives Gmail / Outlook
 * stripping, with no external resources (no CSS link, no image hosting).
 */

export type InviteEmailInput = {
  teamName: string;
  inviterDisplayName: string | null;
  inviterEmail: string | null;
  role: "member" | "admin";
  inviteUrl: string;
  expiresAt: Date;
  maxUses: number;
};

const ROLE_LABEL: Record<"member" | "admin", string> = {
  member: "メンバー",
  admin: "管理者",
};

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatExpiry(d: Date): string {
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

export function buildInviteEmail(input: InviteEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const inviterLine = input.inviterDisplayName
    ? `${input.inviterDisplayName}${input.inviterEmail ? `（${input.inviterEmail}）` : ""}`
    : input.inviterEmail ?? "管理者";
  const role = ROLE_LABEL[input.role];
  const expiry = formatExpiry(input.expiresAt);
  const usesLine =
    input.maxUses === 1
      ? "このリンクは 1 回だけ使用できます。"
      : `このリンクは最大 ${input.maxUses} 回まで使用できます。`;

  const subject = `${input.teamName} から Wana への招待`;

  const text =
    `こんにちは。\n` +
    `\n` +
    `${inviterLine} から、Wana のチーム「${input.teamName}」への参加を招待されました。\n` +
    `（Wana は Cloudflare 上で動く軽量なエラートラッキングサービスです。）\n` +
    `\n` +
    `付与されるロール: ${role}\n` +
    `\n` +
    `下記の URL を開いて参加してください。\n` +
    `${input.inviteUrl}\n` +
    `\n` +
    `${usesLine}\n` +
    `有効期限: ${expiry}\n` +
    `\n` +
    `心当たりがない場合は、このメールを破棄して問題ありません。\n` +
    `\n` +
    `— Wana\n` +
    `   https://wana.shakenokiri.me\n`;

  // Inline-styled, single-column, mobile-friendly HTML. Amber accent matches
  // the in-app brand. No images, no external CSS — Gmail strips both.
  const html =
    `<!doctype html>\n` +
    `<html lang="ja">\n` +
    `<head>\n` +
    `<meta charset="utf-8" />\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
    `<title>${escHtml(subject)}</title>\n` +
    `</head>\n` +
    `<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans','Noto Sans JP',sans-serif;color:#18181b;">\n` +
    `  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;">\n` +
    `    <tr>\n` +
    `      <td align="center" style="padding:32px 16px;">\n` +
    `        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;overflow:hidden;">\n` +
    `          <tr>\n` +
    `            <td style="padding:32px 32px 16px 32px;">\n` +
    `              <table role="presentation" cellpadding="0" cellspacing="0" border="0">\n` +
    `                <tr>\n` +
    `                  <td style="background:#18181b;width:36px;height:36px;border-radius:8px;text-align:center;vertical-align:middle;line-height:0;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M4 10 C 8 4 16 4 20 10" stroke="#f4f4f5" stroke-width="2.5"/>` +
    `<path d="M4 14 L 8 18 L 12 14 L 16 18 L 20 14" stroke="#a1a1aa" stroke-width="2.5"/>` +
    `<circle cx="15" cy="10" r="2" fill="#f59e0b"/>` +
    `</svg>` +
    `</td>\n` +
    `                  <td style="padding-left:12px;font-weight:600;font-size:16px;color:#18181b;">Wana</td>\n` +
    `                </tr>\n` +
    `              </table>\n` +
    `            </td>\n` +
    `          </tr>\n` +
    `          <tr>\n` +
    `            <td style="padding:0 32px 8px 32px;">\n` +
    `              <h1 style="margin:0;font-size:22px;line-height:1.4;color:#18181b;font-weight:600;">${escHtml(
              input.teamName
            )} への招待が届きました</h1>\n` +
    `            </td>\n` +
    `          </tr>\n` +
    `          <tr>\n` +
    `            <td style="padding:8px 32px 24px 32px;color:#52525b;font-size:14px;line-height:1.7;">\n` +
    `              <p style="margin:0 0 16px 0;">こんにちは。<br/>${escHtml(
              inviterLine
            )} から、Wana のチーム「<strong style="color:#18181b;">${escHtml(
      input.teamName
    )}</strong>」への参加を招待されました。</p>\n` +
    `              <p style="margin:0 0 16px 0;">Wana は Cloudflare 上で動く軽量なエラートラッキングサービスです。下のボタンから参加して、ダッシュボードで Issue やイベントを確認できます。</p>\n` +
    `            </td>\n` +
    `          </tr>\n` +
    `          <tr>\n` +
    `            <td style="padding:0 32px 8px 32px;">\n` +
    `              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">\n` +
    `                <tr>\n` +
    `                  <td style="font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:4px;">付与されるロール</td>\n` +
    `                </tr>\n` +
    `                <tr>\n` +
    `                  <td style="font-size:15px;font-weight:600;color:#18181b;padding-bottom:20px;">${escHtml(
              role
            )}</td>\n` +
    `                </tr>\n` +
    `              </table>\n` +
    `            </td>\n` +
    `          </tr>\n` +
    `          <tr>\n` +
    `            <td align="center" style="padding:0 32px 28px 32px;">\n` +
    `              <table role="presentation" cellpadding="0" cellspacing="0" border="0">\n` +
    `                <tr>\n` +
    `                  <td style="background:#f59e0b;border-radius:8px;">\n` +
    `                    <a href="${escHtml(
                      input.inviteUrl
                    )}" style="display:inline-block;padding:12px 28px;font-weight:600;font-size:15px;color:#09090b;text-decoration:none;">チームに参加する →</a>\n` +
    `                  </td>\n` +
    `                </tr>\n` +
    `              </table>\n` +
    `            </td>\n` +
    `          </tr>\n` +
    `          <tr>\n` +
    `            <td style="padding:0 32px 24px 32px;color:#71717a;font-size:12px;line-height:1.6;">\n` +
    `              <p style="margin:0 0 8px 0;">ボタンが動かない場合は、次の URL をブラウザに貼り付けてください:</p>\n` +
    `              <p style="margin:0 0 16px 0;word-break:break-all;"><a href="${escHtml(
              input.inviteUrl
            )}" style="color:#b45309;text-decoration:underline;">${escHtml(
      input.inviteUrl
    )}</a></p>\n` +
    `              <p style="margin:0 0 4px 0;">${escHtml(usesLine)}</p>\n` +
    `              <p style="margin:0;">有効期限: <strong style="color:#52525b;">${escHtml(
              expiry
            )}</strong></p>\n` +
    `            </td>\n` +
    `          </tr>\n` +
    `          <tr>\n` +
    `            <td style="border-top:1px solid #e4e4e7;padding:18px 32px;color:#a1a1aa;font-size:11px;line-height:1.6;">\n` +
    `              心当たりがない場合は、このメールを破棄して問題ありません。<br/>\n` +
    `              Wana · <a href="https://wana.shakenokiri.me" style="color:#a1a1aa;text-decoration:underline;">wana.shakenokiri.me</a>\n` +
    `            </td>\n` +
    `          </tr>\n` +
    `        </table>\n` +
    `      </td>\n` +
    `    </tr>\n` +
    `  </table>\n` +
    `</body>\n` +
    `</html>\n`;

  return { subject, text, html };
}

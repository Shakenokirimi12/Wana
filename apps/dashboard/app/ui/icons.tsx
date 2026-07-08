import type { SVGProps } from "react";

/**
 * Inline Lucide icons. Bundling lucide-react would pull in a whole tree of
 * helper code for a handful of icons — the four paths we actually need
 * survive as plain SVG attrs and respect `currentColor`, so the parent's
 * text color drives the stroke (matching Tailwind's `text-*` utilities).
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function baseProps(size = 18) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

/** Lucide `slack` — the brand's four crossing pills. */
export function SlackIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size)} {...rest}>
      <rect width="3" height="8" x="13" y="2" rx="1.5" />
      <path d="M19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5" />
      <rect width="3" height="8" x="8" y="14" rx="1.5" />
      <path d="M5 15.5V14H3.5A1.5 1.5 0 1 0 5 15.5" />
      <rect width="8" height="3" x="14" y="13" rx="1.5" />
      <path d="M15.5 19H14v1.5a1.5 1.5 0 1 0 1.5-1.5" />
      <rect width="8" height="3" x="2" y="8" rx="1.5" />
      <path d="M8.5 5H10V3.5A1.5 1.5 0 1 0 8.5 5" />
    </svg>
  );
}

/** Lucide `mail` — classic envelope outline. */
export function MailIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size)} {...rest}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

/**
 * Lucide `message-circle`. Used in place of Discord — Lucide doesn't ship a
 * Discord brand mark, and the chat-bubble glyph is the closest universally
 * understood "messaging platform" icon.
 */
export function DiscordIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size)} {...rest}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

/**
 * Wana brand mark. The upper arch + lower zig-zag together read as an eye
 * with W-shaped lower lashes — the W is also a trap / snare jaw, and the
 * amber pupil is the caught error. Fixed colors (zinc-100 + zinc-400 +
 * amber-500) on a dark plate, so wrap with a `bg-zinc-900` (or similar)
 * container for contrast.
 */
export function WanaMark({ size, ...rest }: IconProps) {
  const px = size ?? 24;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path
        d="M4 10 C 8 4 16 4 20 10"
        stroke="#f4f4f5"
        strokeWidth="2.5"
      />
      <path
        d="M4 14 L 8 18 L 12 14 L 16 18 L 20 14"
        stroke="#a1a1aa"
        strokeWidth="2.5"
      />
      <circle cx="15" cy="10" r="2" fill="#f59e0b" stroke="none" />
    </svg>
  );
}

/** Lucide `user`. Used for the assignee chip on issue rows / detail. */
export function UserIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size)} {...rest}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/** Lucide `fingerprint`. Used for passkey sign-in affordance. */
export function FingerprintIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size)} {...rest}>
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
      <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
      <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
      <path d="M2 12a10 10 0 0 1 18-6" />
      <path d="M2 16h.01" />
      <path d="M21.8 16c.2-2 .131-5.354 0-6" />
      <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
      <path d="M8.65 22c.21-.66.45-1.32.57-2" />
      <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
    </svg>
  );
}

/** Lucide `plus`. Add-new affordance. */
export function PlusIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size)} {...rest}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

/** Lucide `webhook` — three-lobed flow glyph. */
export function WebhookIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size)} {...rest}>
      <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" />
      <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" />
      <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" />
    </svg>
  );
}

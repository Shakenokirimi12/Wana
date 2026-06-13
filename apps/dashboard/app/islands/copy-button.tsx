import { useState } from "react";

/**
 * Small copy-to-clipboard control (island). Renders a button that copies
 * `value` and briefly shows a "Copied" state. SSR-renders a plain button;
 * the click handler activates on hydration.
 */
export default function CopyButton(props: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable (insecure context) — no-op
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={props.label ?? "コピー"}
      className={`inline-flex h-8 shrink-0 items-center rounded-md border px-3 text-xs font-medium transition-colors ${
        copied
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          : "border-kumo-hairline bg-kumo-base text-kumo-default hover:bg-kumo-recessed"
      }`}
    >
      {copied ? "コピーしました" : "コピー"}
    </button>
  );
}

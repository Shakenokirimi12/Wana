import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { IssueStatus } from "@wana/types";

/**
 * 公式 Shadcn/ui は React + Radix 前提のため、この SSR アプリには未導入。
 * フォーカスリング・半径・バリアントは shadcn (zinc dark) に寄せた実装。
 */
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const primaryBtn = `inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-amber-500 px-4 text-sm font-semibold text-zinc-950 shadow-sm transition-colors hover:bg-amber-400 ${focusRing} disabled:pointer-events-none disabled:opacity-50`;

const secondaryBtn = `inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-zinc-600 bg-zinc-800/80 px-4 text-sm font-medium text-zinc-100 shadow-sm transition-colors hover:bg-zinc-700/90 ${focusRing} disabled:pointer-events-none disabled:opacity-50`;

const ghostBtn = `inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-zinc-700/80 bg-zinc-900/30 px-4 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800/50 hover:text-zinc-50 ${focusRing}`;

const textLink =
  "text-sm font-medium text-amber-500 transition-colors hover:text-amber-400";

const outlineBtn = `inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-zinc-600 bg-transparent px-4 text-sm font-medium text-zinc-200 shadow-sm transition-colors hover:border-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-50 ${focusRing} disabled:pointer-events-none disabled:opacity-50`;

const successBtn = `inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 ${focusRing} disabled:pointer-events-none disabled:opacity-50`;

const destructiveOutlineBtn = `inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-rose-500/55 bg-transparent px-4 text-sm font-medium text-rose-300 shadow-sm transition-colors hover:bg-rose-500/10 hover:text-rose-200 ${focusRing} disabled:pointer-events-none disabled:opacity-50`;

export function ButtonOutline(props: {
  type?: "submit" | "button";
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const extra = props.className ?? "";
  return (
    <button
      className={`${outlineBtn} ${extra}`}
      disabled={props.disabled}
      type={props.type ?? "button"}
    >
      {props.children}
    </button>
  );
}

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> & { className?: string };

export function ButtonSecondary(props: NativeButtonProps & { children: ReactNode }) {
  const { className: cn, children, type = "button", ...rest } = props;
  const extra = cn ?? "";
  return (
    <button
      className={`${secondaryBtn} ${extra}`}
      type={type}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ButtonSuccess(props: {
  type?: "submit" | "button";
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const extra = props.className ?? "";
  return (
    <button
      className={`${successBtn} ${extra}`}
      disabled={props.disabled}
      type={props.type ?? "button"}
    >
      {props.children}
    </button>
  );
}

export function ButtonDestructiveOutline(props: {
  type?: "submit" | "button";
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const extra = props.className ?? "";
  return (
    <button
      className={`${destructiveOutlineBtn} ${extra}`}
      disabled={props.disabled}
      type={props.type ?? "button"}
    >
      {props.children}
    </button>
  );
}

export function LinkPrimary(props: { href: string; children: ReactNode }) {
  return (
    <a className={primaryBtn} href={props.href}>
      {props.children}
    </a>
  );
}

export function LinkOutline(props: { href: string; children: ReactNode }) {
  return (
    <a className={outlineBtn} href={props.href}>
      {props.children}
    </a>
  );
}

export function ButtonPrimary(props: NativeButtonProps & { children: ReactNode }) {
  const { className: cn, children, type = "button", ...rest } = props;
  const extra = cn ?? "";
  return (
    <button className={`${primaryBtn} ${extra}`} type={type} {...rest}>
      {children}
    </button>
  );
}

export function LinkGhost(props: { href: string; children: ReactNode }) {
  return (
    <a className={ghostBtn} href={props.href}>
      {props.children}
    </a>
  );
}

export function TextLink(props: { href: string; children: ReactNode }) {
  return (
    <a className={textLink} href={props.href}>
      {props.children}
    </a>
  );
}

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader(props: PageHeaderProps) {
  return (
    <div className="mb-10 flex flex-col gap-8 sm:mb-12 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
          {props.title}
        </h1>
        {props.description ? (
          <div className="text-sm leading-relaxed text-zinc-400 sm:text-base">
            {props.description}
          </div>
        ) : null}
      </div>
      {props.actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {props.actions}
        </div>
      ) : null}
    </div>
  );
}

export function Card(props: { children: ReactNode; className?: string }) {
  const extra = props.className ?? "";
  return (
    <div
      className={`rounded-[var(--radius-lg)] border border-zinc-800/80 bg-zinc-900/40 shadow-[var(--shadow-wana-glow)] backdrop-blur-sm ${extra}`}
    >
      {props.children}
    </div>
  );
}

type BadgeVariant = "default" | "amber" | "emerald" | "zinc" | "rose";

const badgeStyles: Record<BadgeVariant, string> = {
  default: "border-zinc-700/80 bg-zinc-800/60 text-zinc-300",
  amber: "border-amber-500/25 bg-amber-500/10 text-amber-400",
  emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
  zinc: "border-zinc-600/80 bg-zinc-800/40 text-zinc-400",
  rose: "border-rose-500/25 bg-rose-500/10 text-rose-400",
};

export function Badge(props: { variant?: BadgeVariant; children: ReactNode }) {
  const v = props.variant ?? "default";
  const styles = badgeStyles[v];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums ${styles}`}
    >
      {props.children}
    </span>
  );
}

export function issueStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "unresolved":
      return "amber";
    case "resolved":
      return "emerald";
    case "ignored":
      return "zinc";
    default:
      return "default";
  }
}

/**
 * Issue 詳細用: 現在ステータスをリングで強調し、Ignore / Resolve は色分け。
 */
export function IssueStatusToolbar(props: {
  action: string;
  status: IssueStatus;
}) {
  const { action, status } = props;

  const activeShell =
    "shadow-md ring-2 ring-offset-2 ring-offset-zinc-950 cursor-default font-semibold";
  const activeUnresolved = `${activeShell} border-amber-500/70 bg-amber-500/15 text-amber-200 ring-amber-500/50`;
  const activeResolved = `${activeShell} border-emerald-600/70 bg-emerald-500/12 text-emerald-200 ring-emerald-500/45`;
  const activeIgnored = `${activeShell} border-zinc-500/70 bg-zinc-700/35 text-zinc-200 ring-zinc-500/40`;

  const idleBase = `rounded-[var(--radius-md)] border px-4 py-2 text-sm font-medium transition-colors ${focusRing}`;

  type Opt = {
    value: IssueStatus;
    label: string;
    sub: string;
    activeClass: string;
    idleClass: string;
  };

  const opts: Opt[] = [
    {
      value: "unresolved",
      label: "Unresolved",
      sub: "調査中・再オープン",
      activeClass: activeUnresolved,
      idleClass:
        "border-zinc-600/80 bg-zinc-900/40 text-zinc-200 hover:border-amber-500/35 hover:bg-amber-500/5 hover:text-amber-100",
    },
    {
      value: "resolved",
      label: "Resolve",
      sub: "対応完了として閉じる",
      activeClass: activeResolved,
      idleClass:
        "border-emerald-700/50 bg-emerald-950/25 text-emerald-100 hover:border-emerald-500/55 hover:bg-emerald-500/10",
    },
    {
      value: "ignored",
      label: "Ignore",
      sub: "通知を抑止",
      activeClass: activeIgnored,
      idleClass:
        "border-rose-500/35 bg-rose-950/15 text-rose-100 hover:border-rose-400/50 hover:bg-rose-500/10",
    },
  ];

  return (
    <div
      className="flex flex-col gap-3"
      role="group"
      aria-label="Issue status actions"
    >
      <p className="text-xs leading-relaxed text-zinc-500">
        現在の状態は<strong className="text-zinc-400">リング付きのボタン</strong>
        です。他のボタンで切り替えられます。
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch">
        {opts.map((o) => {
          const isCurrent = status === o.value;
          return (
            <form
              className="min-w-0 flex-1 sm:flex-none"
              method="post"
              action={action}
              key={o.value}
            >
              <input type="hidden" name="status" value={o.value} />
              <button
                type="submit"
                disabled={isCurrent}
                className={
                  isCurrent
                    ? `flex w-full min-h-10 flex-col items-center justify-center gap-0.5 ${idleBase} ${o.activeClass}`
                    : `flex w-full min-h-10 flex-col items-center justify-center gap-0.5 ${idleBase} ${o.idleClass}`
                }
              >
                <span>{isCurrent ? `${o.label} · 現在` : o.label}</span>
                <span className="text-[10px] font-normal leading-tight opacity-80">
                  {o.sub}
                </span>
              </button>
            </form>
          );
        })}
      </div>
    </div>
  );
}

export function InputField(props: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  mono?: boolean;
  defaultValue?: string;
}) {
  const font = props.mono ? "font-mono text-sm" : "text-sm";
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-zinc-300">
        {props.label}
      </label>
      <input
        className={`h-11 w-full rounded-[var(--radius-md)] border border-zinc-700/90 bg-zinc-950/50 px-4 text-zinc-100 placeholder-zinc-600 transition-colors focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20 ${font}`}
        name={props.name}
        placeholder={props.placeholder}
        required={props.required}
        type={props.type ?? "text"}
        defaultValue={props.defaultValue}
      />
    </div>
  );
}

export function SelectField(props: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-zinc-300">
        {props.label}
      </label>
      <select
        className="h-11 w-full cursor-pointer rounded-[var(--radius-md)] border border-zinc-700/90 bg-zinc-950/50 px-4 text-sm text-zinc-100 transition-colors focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        name={props.name}
        required={props.required}
        defaultValue={props.defaultValue}
      >
        {props.children}
      </select>
    </div>
  );
}

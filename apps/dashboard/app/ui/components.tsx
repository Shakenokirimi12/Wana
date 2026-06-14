import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { IssueStatus } from "@wana/types";

import { Button, LinkButton } from "@cloudflare/kumo/components/button";
import { LayerCard } from "@cloudflare/kumo/components/layer-card";
import { Badge as KumoBadge } from "@cloudflare/kumo/components/badge";
import { Input } from "@cloudflare/kumo/components/input";
import { Link } from "@cloudflare/kumo/components/link";

/**
 * UI コンポーネントは @cloudflare/kumo (Base UI + Tailwind v4) に全面移行。
 * 呼び出し側 (routes) の API を変えないためのファサード。
 *
 * ここで使うのは SSR 安全な静的コンポーネントのみ:
 * Button（フォーム submit / リンク）, LayerCard, Badge, Input。
 * Dialog/Select 等の対話系は `app/islands/` 経由で使う（このファイルでは使わない）。
 */

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> & { className?: string };

export function ButtonPrimary(
  props: NativeButtonProps & { children: ReactNode }
) {
  const { type = "button", ...rest } = props;
  return <Button variant="primary" type={type} {...rest} />;
}

export function ButtonSecondary(
  props: NativeButtonProps & { children: ReactNode }
) {
  const { type = "button", ...rest } = props;
  return <Button variant="secondary" type={type} {...rest} />;
}

export function ButtonSuccess(props: {
  type?: "submit" | "button";
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      variant="primary"
      type={props.type ?? "button"}
      disabled={props.disabled}
      className={props.className}
    >
      {props.children}
    </Button>
  );
}

export function ButtonOutline(props: {
  type?: "submit" | "button";
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      type={props.type ?? "button"}
      disabled={props.disabled}
      className={props.className}
    >
      {props.children}
    </Button>
  );
}

export function ButtonDestructiveOutline(props: {
  type?: "submit" | "button";
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      variant="destructive"
      type={props.type ?? "button"}
      disabled={props.disabled}
      className={props.className}
    >
      {props.children}
    </Button>
  );
}

export function LinkPrimary(props: { href: string; children: ReactNode }) {
  return (
    <LinkButton href={props.href} variant="primary">
      {props.children}
    </LinkButton>
  );
}

export function LinkOutline(props: { href: string; children: ReactNode }) {
  return (
    <LinkButton href={props.href} variant="outline">
      {props.children}
    </LinkButton>
  );
}

export function LinkGhost(props: { href: string; children: ReactNode }) {
  return (
    <LinkButton href={props.href} variant="ghost">
      {props.children}
    </LinkButton>
  );
}

export function TextLink(props: { href: string; children: ReactNode }) {
  return <Link href={props.href}>{props.children}</Link>;
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
        <h1 className="text-3xl font-semibold tracking-tight text-kumo-default sm:text-4xl">
          {props.title}
        </h1>
        {props.description ? (
          <div className="text-sm leading-relaxed text-kumo-subtle sm:text-base">
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
  return <LayerCard className={props.className}>{props.children}</LayerCard>;
}

/** 呼び出し側互換の意味色。kumo の Badge variant にマップする。 */
type BadgeVariant = "default" | "amber" | "emerald" | "zinc" | "rose";

const badgeVariantMap: Record<
  BadgeVariant,
  "neutral" | "warning" | "success" | "error"
> = {
  default: "neutral",
  amber: "warning",
  emerald: "success",
  zinc: "neutral",
  rose: "error",
};

export function Badge(props: { variant?: BadgeVariant; children: ReactNode }) {
  const v = props.variant ?? "default";
  return <KumoBadge variant={badgeVariantMap[v]}>{props.children}</KumoBadge>;
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
 * Issue 詳細用ステータス切替。segmented-tab スタイル：選択中タブは下線＋
 * 強い文字色、他は淡色 + hover、クリックで POST 送信（SSR 安全）。
 */
export function IssueStatusToolbar(props: {
  action: string;
  status: IssueStatus;
}) {
  const { action, status } = props;

  type Opt = {
    value: IssueStatus;
    label: string;
    /** Underline + label color when this tab is the active status. */
    activeAccent: string;
  };

  const opts: Opt[] = [
    {
      value: "unresolved",
      label: "Unresolved",
      activeAccent: "border-amber-500 text-kumo-default",
    },
    {
      value: "resolved",
      label: "Resolved",
      activeAccent: "border-emerald-500 text-emerald-400",
    },
    {
      value: "ignored",
      label: "Ignored",
      activeAccent: "border-rose-500 text-rose-300",
    },
  ];

  return (
    <nav
      role="tablist"
      aria-label="Issue status"
      className="-mx-1 flex w-full flex-wrap gap-x-1 gap-y-0 overflow-x-auto border-b border-kumo-hairline"
    >
      {opts.map((o) => {
        const isCurrent = status === o.value;
        const base =
          "inline-flex items-center whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors disabled:cursor-default";
        const cls = isCurrent
          ? `${base} ${o.activeAccent}`
          : `${base} border-transparent text-kumo-subtle hover:border-kumo-line hover:text-kumo-default`;
        return (
          <form
            method="post"
            action={action}
            key={o.value}
            role="presentation"
            className="contents"
          >
            <input type="hidden" name="status" value={o.value} />
            <button
              type="submit"
              role="tab"
              aria-selected={isCurrent}
              disabled={isCurrent}
              className={cls}
            >
              {o.label}
            </button>
          </form>
        );
      })}
    </nav>
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
  return (
    <Input
      label={props.label}
      name={props.name}
      type={props.type ?? "text"}
      placeholder={props.placeholder}
      required={props.required}
      defaultValue={props.defaultValue}
      className={props.mono ? "font-mono" : undefined}
    />
  );
}

export function SelectField(props: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
  children: ReactNode;
}) {
  // kumo Select は Base UI のリストボックス（要ハイドレーション）。フォーム POST を
  // JS なしで成立させるため、ネイティブ select を kumo トークンで装飾する。
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-kumo-default">
        {props.label}
      </label>
      <select
        className="h-11 w-full cursor-pointer rounded-md border border-kumo-hairline bg-kumo-base px-4 text-sm text-kumo-default transition-colors focus:border-kumo-brand focus:outline-none focus:ring-2 focus:ring-kumo-brand/30"
        name={props.name}
        required={props.required}
        defaultValue={props.defaultValue}
      >
        {props.children}
      </select>
    </div>
  );
}

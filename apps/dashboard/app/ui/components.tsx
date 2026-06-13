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
 * Issue 詳細用ステータス切替。現在のステータスは無効化＋強調、他は kumo Button で送信。
 * フォーム POST で動くため island 不要（SSR 安全）。
 */
export function IssueStatusToolbar(props: {
  action: string;
  status: IssueStatus;
}) {
  const { action, status } = props;

  type Opt = {
    value: IssueStatus;
    label: string;
    sub: string;
    variant: "secondary" | "primary" | "destructive";
  };

  const opts: Opt[] = [
    {
      value: "unresolved",
      label: "Unresolved",
      sub: "調査中・再オープン",
      variant: "secondary",
    },
    {
      value: "resolved",
      label: "Resolve",
      sub: "対応完了として閉じる",
      variant: "primary",
    },
    {
      value: "ignored",
      label: "Ignore",
      sub: "通知を抑止",
      variant: "destructive",
    },
  ];

  return (
    <div
      className="flex flex-col gap-3"
      role="group"
      aria-label="Issue status actions"
    >
      <p className="text-xs leading-relaxed text-kumo-subtle">
        現在の状態のボタンは無効化されています。他のボタンで切り替えられます。
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
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
              <Button
                type="submit"
                variant={isCurrent ? "secondary" : o.variant}
                disabled={isCurrent}
                className="w-full sm:w-auto"
              >
                <span className="flex flex-col items-center leading-tight">
                  <span>{isCurrent ? `${o.label} · 現在` : o.label}</span>
                  <span className="text-[10px] font-normal opacity-80">
                    {o.sub}
                  </span>
                </span>
              </Button>
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

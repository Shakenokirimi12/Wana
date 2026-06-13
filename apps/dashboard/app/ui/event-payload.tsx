import type { ReactNode } from "react";

import type {
  Breadcrumb,
  SentryEventPayload,
  SentryException,
  StackFrame,
} from "@wana/types";

/**
 * R2 に保存された生の Sentry イベント JSON を、スタックトレース・Breadcrumbs・
 * タグ等に整形して表示する (実装ガイド Step 4.4)。
 *
 * 入力は信頼できない外部 JSON のため、各セクションは存在チェックの上で
 * 描画する。パースに失敗した場合は呼び出し側が raw JSON にフォールバックする。
 */

function frameLocation(frame: StackFrame): string {
  const file = frame.filename || frame.abs_path || "<unknown>";
  if (frame.lineno != null) {
    return frame.colno != null
      ? `${file}:${frame.lineno}:${frame.colno}`
      : `${file}:${frame.lineno}`;
  }
  return file;
}

function StackFrameRow(props: { frame: StackFrame; crashed: boolean }) {
  const { frame, crashed } = props;
  const inApp = frame.in_app !== false;
  return (
    <li
      className={`border-l-2 ${
        inApp
          ? crashed
            ? "border-amber-500 bg-amber-500/[0.06]"
            : "border-amber-500/60 bg-amber-500/[0.025]"
          : "border-transparent"
      }`}
    >
      <div className="flex items-baseline justify-between gap-4 px-4 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={`truncate font-mono text-[13px] ${
              inApp ? "font-medium text-kumo-default" : "text-kumo-subtle"
            }`}
          >
            {frame.function || "<anonymous>"}
          </span>
          {crashed ? (
            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-400">
              crash
            </span>
          ) : !inApp ? (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-kumo-subtle">
              system
            </span>
          ) : null}
        </div>
        <span
          className={`shrink-0 break-all text-right font-mono text-[11px] ${
            inApp ? "text-kumo-subtle" : "text-kumo-subtle"
          }`}
        >
          {frameLocation(frame)}
        </span>
      </div>
      {inApp && frame.context_line ? (
        <div className="flex items-stretch gap-0 border-t border-kumo-hairline bg-kumo-recessed font-mono text-[12px]">
          <span className="select-none border-r border-kumo-hairline px-3 py-1.5 text-right tabular-nums text-kumo-subtle">
            {frame.lineno ?? ""}
          </span>
          <code className="overflow-x-auto whitespace-pre px-3 py-1.5 text-kumo-default">
            {frame.context_line.replace(/\s+$/, "")}
          </code>
        </div>
      ) : null}
    </li>
  );
}

function ExceptionView(props: { exception: SentryException; isLast: boolean }) {
  const { exception, isLast } = props;
  // Sentry orders frames oldest-first; show the crashing (newest) frame on top.
  const frames = exception.stacktrace?.frames
    ? [...exception.stacktrace.frames].reverse()
    : [];
  const crashIndex = frames.findIndex((f) => f.in_app !== false);
  const inAppCount = frames.filter((f) => f.in_app !== false).length;

  return (
    <div className={isLast ? "" : "mb-5"}>
      <div className="mb-3 border-l-2 border-rose-500/70 pl-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-sm font-semibold text-rose-300">
            {exception.type}
          </span>
          {exception.module ? (
            <span className="font-mono text-[11px] text-kumo-subtle">
              {exception.module}
            </span>
          ) : null}
        </div>
        {exception.value ? (
          <p className="mt-1 break-words text-sm leading-relaxed text-kumo-default">
            {exception.value}
          </p>
        ) : null}
      </div>
      {frames.length > 0 ? (
        <>
          <div className="mb-1.5 flex items-center gap-2 text-[11px] text-kumo-subtle">
            <span className="tabular-nums">{frames.length} frames</span>
            {inAppCount > 0 ? (
              <>
                <span className="text-kumo-subtle">·</span>
                <span className="tabular-nums text-amber-500/80">
                  {inAppCount} in app
                </span>
              </>
            ) : null}
          </div>
          <ul className="overflow-hidden rounded-lg border border-kumo-hairline bg-kumo-recessed">
            {frames.map((frame, i) => (
              <li
                key={i}
                className={
                  i > 0 ? "border-t border-kumo-hairline" : undefined
                }
              >
                <StackFrameRow frame={frame} crashed={i === crashIndex} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-xs text-kumo-subtle">No stack frames captured.</p>
      )}
    </div>
  );
}

function breadcrumbDotColor(level?: Breadcrumb["level"]): string {
  switch (level) {
    case "fatal":
    case "error":
      return "bg-rose-400";
    case "warning":
      return "bg-amber-400";
    case "debug":
      return "bg-zinc-500";
    default:
      return "bg-sky-400/80";
  }
}

function formatCrumbTime(timestamp: number): string {
  // Sentry breadcrumb timestamps are seconds (float); tolerate ms too.
  const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(11, 19);
}

function BreadcrumbsView(props: { breadcrumbs: Breadcrumb[] }) {
  return (
    <ol className="relative space-y-0">
      {props.breadcrumbs.map((crumb, i) => {
        const last = i === props.breadcrumbs.length - 1;
        return (
          <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
            {/* timeline rail */}
            <div className="relative flex w-3 shrink-0 justify-center">
              {!last ? (
                <span className="absolute top-2 bottom-0 w-px bg-kumo-base" />
              ) : null}
              <span
                className={`relative z-10 mt-1 h-2 w-2 rounded-full ring-2 ring-kumo-canvas ${breadcrumbDotColor(
                  crumb.level
                )}`}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-mono text-[11px] tabular-nums text-kumo-subtle">
                {formatCrumbTime(crumb.timestamp)}
              </span>
              <span className="rounded border border-kumo-hairline bg-kumo-base px-1.5 py-px font-mono text-[10px] text-kumo-subtle">
                {crumb.category || crumb.type || "default"}
              </span>
              <span className="min-w-0 break-words text-xs text-kumo-default">
                {crumb.message ?? <span className="text-kumo-subtle">—</span>}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function KeyValueGrid(props: { entries: Array<[string, string]> }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[9rem_1fr]">
      {props.entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-[11px] uppercase tracking-wide text-kumo-subtle">
            {k}
          </dt>
          <dd className="mb-1.5 break-words font-mono text-xs text-kumo-default sm:mb-0">
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Section(props: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-kumo-hairline px-5 py-5 first:border-t-0 sm:px-6">
      <h3 className="mb-3.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-kumo-subtle">
        {props.title}
        {props.count != null ? (
          <span className="rounded-full bg-kumo-base px-1.5 py-px text-[10px] tabular-nums text-kumo-subtle">
            {props.count}
          </span>
        ) : null}
      </h3>
      {props.children}
    </section>
  );
}

export function EventPayloadView(props: { payload: SentryEventPayload }) {
  const { payload } = props;
  const exceptions = payload.exception?.values ?? [];
  const breadcrumbs = payload.breadcrumbs ?? [];
  const tags = payload.tags ? Object.entries(payload.tags) : [];

  const meta: Array<[string, string]> = [];
  if (payload.level) meta.push(["level", payload.level]);
  if (payload.platform) meta.push(["platform", payload.platform]);
  if (payload.environment) meta.push(["environment", payload.environment]);
  if (payload.release) meta.push(["release", payload.release]);
  if (payload.logger) meta.push(["logger", payload.logger]);
  if (payload.user?.id) meta.push(["user.id", payload.user.id]);
  if (payload.user?.email) meta.push(["user.email", payload.user.email]);
  if (payload.user?.username)
    meta.push(["user.username", payload.user.username]);
  if (payload.request?.method && payload.request?.url)
    meta.push(["request", `${payload.request.method} ${payload.request.url}`]);
  else if (payload.request?.url) meta.push(["request", payload.request.url]);

  return (
    <div>
      {exceptions.length > 0 ? (
        <Section title="Stack trace">
          {exceptions.map((exc, i) => (
            <ExceptionView
              key={i}
              exception={exc}
              isLast={i === exceptions.length - 1}
            />
          ))}
        </Section>
      ) : payload.message ? (
        <Section title="Message">
          <p className="break-words text-sm leading-relaxed text-kumo-default">
            {payload.message}
          </p>
        </Section>
      ) : null}

      {meta.length > 0 ? (
        <Section title="Context">
          <KeyValueGrid entries={meta} />
        </Section>
      ) : null}

      {tags.length > 0 ? (
        <Section title="Tags" count={tags.length}>
          <div className="flex flex-wrap gap-1.5">
            {tags.map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center overflow-hidden rounded-md border border-kumo-hairline font-mono text-[11px]"
              >
                <span className="bg-kumo-base px-2 py-0.5 text-kumo-subtle">
                  {k}
                </span>
                <span className="bg-kumo-recessed px-2 py-0.5 text-kumo-default">
                  {v}
                </span>
              </span>
            ))}
          </div>
        </Section>
      ) : null}

      {breadcrumbs.length > 0 ? (
        <Section title="Breadcrumbs" count={breadcrumbs.length}>
          <BreadcrumbsView breadcrumbs={breadcrumbs} />
        </Section>
      ) : null}
    </div>
  );
}

/**
 * R2 から取得した raw JSON 文字列を SentryEventPayload としてパースする。
 * envelope 形式 (items 配列) もしくは単一イベント JSON の双方を許容する。
 * 失敗時は null を返し、呼び出し側で raw 表示にフォールバックさせる。
 */
export function parseStoredEventPayload(
  raw: string
): SentryEventPayload | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;

  // 単一イベント JSON
  const obj = json as Record<string, unknown>;
  if ("exception" in obj || "breadcrumbs" in obj || "message" in obj) {
    return obj as unknown as SentryEventPayload;
  }

  // envelope 形式: { items: [{ header, payload }] } の event/error を探す
  const items = (obj as { items?: unknown }).items;
  if (Array.isArray(items)) {
    for (const item of items) {
      const header = (item as { header?: { type?: string } })?.header;
      if (header?.type === "event" || header?.type === "error") {
        const payload = (item as { payload?: unknown }).payload;
        if (payload && typeof payload === "object") {
          return payload as SentryEventPayload;
        }
      }
    }
  }
  return null;
}

import type { ReactNode } from "react";

import type {
  Breadcrumb,
  SentryEventPayload,
  SentryException,
  StackFrame,
} from "@wana/types";

/** One resolved frame as emitted by `apps/worker/src/symbolicate.ts`. */
export interface SymbolicatedFrame {
  address: string;
  function?: string;
  file?: string;
  line?: number;
  unresolved?: boolean;
}

/** Shape of `<r2-key>.symbols.json` written by the worker. */
export interface SymbolsFile {
  version: 1;
  symbolsByUuid: Record<string, SymbolicatedFrame[]>;
}

function normalizeUuid(s: string | undefined): string | null {
  if (!s) return null;
  const u = s.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(u) ? u : null;
}

function parseAddrBig(s: string | undefined): bigint | null {
  if (!s) return null;
  const t = s.trim().replace(/^0[xX]/, "");
  if (!/^[0-9a-f]+$/i.test(t)) return null;
  try {
    return BigInt("0x" + t);
  } catch {
    return null;
  }
}

/**
 * Overlay worker-resolved symbols onto the raw event payload. Mutates a deep
 * copy so the original is left intact (the page also offers a raw-JSON
 * fallback that should keep showing the unsymbolicated form). Returns the
 * count of frames successfully named so the UI can show a "Symbolicated"
 * badge with the resolved count.
 */
export function mergeSymbolicatedPayload(
  payload: SentryEventPayload,
  symbols: SymbolsFile | null | undefined
): { payload: SentryEventPayload; resolved: number; totalNative: number } {
  const images = payload.debug_meta?.images ?? [];
  if (images.length === 0) {
    return { payload, resolved: 0, totalNative: 0 };
  }
  // Build address-range table: which image owns a given PC.
  const ranges: Array<{ uuid: string; base: bigint; end: bigint | null }> = [];
  for (const img of images) {
    const uuid = normalizeUuid(img.debug_id ?? img.code_id);
    const base = parseAddrBig(img.image_addr);
    if (!uuid || base == null) continue;
    const size =
      typeof img.image_size === "number" && img.image_size > 0
        ? BigInt(img.image_size)
        : null;
    ranges.push({ uuid, base, end: size == null ? null : base + size });
  }
  if (ranges.length === 0) {
    return { payload, resolved: 0, totalNative: 0 };
  }
  // Index symbols by uuid + address (decimal BigInt key so 0x and 0X variants
  // collapse). Frames carry the address verbatim from the SDK, so we
  // re-normalize it on lookup too. If no symbols file is available we
  // still walk the frames so we can report `totalNative` for the
  // "not symbolicated yet" badge.
  const symbolsByUuidAddr = new Map<string, Map<string, SymbolicatedFrame>>();
  if (symbols?.symbolsByUuid) {
    for (const [uuid, frames] of Object.entries(symbols.symbolsByUuid)) {
      const u = uuid.toLowerCase();
      const inner = new Map<string, SymbolicatedFrame>();
      for (const f of frames) {
        const a = parseAddrBig(f.address);
        if (a == null) continue;
        inner.set(a.toString(10), f);
      }
      symbolsByUuidAddr.set(u, inner);
    }
  }
  // Deep-clone exception/threads stacktraces only — keep top-level object
  // identity to avoid copying breadcrumbs / contexts which can be large.
  const cloned: SentryEventPayload = { ...payload };
  let resolved = 0;
  let totalNative = 0;

  const applyFrames = (frames: StackFrame[]): StackFrame[] =>
    frames.map((frame) => {
      const addrBig = parseAddrBig(frame.instruction_addr);
      if (addrBig == null) return frame;
      totalNative += 1;
      const range = ranges.find(
        (r) =>
          addrBig >= r.base && (r.end == null || addrBig < r.end)
      );
      if (!range) return frame;
      // Stamp the owning image UUID even when no symbol matches — the
      // GitHub-link renderer only needs uuid + filename + lineno, and
      // a frame with `function` already set (e.g. pre-symbolicated by
      // the Cocoa SDK) might still benefit from a source link.
      const stamped: StackFrame = { ...frame, _wanaImageUuid: range.uuid };
      const symbol = symbolsByUuidAddr
        .get(range.uuid)
        ?.get(addrBig.toString(10));
      if (!symbol || symbol.unresolved) return stamped;
      resolved += 1;
      return {
        ...stamped,
        function: symbol.function || frame.function,
        filename: symbol.file || frame.filename,
        lineno: symbol.line ?? frame.lineno,
      };
    });

  const applyStack = (
    s: { frames?: StackFrame[] } | undefined
  ): { frames: StackFrame[] } | undefined => {
    if (!s?.frames) return s as { frames: StackFrame[] } | undefined;
    return { ...s, frames: applyFrames(s.frames) };
  };

  if (cloned.exception?.values) {
    cloned.exception = {
      ...cloned.exception,
      values: cloned.exception.values.map((v) => ({
        ...v,
        stacktrace: applyStack(v.stacktrace),
      })),
    };
  }
  // threads is not in our SentryEventPayload type yet but real iOS events
  // include it; treat it as Record<string, unknown> and walk if present.
  const threads = (payload as unknown as {
    threads?: { values?: Array<{ stacktrace?: { frames?: StackFrame[] } }> };
  }).threads;
  if (Array.isArray(threads?.values)) {
    const newThreads = {
      ...threads,
      values: threads.values.map((t) => ({
        ...t,
        stacktrace: applyStack(t.stacktrace),
      })),
    };
    (cloned as unknown as Record<string, unknown>).threads = newThreads;
  }
  return { payload: cloned, resolved, totalNative };
}

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

/**
 * Build a `github.com/<repo>/blob/<sha>/<file>#L<line>` URL when we have
 * enough context. Returns null when the frame can't be linked — caller
 * renders plain text.
 */
function frameGithubUrl(
  frame: StackFrame,
  gitContextByUuid: Record<string, { gitSha: string; gitRepo: string }>
): string | null {
  const uuid = frame._wanaImageUuid;
  if (!uuid) return null;
  const ctx = gitContextByUuid[uuid];
  if (!ctx) return null;
  const path = frame.filename || frame.abs_path;
  if (!path) return null;
  // Drop leading `./` and absolute-path noise so the path lines up with
  // the repo layout. dSYM paths typically come through as relative
  // (`Sources/Foo.swift`) but defensive cleanup is cheap.
  const rel = path.replace(/^\.?\//, "").replace(/^\/+/, "");
  const line = frame.lineno != null ? `#L${frame.lineno}` : "";
  return `https://github.com/${ctx.gitRepo}/blob/${ctx.gitSha}/${rel}${line}`;
}

function StackFrameRow(props: {
  frame: StackFrame;
  crashed: boolean;
  gitContextByUuid: Record<string, { gitSha: string; gitRepo: string }>;
}) {
  const { frame, crashed, gitContextByUuid } = props;
  const inApp = frame.in_app !== false;
  const ghUrl = frameGithubUrl(frame, gitContextByUuid);
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
        {ghUrl ? (
          <a
            href={ghUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 break-all text-right font-mono text-[11px] text-kumo-subtle underline decoration-kumo-hairline decoration-dotted underline-offset-2 hover:text-amber-400 hover:decoration-amber-500/60"
            title="Open on GitHub"
          >
            {frameLocation(frame)}
          </a>
        ) : (
          <span className="shrink-0 break-all text-right font-mono text-[11px] text-kumo-subtle">
            {frameLocation(frame)}
          </span>
        )}
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

function ExceptionView(props: {
  exception: SentryException;
  isLast: boolean;
  gitContextByUuid: Record<string, { gitSha: string; gitRepo: string }>;
}) {
  const { exception, isLast, gitContextByUuid } = props;
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
                <StackFrameRow
                  frame={frame}
                  crashed={i === crashIndex}
                  gitContextByUuid={gitContextByUuid}
                />
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

export function EventPayloadView(props: {
  payload: SentryEventPayload;
  /** Optional symbolicate summary: how many native frames resolved. */
  symbolicate?: {
    resolved: number;
    totalNative: number;
    /** When true, render the unresolved stub (used when no symbols.json
     *  exists yet, so users see the affordance to re-run). */
    pending?: boolean;
  };
  /** Optional URL for the "Re-symbolicate" form. */
  resymbolicateAction?: string;
  /**
   * Per-image git context (sha + owner/repo) used to turn frame
   * filenames into GitHub deep-links. Empty/missing → plain text frames.
   */
  gitContextByUuid?: Record<string, { gitSha: string; gitRepo: string }>;
  /**
   * UUIDs of in-app images that have NO uploaded dSYM. When non-empty,
   * the renderer shows an "Upload dSYM" prompt above the stack trace
   * instead of the symbolicate progress badge. Empty / undefined means
   * either the project has all images covered, or the event has no
   * native frames at all.
   */
  missingDsymUuids?: string[];
  /** Settings → Debug files URL (manual upload affordance). */
  uploadDsymHref?: string;
  /** Top-page Guide URL (CLI + Run Script howto). */
  guideHref?: string;
}) {
  const {
    payload,
    symbolicate,
    resymbolicateAction,
    missingDsymUuids,
    uploadDsymHref,
    guideHref,
  } = props;
  const gitContextByUuid = props.gitContextByUuid ?? {};
  const missingCount = missingDsymUuids?.length ?? 0;
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
          {missingCount > 0 && symbolicate?.pending ? (
            <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-4">
              <p className="mb-1 text-sm font-semibold text-amber-300">
                dSYM 未アップロード ─ 関数名・行番号が解決できません
              </p>
              <p className="mb-3 text-xs leading-relaxed text-kumo-subtle">
                このクラッシュには{" "}
                <span className="font-mono tabular-nums text-kumo-default">
                  {missingCount}
                </span>{" "}
                個のアプリ image が含まれていますが、対応する dSYM が Wana
                に登録されていません。次のいずれかでアップロードしてください。
              </p>
              <div className="mb-3 rounded-md border border-kumo-hairline bg-kumo-base/60 p-3 font-mono text-[11px] leading-relaxed text-kumo-default">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-kumo-subtle">
                  Xcode Run Script (自動)
                </div>
                <span className="text-kumo-subtle">$ </span>
                npm install -g @wanahq/cli
                <br />
                <span className="text-kumo-subtle">$ </span>
                wana upload-dif "$DWARF_DSYM_FOLDER_PATH"
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                {uploadDsymHref ? (
                  <a
                    href={uploadDsymHref}
                    className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 font-medium text-amber-300 hover:bg-amber-500/25"
                  >
                    Settings で手動アップロード
                  </a>
                ) : null}
                {guideHref ? (
                  <a
                    href={guideHref}
                    className="inline-flex items-center rounded-full border border-kumo-hairline bg-kumo-recessed px-3 py-1 font-medium text-kumo-default hover:border-amber-500/40 hover:text-amber-300"
                  >
                    Guide を開く
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          {symbolicate && symbolicate.totalNative > 0 && missingCount === 0 ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px]">
              {symbolicate.pending ? (
                <span className="rounded-full border border-kumo-hairline bg-kumo-recessed px-2 py-0.5 font-medium text-kumo-subtle">
                  Symbolicate 待機中
                </span>
              ) : (
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-medium tabular-nums text-emerald-300">
                  Symbolicated {symbolicate.resolved} / {symbolicate.totalNative}
                </span>
              )}
              {resymbolicateAction ? (
                <form method="post" action={resymbolicateAction}>
                  <button
                    type="submit"
                    className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-300 hover:bg-amber-500/20"
                  >
                    Re-symbolicate
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
          {exceptions.map((exc, i) => (
            <ExceptionView
              key={i}
              exception={exc}
              isLast={i === exceptions.length - 1}
              gitContextByUuid={gitContextByUuid}
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

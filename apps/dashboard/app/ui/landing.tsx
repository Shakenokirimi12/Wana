import type { ReactNode } from "react";

import { WanaMark } from "./icons";
import { Shell } from "./shell";

/**
 * Marketing landing for signed-out visitors.
 *
 * Design goals (2026-06-14 rebuild):
 *   - Linear / Vercel / Resend tier polish: gradient text, subtle mesh
 *     backgrounds, glass-morphic surfaces, asymmetric bento grids, animated
 *     micro-decorations (pulsing dots, drifting orbs, gradient-stroke SVG).
 *   - Section-by-section hue rotation (amber → sky → emerald → violet) so the
 *     page doesn't feel monochrome.
 *   - All SSR: zero client islands. CSS animations are fine.
 *   - Tailwind v4 is configured to scan `app/**\/*.tsx`, so arbitrary class
 *     names below are guaranteed to be generated.
 */
export function LandingPage(props: { showSignup: boolean; currentPath: string }) {
  // The landing was designed dark-first. kumo's `light-dark()` color
  // tokens read the root element's `color-scheme`, so forcing `dark`
  // at the document level (rather than on a wrapping div) is the only
  // way to flip every glow / glass / gradient to its intended
  // contrast. Signed-in routes are unaffected because they don't
  // render this component — landing is signed-out only.
  return (
    <>
      {/* Force dark surfaces. kumo's tokens come from `--color-kumo-*`
          CSS variables that bake to OS-preferred light values when the
          user is in light mode. Override the variables themselves so
          even opacity-modifier utility classes (e.g. bg-kumo-canvas at
          60% opacity) stay dark. */}
      <style>{`
        :root{
          color-scheme:dark!important;
          --color-kumo-canvas:#09090b!important;
          --color-kumo-base:#18181b!important;
          --color-kumo-recessed:#1c1c20!important;
          --color-kumo-hairline:rgba(255,255,255,0.10)!important;
          --color-kumo-default:#fafafa!important;
          --color-kumo-subtle:#c8c8cf!important;
        }
        body{background-color:#09090b!important}
      `}</style>
      <Shell currentPath={props.currentPath} title="Wana" auth="hidden">
        {/* Marketing-only top nav. The shell hides its own header for
            auth="hidden", so we put our own slim nav-bar here. */}
        <LandingNav showSignup={props.showSignup} />

        {/* Global decorative backdrop. Pinned to the viewport so it bleeds
            beyond the content's max-width. Pure CSS — gradient mesh + grid
            pattern + grain. */}
        <GlobalBackdrop />

        <div className="relative">
          <Hero showSignup={props.showSignup} />
          <SocialProofStrip />
          <Features />
          <SymbolicateBeforeAfter />
          <DemoPreview />
          <HowItWorks />
          <DsnAnatomy />
          <SdkGrid />
          <NativeGuide />
          <ComparisonTable />
          <OpenSourceSection />
          <FaqSection />
          <ClosingCta showSignup={props.showSignup} />
          <LandingFooter showSignup={props.showSignup} />
        </div>
      </Shell>
    </>
  );
}

// ── Shared layout helpers ──────────────────────────────────────────────────

/**
 * Standard landing-page section container. Provides consistent vertical
 * rhythm and a centered, generous max-width.
 */
function Section(props: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={props.id}
      className={`relative mx-auto w-full px-5 sm:px-6 ${props.className ?? ""}`}
      style={{ maxWidth: "76rem" }}
    >
      {props.children}
    </section>
  );
}

/** Small eyebrow label above section headings. Color is configurable per hue. */
function Eyebrow(props: { children: ReactNode; tone?: HueName }) {
  const tone = props.tone ?? "amber";
  const cls = {
    amber: "text-amber-400",
    sky: "text-sky-400",
    emerald: "text-emerald-400",
    violet: "text-violet-400",
    rose: "text-rose-400",
  }[tone];
  return (
    <p
      className={`mb-3 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] ${cls}`}
    >
      <span className="h-px w-6 bg-current opacity-50" />
      {props.children}
    </p>
  );
}

type HueName = "amber" | "sky" | "emerald" | "violet" | "rose";

/** Section heading — big, balanced, slightly gradient-y. */
function SectionHeading(props: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-12 max-w-2xl">
      <h2
        className="text-3xl font-semibold tracking-tight text-kumo-default sm:text-4xl"
        style={{ textWrap: "balance" as const, letterSpacing: "-0.02em" }}
      >
        {props.children}
      </h2>
      {props.sub ? (
        <p className="mt-4 text-base leading-relaxed text-kumo-subtle">
          {props.sub}
        </p>
      ) : null}
    </div>
  );
}

// ── Global Backdrop ────────────────────────────────────────────────────────

/**
 * Fixed-position decorative layer that sits behind everything. Combines:
 *   - a wide amber/violet conic-gradient wash at the top
 *   - a subtle dotted grid pattern via SVG `data:` URL
 *   - a faint vignette so edges don't feel flat
 */
function GlobalBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* Conic-gradient hero wash */}
      <div
        className="absolute -top-40 left-1/2 h-[36rem] w-[64rem] -translate-x-1/2 opacity-[0.32]"
        style={{
          background:
            "conic-gradient(from 220deg at 50% 50%, rgba(245,158,11,0.55), rgba(244,63,94,0.0) 25%, rgba(139,92,246,0.45) 55%, rgba(56,189,248,0.0) 75%, rgba(245,158,11,0.55))",
          filter: "blur(70px)",
        }}
      />
      {/* Soft amber orb following the hero copy */}
      <div
        className="absolute left-[6%] top-[12rem] h-[26rem] w-[26rem] rounded-full opacity-[0.18]"
        style={{
          background: "radial-gradient(circle at center, #f59e0b, transparent 60%)",
          filter: "blur(60px)",
        }}
      />
      {/* Cool sky/violet orb on the right */}
      <div
        className="absolute right-[2%] top-[20rem] h-[28rem] w-[28rem] rounded-full opacity-[0.16]"
        style={{
          background: "radial-gradient(circle at center, #8b5cf6, transparent 60%)",
          filter: "blur(80px)",
        }}
      />
      {/* Dotted grid pattern — purely CSS via mask. */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(161,161,170,0.18) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage:
            "linear-gradient(to bottom, transparent, black 8%, black 60%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent, black 8%, black 60%, transparent 100%)",
        }}
      />
    </div>
  );
}

// ── Landing Nav ────────────────────────────────────────────────────────────

function LandingNav(props: { showSignup: boolean }) {
  return (
    <header className="sticky top-0 z-40 -mx-4 mb-4 border-b border-kumo-hairline/60 bg-kumo-canvas/70 px-4 backdrop-blur-xl sm:-mx-8 sm:px-8">
      <div
        className="mx-auto flex h-14 w-full items-center justify-between gap-4"
        style={{ maxWidth: "76rem" }}
      >
        <a href="/" className="flex items-center gap-2" aria-label="Wana home">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 ring-1 ring-amber-500/30">
            <WanaMark size={20} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-kumo-default">
            Wana
          </span>
        </a>
        <nav className="hidden items-center gap-7 text-[13px] text-kumo-subtle md:flex">
          <a href="#features" className="transition-colors hover:text-kumo-default">
            Features
          </a>
          <a href="#sdks" className="transition-colors hover:text-kumo-default">
            SDKs
          </a>
          <a
            href="#architecture"
            className="transition-colors hover:text-kumo-default"
          >
            Architecture
          </a>
          <a href="#compare" className="transition-colors hover:text-kumo-default">
            Compare
          </a>
          <a href="#faq" className="transition-colors hover:text-kumo-default">
            FAQ
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <a
            href="/login"
            className="hidden h-9 items-center rounded-md px-3 text-[13px] font-medium text-kumo-default transition-colors hover:text-amber-300 sm:inline-flex"
          >
            Sign in
          </a>
          {props.showSignup ? (
            <a
              href="/signup"
              className="inline-flex h-9 items-center rounded-md bg-amber-500 px-3.5 text-[13px] font-semibold text-zinc-950 transition-colors hover:bg-amber-400"
            >
              Get started
            </a>
          ) : null}
        </div>
      </div>
    </header>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────

function Hero(props: { showSignup: boolean }) {
  return (
    <Section className="pt-12 pb-28 sm:pt-20 sm:pb-32">
      <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_1fr]">
        <div>
          {/* Live status pill — pulsing dot ties it to the running system. */}
          <div className="mb-7 inline-flex items-center gap-2.5 rounded-full border border-kumo-hairline bg-kumo-recessed/60 py-1 pl-2 pr-3 text-[11px] font-medium text-kumo-default backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </span>
            <span className="text-kumo-subtle">
              <span className="text-amber-300">Live</span> · Cloudflare-native
              crash reporting
            </span>
          </div>

          <h1
            className="text-4xl font-semibold leading-tight tracking-tight text-kumo-default sm:text-5xl lg:text-6xl"
            style={{
              letterSpacing: "-0.035em",
              wordBreak: "keep-all",
              overflowWrap: "break-word",
            }}
          >
            <span className="block">クラッシュレポートを、</span>
            <span
              className="inline-block bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(110deg, #fbbf24 0%, #f97316 35%, #f43f5e 65%, #a855f7 100%)",
              }}
            >
              自分の Cloudflare
            </span>
            <span className="text-kumo-default">で。</span>
          </h1>

          <p className="mt-7 max-w-xl text-base leading-relaxed text-kumo-subtle sm:text-lg">
            Sentry SDK そのままで、ingest からシンボリケート、保管、UI まで全部
            Cloudflare の上で動きます。dSYM / ProGuard 解決は Workers Containers、
            ストレージは R2、UI は Pages。
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            {props.showSignup ? (
              <a
                href="/signup"
                className="group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-lg px-6 text-sm font-semibold text-zinc-950 shadow-lg shadow-amber-500/25 transition-all hover:-translate-y-0.5 hover:shadow-amber-500/40"
                style={{
                  background:
                    "linear-gradient(135deg, #fde68a 0%, #f59e0b 50%, #fb923c 100%)",
                }}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                />
                <span className="relative flex items-center gap-2">
                  無料で始める
                  <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
                </span>
              </a>
            ) : null}
            <a
              href="#sdks"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-kumo-hairline bg-kumo-recessed/60 px-5 text-sm font-medium text-kumo-default backdrop-blur transition-colors hover:border-amber-500/40 hover:text-amber-300"
            >
              SDK ドキュメント
            </a>
            <a
              href="https://github.com/shakenokirimi12/wana"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-kumo-subtle transition-colors hover:text-kumo-default"
            >
              <GithubGlyph />
              <span>shakenokirimi12/wana</span>
            </a>
          </div>

          {/* Quick "install" snippet — terminal one-liner under the CTAs. */}
          <div className="mt-9 inline-flex max-w-full items-center gap-3 rounded-lg border border-kumo-hairline bg-kumo-canvas/60 px-3.5 py-2.5 font-mono text-[12.5px] text-kumo-default shadow-sm backdrop-blur">
            <span className="text-emerald-400">$</span>
            <span className="whitespace-nowrap text-kumo-subtle">npm install -g</span>
            <span className="text-amber-300">@wanahq/cli</span>
          </div>
        </div>

        <HeroPreviewCard />
      </div>
    </Section>
  );
}

/**
 * Stylized "issue detail" card with tabs and a stack trace.
 *
 * Layered for depth: an outer glow → an offset shadow card behind → the
 * real card on top. Builds the "real product screenshot" illusion.
 */
function HeroPreviewCard() {
  return (
    <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
      {/* Conic accent halo */}
      <div
        aria-hidden="true"
        className="absolute -inset-6 -z-10 rounded-[2rem] opacity-70 blur-2xl"
        style={{
          background:
            "conic-gradient(from 140deg at 50% 50%, rgba(245,158,11,0.25), rgba(244,63,94,0.0) 30%, rgba(139,92,246,0.25) 60%, rgba(245,158,11,0.25))",
        }}
      />
      {/* Offset ghost card behind */}
      <div
        aria-hidden="true"
        className="absolute inset-0 translate-x-3 translate-y-3 rounded-2xl border border-kumo-hairline/50 bg-kumo-recessed/40"
      />
      {/* The real card */}
      <div className="relative overflow-hidden rounded-2xl border border-kumo-hairline bg-kumo-canvas/95 shadow-2xl shadow-zinc-950/50 backdrop-blur-xl">
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 border-b border-kumo-hairline bg-kumo-base/70 px-3 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          <span className="ml-3 inline-flex items-center gap-1.5 rounded-md border border-kumo-hairline bg-kumo-recessed/60 px-2 py-0.5 font-mono text-[10px] text-kumo-subtle">
            <span className="text-emerald-400">●</span>
            wana.app/p/example-project/issues/04bccd…
          </span>
        </div>
        {/* Tabs row */}
        <div className="flex items-center gap-4 border-b border-kumo-hairline px-4 text-[11px] font-medium text-kumo-subtle">
          {["Issues", "Releases", "Notifications", "Setup"].map((t, i) => (
            <span
              key={t}
              className={`-mb-px border-b-2 py-2.5 ${
                i === 0
                  ? "border-amber-500 text-amber-300"
                  : "border-transparent"
              }`}
            >
              {t}
            </span>
          ))}
        </div>
        <div className="p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="rounded bg-rose-500/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-rose-300 ring-1 ring-inset ring-rose-500/30">
              fatal
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Symbolicated 28 / 28
            </span>
          </div>
          <p className="mb-1 font-mono text-[13px] font-semibold text-rose-300">
            EXC_BAD_ACCESS
          </p>
          <p className="mb-3 text-[12px] leading-relaxed text-kumo-default">
            Attempted to dereference null pointer
          </p>
          <ul className="space-y-0 overflow-hidden rounded-lg border border-kumo-hairline bg-kumo-recessed/60">
            <PreviewFrame
              fn="UoAApp.ContentView.body.getter"
              loc="ContentView.swift:142"
              crashed
            />
            <PreviewFrame
              fn="SwiftUI.ViewBuilder.buildBlock"
              loc="ViewBuilder.swift:48"
              system
            />
            <PreviewFrame
              fn="UoAApp.HomeScreen.refresh()"
              loc="HomeScreen.swift:86"
            />
            <PreviewFrame
              fn="UIKit.UIView.touchesEnded"
              loc="UIView.m:1024"
              system
            />
          </ul>
          <div className="mt-3 flex items-center gap-1.5 text-[10px]">
            <span className="rounded border border-kumo-hairline bg-kumo-base px-1.5 py-0.5 font-mono text-kumo-default">
              release: example-project@3.1
            </span>
            <span className="rounded border border-kumo-hairline bg-kumo-base px-1.5 py-0.5 font-mono text-kumo-default">
              db04745
            </span>
            <span className="ml-auto font-mono text-kumo-subtle">146 events</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewFrame(props: {
  fn: string;
  loc: string;
  crashed?: boolean;
  system?: boolean;
}) {
  return (
    <li
      className={`flex items-center justify-between border-l-2 px-3 py-1.5 text-[11px] ${
        props.crashed
          ? "border-amber-500 bg-amber-500/[0.10]"
          : props.system
            ? "border-transparent"
            : "border-amber-500/40"
      }`}
    >
      <span
        className={`truncate font-mono ${
          props.system ? "text-kumo-subtle" : "font-medium text-kumo-default"
        }`}
      >
        {props.fn}
      </span>
      <span
        className={`shrink-0 font-mono text-[10px] ${
          props.system
            ? "text-kumo-subtle"
            : "text-amber-400/90 underline decoration-amber-500/40 decoration-dotted underline-offset-2"
        }`}
      >
        {props.loc}
      </span>
    </li>
  );
}

// ── Social proof strip ─────────────────────────────────────────────────────

function SocialProofStrip() {
  const stats: Array<{ value: string; label: string; tone: HueName }> = [
    { value: "9+", label: "SDKs supported", tone: "amber" },
    { value: "~3s", label: "Crash → symbolicated", tone: "emerald" },
    { value: "100%", label: "On Cloudflare edge", tone: "sky" },
    { value: "MIT", label: "Open source", tone: "violet" },
  ];
  const toneCls = (t: HueName) =>
    ({
      amber: "text-amber-300",
      sky: "text-sky-300",
      emerald: "text-emerald-300",
      violet: "text-violet-300",
      rose: "text-rose-300",
    })[t];
  return (
    <Section className="pb-24">
      <div className="relative overflow-hidden rounded-2xl border border-kumo-hairline bg-kumo-recessed/40 backdrop-blur">
        {/* Inner glow tint */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background:
              "radial-gradient(ellipse at top, rgba(245,158,11,0.08), transparent 60%)",
          }}
        />
        <div className="relative grid grid-cols-2 divide-kumo-hairline sm:grid-cols-4 sm:divide-x">
          {stats.map((s) => (
            <div key={s.label} className="px-6 py-7">
              <div
                className={`mb-1 font-mono text-3xl font-semibold tabular-nums sm:text-4xl ${toneCls(s.tone)}`}
                style={{ letterSpacing: "-0.04em" }}
              >
                {s.value}
              </div>
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-kumo-subtle">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ── Features (bento grid) ──────────────────────────────────────────────────

function Features() {
  return (
    <Section id="features" className="pb-28">
      <Eyebrow tone="amber">Why Wana</Eyebrow>
      <SectionHeading
        sub="Sentry の使い心地そのままで、データもインフラも自分のアカウントに留めたままに。"
      >
        小さく速く、しかし妥協のない
        <br className="hidden sm:block" />
        クラッシュレポート基盤。
      </SectionHeading>

      <div className="grid gap-4 md:grid-cols-6 md:grid-rows-2">
        {/* Large feature — Sentry drop-in (spans 4 cols / 2 rows) */}
        <FeatureBig
          eyebrow="Drop-in compatible"
          title="Sentry SDK そのまま、DSN だけ差し替え"
          body="Cocoa / Android / JS / Node / RN / Flutter / Python / Go / Rust 全部対応。既存プロジェクトはコード 0 行で切替完了。"
          accent="amber"
        />

        {/* dSYM symbolicate */}
        <FeatureSmall
          eyebrow="On the edge"
          title="dSYM をエッジで symbolicate"
          body="Workers Containers + llvm-symbolizer。アップロードから関数名解決まで数秒。"
          accent="sky"
          icon={<IconCpu />}
        />

        {/* Source-linked */}
        <FeatureSmall
          eyebrow="Source-linked"
          title="Stack → GitHub に直リンク"
          body="CLI が build 時に git SHA を相乗りさせるので、フレームから当時の行に飛べる。"
          accent="emerald"
          icon={<IconLink />}
        />

        {/* Self-host */}
        <FeatureSmall
          eyebrow="Your account"
          title="自分の Cloudflare で動く"
          body="Workers / D1 / R2 / Queues / Containers。データはあなたの口座下。"
          accent="violet"
          icon={<IconCloud />}
        />

        {/* Realtime */}
        <FeatureSmall
          eyebrow="Real-time"
          title="ライブで Issue が流れる"
          body="Issue 一覧は SSE で自動更新。アラートを待たずに気づける。"
          accent="rose"
          icon={<IconPulse />}
        />

        {/* OSS */}
        <FeatureSmall
          eyebrow="Open"
          title="MIT、ベンダーロック無し"
          body="fork して自分でデプロイ可。SDK 側の逃げ道も常に開いてる。"
          accent="amber"
          icon={<IconLock />}
        />
      </div>
    </Section>
  );
}

function FeatureBig(props: {
  eyebrow: string;
  title: string;
  body: string;
  accent: HueName;
}) {
  const ring = {
    amber: "from-amber-500/30 via-amber-500/0 to-transparent",
    sky: "from-sky-500/30 via-sky-500/0 to-transparent",
    emerald: "from-emerald-500/30 via-emerald-500/0 to-transparent",
    violet: "from-violet-500/30 via-violet-500/0 to-transparent",
    rose: "from-rose-500/30 via-rose-500/0 to-transparent",
  }[props.accent];
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-kumo-hairline bg-kumo-recessed/40 p-7 backdrop-blur md:col-span-4 md:row-span-2">
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br opacity-60 ${ring}`}
      />
      {/* SVG decoration — flow illustration */}
      <svg
        aria-hidden="true"
        viewBox="0 0 480 200"
        className="pointer-events-none absolute -bottom-6 -right-6 h-48 w-[28rem] opacity-50"
      >
        <defs>
          <linearGradient id="featBigGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <path
            key={i}
            d={`M 0 ${80 + i * 12} Q 240 ${20 + i * 18} 480 ${80 + i * 12}`}
            stroke="url(#featBigGrad)"
            strokeWidth="1"
            fill="none"
            opacity={1 - i * 0.15}
          />
        ))}
      </svg>
      <div className="relative">
        <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-300">
          {props.eyebrow}
        </div>
        <h3
          className="mb-3 text-2xl font-semibold tracking-tight text-kumo-default sm:text-3xl"
          style={{ letterSpacing: "-0.025em" }}
        >
          {props.title}
        </h3>
        <p className="mb-7 max-w-md text-sm leading-relaxed text-kumo-subtle">
          {props.body}
        </p>

        {/* Inline code-as-content sample */}
        <div className="max-w-md overflow-hidden rounded-lg border border-kumo-hairline bg-kumo-canvas/80 font-mono text-[12px] shadow-inner shadow-zinc-950/50">
          <div className="flex items-center justify-between border-b border-kumo-hairline bg-kumo-base/60 px-3 py-1.5 text-[10px] text-kumo-subtle">
            <span>swift</span>
            <span className="opacity-60">SentrySDK.swift</span>
          </div>
          <pre className="overflow-x-auto px-3 py-3 leading-relaxed">
            <span className="text-violet-300">import</span>{" "}
            <span className="text-sky-300">Sentry</span>
            {"\n\n"}
            <span className="text-violet-300">SentrySDK</span>
            <span className="text-kumo-default">.</span>
            <span className="text-emerald-300">start</span>{" "}
            <span className="text-kumo-default">{"{"}</span>{" "}
            <span className="text-amber-300">options</span>{" "}
            <span className="text-violet-300">in</span>
            {"\n  "}
            <span className="text-amber-300">options</span>
            <span className="text-kumo-default">.dsn = </span>
            <span className="text-emerald-300">
              "https://wana3f73…@ingest.wana.example.com/example-project"
            </span>
            {"\n"}
            <span className="text-kumo-default">{"}"}</span>
          </pre>
        </div>
      </div>
    </div>
  );
}

function FeatureSmall(props: {
  eyebrow: string;
  title: string;
  body: string;
  accent: HueName;
  icon: ReactNode;
}) {
  const tone = {
    amber: "text-amber-300 ring-amber-500/30 bg-amber-500/10",
    sky: "text-sky-300 ring-sky-500/30 bg-sky-500/10",
    emerald: "text-emerald-300 ring-emerald-500/30 bg-emerald-500/10",
    violet: "text-violet-300 ring-violet-500/30 bg-violet-500/10",
    rose: "text-rose-300 ring-rose-500/30 bg-rose-500/10",
  }[props.accent];
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-kumo-hairline bg-kumo-recessed/40 p-6 backdrop-blur transition-colors hover:bg-kumo-recessed/60 md:col-span-2">
      <div
        className={`mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-inset ${tone}`}
      >
        {props.icon}
      </div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-kumo-subtle">
        {props.eyebrow}
      </div>
      <h3 className="mb-2 text-base font-semibold tracking-tight text-kumo-default">
        {props.title}
      </h3>
      <p className="text-[12.5px] leading-relaxed text-kumo-subtle">
        {props.body}
      </p>
    </div>
  );
}

// Inline icons (stroke-currentColor) — paired with feature tiles.
function IconCpu() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
    </svg>
  );
}
function IconLink() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function IconCloud() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.5 19a4.5 4.5 0 1 0-1.42-8.78A7 7 0 1 0 4 16.5h13.5z" />
    </svg>
  );
}
function IconPulse() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
function IconLock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// ── Before / After (symbolicate) ────────────────────────────────────────────

function SymbolicateBeforeAfter() {
  return (
    <Section className="pb-28">
      <Eyebrow tone="emerald">Before · After</Eyebrow>
      <SectionHeading
        sub="dSYM をアップしてしまえば、生のアドレス羅列がそのまま読めるスタックトレースになります。"
      >
        意味のあるスタックトレースに、
        <br className="hidden sm:block" />
        数秒で生まれ変わる。
      </SectionHeading>

      <div className="relative grid gap-5 md:grid-cols-2">
        {/* Connecting arrow on md+ */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-amber-500/40 bg-kumo-canvas/95 text-amber-300 shadow-xl shadow-amber-500/20 backdrop-blur md:flex"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </div>

        {/* Raw (before) */}
        <div className="relative overflow-hidden rounded-2xl border border-rose-500/20 bg-kumo-canvas/80 backdrop-blur">
          <div className="flex items-center justify-between border-b border-kumo-hairline bg-kumo-base/60 px-4 py-2.5 text-[11px]">
            <span className="font-semibold uppercase tracking-[0.14em] text-rose-300">
              生のアドレスのまま
            </span>
            <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">
              0 / 28
            </span>
          </div>
          <pre className="overflow-x-auto px-5 py-5 font-mono text-[11.5px] leading-[1.7] text-kumo-subtle">
            <span>0   UoAApp                            0x0000000104b6a210</span>
            {"\n"}
            <span>1   UoAApp                            0x0000000104a821ac</span>
            {"\n"}
            <span>2   UoAApp                            0x0000000104b5e3e0</span>
            {"\n"}
            <span>3   SwiftUI                           0x00000001a8d7c104</span>
            {"\n"}
            <span>4   UIKit                             0x00000001844e1a98</span>
            {"\n"}
            <span>5   libdispatch                       0x00000001801a1d04</span>
            {"\n"}
            <span>6   libobjc                           0x000000018011e8a4</span>
          </pre>
        </div>

        {/* Symbolicated (after) */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-kumo-canvas/80 backdrop-blur">
          <div className="flex items-center justify-between border-b border-kumo-hairline bg-kumo-base/60 px-4 py-2.5 text-[11px]">
            <span className="font-semibold uppercase tracking-[0.14em] text-emerald-300">
              Wana で symbolicated
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              28 / 28
            </span>
          </div>
          <pre className="overflow-x-auto px-5 py-5 font-mono text-[11.5px] leading-[1.7] text-kumo-default">
            <span className="text-kumo-subtle">0  </span>
            <span className="text-amber-300">UoAApp.ContentView.body.getter</span>
            <span className="text-kumo-subtle">  ContentView.swift:142</span>
            {"\n"}
            <span className="text-kumo-subtle">1  </span>
            <span className="text-amber-300">UoAApp.HomeScreen.refresh()</span>
            <span className="text-kumo-subtle">  HomeScreen.swift:86</span>
            {"\n"}
            <span className="text-kumo-subtle">2  </span>
            <span className="text-amber-300">UoAApp.APIClient.fetchEvents()</span>
            <span className="text-kumo-subtle">  APIClient.swift:204</span>
            {"\n"}
            <span className="text-kumo-subtle">3  </span>
            <span className="text-kumo-subtle">SwiftUI.ViewBuilder.buildBlock</span>
            {"\n"}
            <span className="text-kumo-subtle">4  </span>
            <span className="text-kumo-subtle">UIKit.UIApplication.sendEvent</span>
            {"\n"}
            <span className="text-kumo-subtle">5  </span>
            <span className="text-kumo-subtle">libdispatch._dispatch_main_queue</span>
            {"\n"}
            <span className="text-kumo-subtle">6  </span>
            <span className="text-kumo-subtle">libobjc.objc_msgSend</span>
          </pre>
        </div>
      </div>
    </Section>
  );
}

// ── Demo Preview ───────────────────────────────────────────────────────────

function DemoPreview() {
  return (
    <Section className="pb-32">
      <Eyebrow tone="amber">Live in the dashboard</Eyebrow>
      <SectionHeading
        sub="Sentry の Issue 詳細にあるもの全部 — シンボリケート済みスタック、GitHub 直リンク、breadcrumbs、release タグ、histogram、event 一覧。"
      >
        イシュー 1 つで、必要なものが全部見える。
      </SectionHeading>

      <div className="relative">
        {/* Decorative gradient halo around the screenshot. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-8 -inset-y-4 -z-10 rounded-[2.5rem] opacity-50 blur-3xl"
          style={{
            background:
              "linear-gradient(120deg, rgba(245,158,11,0.20), rgba(244,63,94,0.10) 40%, rgba(139,92,246,0.20))",
          }}
        />
        <div className="overflow-hidden rounded-2xl border border-kumo-hairline bg-kumo-canvas shadow-2xl shadow-zinc-950/60">
          {/* Window chrome */}
          <div className="flex items-center gap-1.5 border-b border-kumo-hairline bg-kumo-base px-4 py-2.5">
            <span className="h-3 w-3 rounded-full bg-rose-500/60" />
            <span className="h-3 w-3 rounded-full bg-amber-500/60" />
            <span className="h-3 w-3 rounded-full bg-emerald-500/60" />
            <span className="ml-3 inline-flex items-center gap-1.5 rounded-md border border-kumo-hairline bg-kumo-recessed/60 px-2 py-0.5 font-mono text-[11px] text-kumo-subtle">
              <span className="text-emerald-400">●</span>
              wana.app/p/example-project/issues/04bccdad…
            </span>
          </div>
          {/* App chrome — tabs + breadcrumb */}
          <div className="flex items-center justify-between border-b border-kumo-hairline bg-kumo-canvas/80 px-5 text-[12px]">
            <div className="flex items-center gap-5 text-kumo-subtle">
              {["Issues", "Releases", "Notifications", "Setup"].map((t, i) => (
                <span
                  key={t}
                  className={`-mb-px border-b-2 py-3 ${
                    i === 0 ? "border-amber-500 text-amber-300" : "border-transparent"
                  }`}
                >
                  {t}
                </span>
              ))}
            </div>
            <div className="hidden items-center gap-2 text-[11px] text-kumo-subtle sm:flex">
              <span>example-project</span>
              <span>/</span>
              <span className="text-kumo-default">Issues</span>
              <span>/</span>
              <span className="font-mono text-amber-300">#04bccd</span>
            </div>
          </div>

          <div className="grid gap-6 p-6 lg:grid-cols-[1fr_18rem]">
            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="rounded bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300 ring-1 ring-inset ring-rose-500/30">
                  fatal
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Symbolicated 28 / 28
                </span>
                <span className="rounded border border-kumo-hairline bg-kumo-base px-1.5 py-0.5 font-mono text-[10px] text-kumo-default">
                  release: 3.1+1
                </span>
                <span className="rounded border border-kumo-hairline bg-kumo-base px-1.5 py-0.5 font-mono text-[10px] text-kumo-default">
                  git: db04745
                </span>
              </div>
              <h3 className="mb-1 font-mono text-base font-semibold text-rose-300">
                EXC_BAD_ACCESS · KERN_INVALID_ADDRESS
              </h3>
              <p className="mb-5 text-sm text-kumo-default">
                Attempted to dereference null pointer
              </p>
              <ul className="overflow-hidden rounded-lg border border-kumo-hairline bg-kumo-recessed">
                <DemoFrame
                  fn="UoAApp.ContentView.body.getter"
                  loc="Sources/ContentView.swift:142"
                  crashed
                />
                <DemoFrame
                  fn="UoAApp.HomeScreen.refresh()"
                  loc="Sources/HomeScreen.swift:86"
                />
                <DemoFrame
                  fn="UoAApp.APIClient.fetchEvents()"
                  loc="Sources/Network/APIClient.swift:204"
                />
                <DemoFrame
                  fn="SwiftUI.ViewBuilder.buildBlock"
                  loc="SwiftUI.ViewBuilder:48"
                  system
                />
                <DemoFrame
                  fn="UIKit.UIApplication.sendEvent"
                  loc="UIApplication.m:1024"
                  system
                />
              </ul>

              {/* Breadcrumbs */}
              <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.16em] text-kumo-subtle">
                Breadcrumbs
              </p>
              <ul className="mt-2 space-y-1 font-mono text-[11px]">
                {[
                  { t: "12:14:58", k: "navigation", c: "→ /home", tone: "sky" },
                  {
                    t: "12:15:02",
                    k: "http",
                    c: "GET /api/events  200  142ms",
                    tone: "emerald",
                  },
                  {
                    t: "12:15:09",
                    k: "ui.tap",
                    c: "RefreshButton",
                    tone: "violet",
                  },
                  {
                    t: "12:15:09",
                    k: "fatal",
                    c: "EXC_BAD_ACCESS",
                    tone: "rose",
                  },
                ].map((b, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 rounded border border-kumo-hairline/60 bg-kumo-base/50 px-2.5 py-1.5"
                  >
                    <span className="text-kumo-subtle">{b.t}</span>
                    <span
                      className={`rounded px-1.5 py-px text-[9px] uppercase tracking-wider ${
                        b.tone === "rose"
                          ? "bg-rose-500/15 text-rose-300"
                          : b.tone === "emerald"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : b.tone === "sky"
                              ? "bg-sky-500/15 text-sky-300"
                              : "bg-violet-500/15 text-violet-300"
                      }`}
                    >
                      {b.k}
                    </span>
                    <span className="truncate text-kumo-default">{b.c}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Right sidebar */}
            <div className="space-y-3">
              <DemoSidebarBox title="Events (24h)">
                <div className="flex h-14 items-end gap-0.5">
                  {[2, 4, 1, 6, 8, 3, 5, 7, 12, 9, 4, 6, 8, 11, 14, 9, 6, 4, 7, 5, 3, 2, 4, 6].map((h, i) => (
                    <span
                      key={i}
                      className="flex-1 rounded-sm"
                      style={{
                        height: `${(h / 14) * 100}%`,
                        background: `linear-gradient(180deg, rgba(245,158,11,${0.3 + h / 30}), rgba(245,158,11,0.15))`,
                      }}
                    />
                  ))}
                </div>
                <p className="mt-2 font-mono text-[10px] tabular-nums text-kumo-subtle">
                  146 events · peak 14/h
                </p>
              </DemoSidebarBox>
              <DemoSidebarBox title="Assignee">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-rose-500 text-[10px] font-bold text-zinc-950">
                    Y
                  </span>
                  <p className="font-mono text-[11px] text-kumo-default">@you</p>
                </div>
              </DemoSidebarBox>
              <DemoSidebarBox title="First / Last seen">
                <p className="font-mono text-[10px] text-kumo-subtle">
                  Jun 14 09:34
                </p>
                <p className="font-mono text-[10px] text-amber-400">
                  Jun 14 12:16
                </p>
              </DemoSidebarBox>
              <DemoSidebarBox title="Environment">
                <ul className="space-y-1 font-mono text-[10px] text-kumo-default">
                  <li className="flex justify-between">
                    <span className="text-kumo-subtle">os</span>iOS 17.4
                  </li>
                  <li className="flex justify-between">
                    <span className="text-kumo-subtle">device</span>iPhone 15 Pro
                  </li>
                  <li className="flex justify-between">
                    <span className="text-kumo-subtle">locale</span>ja-JP
                  </li>
                </ul>
              </DemoSidebarBox>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

function DemoFrame(props: {
  fn: string;
  loc: string;
  crashed?: boolean;
  system?: boolean;
}) {
  return (
    <li
      className={`flex items-center justify-between gap-4 border-l-2 px-3 py-2 ${
        props.crashed
          ? "border-amber-500 bg-amber-500/[0.10]"
          : props.system
            ? "border-transparent"
            : "border-amber-500/40"
      } ${props.system ? "" : "border-t border-t-kumo-hairline first:border-t-0"}`}
    >
      <span
        className={`truncate font-mono text-[12px] ${
          props.system ? "text-kumo-subtle" : "font-medium text-kumo-default"
        }`}
      >
        {props.fn}
      </span>
      <span
        className={`shrink-0 font-mono text-[10px] ${
          props.system
            ? "text-kumo-subtle"
            : "text-amber-400 underline decoration-amber-500/40 decoration-dotted underline-offset-2"
        }`}
      >
        {props.loc}
      </span>
    </li>
  );
}

function DemoSidebarBox(props: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-kumo-hairline bg-kumo-recessed p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-kumo-subtle">
        {props.title}
      </p>
      {props.children}
    </div>
  );
}

// ── How it works ───────────────────────────────────────────────────────────

function HowItWorks() {
  const nodes: Array<{
    id: string;
    label: string;
    sub: string;
    tone: HueName;
  }> = [
    { id: "sdk", label: "SDK", sub: "Sentry envelope", tone: "amber" },
    { id: "ingest", label: "Ingest", sub: "Worker", tone: "sky" },
    { id: "queue", label: "Queue", sub: "decouple spikes", tone: "violet" },
    { id: "do", label: "Durable Object", sub: "per-project DB", tone: "rose" },
    { id: "r2", label: "R2", sub: "payload + dSYM", tone: "emerald" },
    { id: "container", label: "Container", sub: "llvm-symbolizer", tone: "amber" },
    { id: "pages", label: "Pages", sub: "SSR dashboard", tone: "sky" },
  ];

  const toneRing = (t: HueName) =>
    ({
      amber: "ring-amber-500/40 bg-amber-500/[0.08] text-amber-300",
      sky: "ring-sky-500/40 bg-sky-500/[0.08] text-sky-300",
      emerald: "ring-emerald-500/40 bg-emerald-500/[0.08] text-emerald-300",
      violet: "ring-violet-500/40 bg-violet-500/[0.08] text-violet-300",
      rose: "ring-rose-500/40 bg-rose-500/[0.08] text-rose-300",
    })[t];

  return (
    <Section id="architecture" className="pb-32">
      <Eyebrow tone="violet">Architecture</Eyebrow>
      <SectionHeading
        sub="Cloudflare の 1 アカウント内で完結するパイプライン。ボトルネックも単一障害点も無く、スパイクも捕り逃さない。"
      >
        全てのコンポーネントが Cloudflare の上。
      </SectionHeading>

      <div className="relative overflow-hidden rounded-2xl border border-kumo-hairline bg-kumo-recessed/40 p-6 backdrop-blur sm:p-10">
        {/* Animated SVG flow lines behind the nodes */}
        <svg
          aria-hidden="true"
          viewBox="0 0 1000 320"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full opacity-40"
        >
          <defs>
            <linearGradient id="flowGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0" />
              <stop offset="20%" stopColor="#f59e0b" stopOpacity="0.7" />
              <stop offset="80%" stopColor="#a855f7" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M 0 160 Q 250 60 500 160 T 1000 160"
            stroke="url(#flowGrad)"
            strokeWidth="1.5"
            fill="none"
          />
          <path
            d="M 0 200 Q 250 280 500 200 T 1000 200"
            stroke="url(#flowGrad)"
            strokeWidth="1"
            fill="none"
            opacity="0.6"
          />
          <path
            d="M 0 120 Q 250 40 500 120 T 1000 120"
            stroke="url(#flowGrad)"
            strokeWidth="0.8"
            fill="none"
            opacity="0.4"
          />
        </svg>

        <div className="relative grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {nodes.map((n, i) => (
            <div
              key={n.id}
              className={`relative flex flex-col rounded-xl bg-kumo-canvas/90 p-3.5 ring-1 ring-inset backdrop-blur ${toneRing(n.tone)}`}
            >
              <span className="font-mono text-[10px] tabular-nums opacity-70">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="mt-1 text-sm font-semibold text-kumo-default">
                {n.label}
              </span>
              <span className="mt-0.5 text-[11px] leading-relaxed text-kumo-subtle">
                {n.sub}
              </span>
            </div>
          ))}
        </div>

        <div className="relative mt-8 grid gap-4 text-[13px] leading-relaxed text-kumo-subtle md:grid-cols-2">
          <div className="rounded-xl border border-kumo-hairline/60 bg-kumo-canvas/60 p-5">
            <p className="mb-1.5 text-sm font-semibold text-kumo-default">
              データロス無し
            </p>
            <p>
              ingest → Queue → consumer の 3 段で瞬間スパイクが来ても 1 件も落とさない。
              R2 への書き込み失敗時は自動 retry、限度超えは DLQ へ。
            </p>
          </div>
          <div className="rounded-xl border border-kumo-hairline/60 bg-kumo-canvas/60 p-5">
            <p className="mb-1.5 text-sm font-semibold text-kumo-default">
              非同期シンボリケート
            </p>
            <p>
              ack 後に <code className="rounded bg-kumo-base px-1 font-mono text-[12px] text-amber-300">ctx.waitUntil</code>{" "}
              で Container を叩くので、ingest レイテンシは増えない。dSYM が無いフレームは後追いで Re-symbolicate 可能。
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ── DSN Anatomy ────────────────────────────────────────────────────────────

function DsnAnatomy() {
  return (
    <Section className="pb-28">
      <Eyebrow tone="rose">One string, full identity</Eyebrow>
      <SectionHeading
        sub="プロジェクトごとに 1 本だけ発行される秘密キー。SDK と CLI どっちもこれだけで動きます。"
      >
        DSN の構造
      </SectionHeading>

      <div className="overflow-hidden rounded-2xl border border-kumo-hairline bg-kumo-recessed/40 p-8 backdrop-blur sm:p-12">
        <pre
          className="overflow-x-auto text-center font-mono text-base leading-relaxed text-kumo-default sm:text-xl"
          style={{ letterSpacing: "-0.01em" }}
        >
          <span className="text-kumo-subtle">https://</span>
          <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-300 ring-1 ring-inset ring-amber-500/30">
            wana3f73b2b…
          </span>
          <span className="text-kumo-subtle">@</span>
          <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
            ingest.wana.example.com
          </span>
          <span className="text-kumo-subtle">/</span>
          <span className="rounded-md bg-rose-500/15 px-1.5 py-0.5 text-rose-300 ring-1 ring-inset ring-rose-500/30">
            example-project
          </span>
        </pre>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <DsnPart
            color="amber"
            label="publicKey"
            body="プロジェクト固有のシークレット。SDK の Authorization と CLI 認証で使う。"
          />
          <DsnPart
            color="emerald"
            label="ingest host"
            body="Wana が立ってる Cloudflare Worker のホスト。CLI はここから dashboard を自動推定。"
          />
          <DsnPart
            color="rose"
            label="projectId"
            body="Dashboard 上のプロジェクト ID。ルーティングと DO の per-project インスタンスに使う。"
          />
        </div>
      </div>
    </Section>
  );
}

function DsnPart(props: {
  color: "amber" | "emerald" | "rose";
  label: string;
  body: string;
}) {
  const ring = {
    amber: "border-amber-500/30",
    emerald: "border-emerald-500/30",
    rose: "border-rose-500/30",
  }[props.color];
  const text = {
    amber: "text-amber-300",
    emerald: "text-emerald-300",
    rose: "text-rose-300",
  }[props.color];
  return (
    <div className={`rounded-xl border ${ring} bg-kumo-canvas/70 p-5`}>
      <p className={`mb-2 font-mono text-[11px] font-semibold ${text}`}>
        {props.label}
      </p>
      <p className="text-[12.5px] leading-relaxed text-kumo-subtle">
        {props.body}
      </p>
    </div>
  );
}

// ── Comparison Table ──────────────────────────────────────────────────────

function ComparisonTable() {
  const rows: Array<{
    feature: string;
    wana: string | boolean;
    sentry: string | boolean;
    crashlytics: string | boolean;
  }> = [
    { feature: "Drop-in Sentry SDK", wana: true, sentry: true, crashlytics: false },
    { feature: "iOS / Android / Web / Node / RN / Flutter", wana: true, sentry: true, crashlytics: "限定的" },
    { feature: "セルフホスト", wana: "Cloudflare", sentry: "可 (重い)", crashlytics: false },
    { feature: "ストレージは自分の口座", wana: true, sentry: false, crashlytics: false },
    { feature: "dSYM 自動 symbolicate", wana: true, sentry: true, crashlytics: true },
    { feature: "GitHub source linking", wana: true, sentry: true, crashlytics: false },
    { feature: "オープンソース", wana: "MIT", sentry: "BSL", crashlytics: false },
    { feature: "従量課金", wana: "Cloudflare のみ", sentry: "$$$", crashlytics: "無料 (Google ロック)" },
  ];
  const cell = (v: string | boolean): ReactNode => {
    if (v === true)
      return (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
          ✓
        </span>
      );
    if (v === false) return <span className="text-kumo-subtle">—</span>;
    return <span className="font-mono text-[11px] text-kumo-default">{v}</span>;
  };
  return (
    <Section id="compare" className="pb-28">
      <Eyebrow tone="sky">Compare</Eyebrow>
      <SectionHeading sub="同じ問題を解く既存サービスとの相対地。実態は各サービス公式で確認してください。">
        Wana vs Sentry vs Crashlytics
      </SectionHeading>

      <div className="overflow-hidden rounded-2xl border border-kumo-hairline bg-kumo-recessed/40 backdrop-blur">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-kumo-hairline bg-kumo-base/40">
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-kumo-subtle">
                  Feature
                </th>
                <th className="px-5 py-4 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-300">
                  Wana
                </th>
                <th className="px-5 py-4 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-kumo-subtle">
                  Sentry (SaaS)
                </th>
                <th className="px-5 py-4 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-kumo-subtle">
                  Crashlytics
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.feature}
                  className={i % 2 === 0 ? "" : "bg-kumo-base/20"}
                >
                  <td className="px-5 py-3.5 text-kumo-default">{r.feature}</td>
                  <td className="px-5 py-3.5 text-center font-semibold">
                    {cell(r.wana)}
                  </td>
                  <td className="px-5 py-3.5 text-center text-kumo-subtle">
                    {cell(r.sentry)}
                  </td>
                  <td className="px-5 py-3.5 text-center text-kumo-subtle">
                    {cell(r.crashlytics)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-4 text-[11px] text-kumo-subtle">
        ※ Sentry / Crashlytics の機能・料金は 2026 年時点の公開情報。
      </p>
    </Section>
  );
}

// ── Open Source ────────────────────────────────────────────────────────────

function OpenSourceSection() {
  return (
    <Section className="pb-28">
      <div className="relative overflow-hidden rounded-2xl border border-kumo-hairline bg-kumo-recessed/40 p-8 backdrop-blur sm:p-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30"
          style={{
            background:
              "radial-gradient(circle, rgba(139,92,246,0.45), transparent 65%)",
            filter: "blur(40px)",
          }}
        />
        <div className="relative grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
          <div className="max-w-2xl">
            <Eyebrow tone="violet">Open source</Eyebrow>
            <h2
              className="mb-4 text-3xl font-semibold tracking-tight text-kumo-default sm:text-4xl"
              style={{ textWrap: "balance" as const, letterSpacing: "-0.025em" }}
            >
              ベンダーロック無し。
              <br className="hidden sm:block" />
              コードもインフラも自分のもの。
            </h2>
            <p className="text-base leading-relaxed text-kumo-subtle">
              MIT で公開。fork してそのまま自分の Cloudflare に立てれば、
              Wana のホスティングからも独立して動かせます。SDK は Sentry の OSS
              をそのまま使ってるので、SDK 側の逃げ道も常に開いてます。
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row md:flex-col md:items-stretch">
            <a
              href="https://github.com/shakenokirimi12/wana"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2.5 rounded-lg border border-kumo-hairline bg-kumo-canvas/80 px-6 text-sm font-medium text-kumo-default transition-colors hover:border-amber-500/40 hover:text-amber-300"
            >
              <GithubGlyph />
              GitHub
            </a>
            <a
              href="https://www.npmjs.com/package/@wanahq/cli"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-kumo-hairline bg-kumo-canvas/80 px-6 font-mono text-sm font-medium text-kumo-default transition-colors hover:border-amber-500/40 hover:text-amber-300"
            >
              @wanahq/cli
            </a>
          </div>
        </div>
      </div>
    </Section>
  );
}

function GithubGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .297C5.37.297 0 5.67 0 12.297c0 5.302 3.438 9.8 8.205 11.385.6.111.82-.26.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.807 1.305 3.492.997.108-.776.42-1.306.762-1.605-2.665-.305-5.467-1.336-5.467-5.93 0-1.31.467-2.38 1.235-3.221-.135-.302-.54-1.524.105-3.176 0 0 1.005-.322 3.3 1.23.957-.266 1.98-.398 3-.402 1.02.005 2.04.137 3 .403 2.28-1.552 3.285-1.23 3.285-1.23.645 1.652.24 2.874.12 3.176.765.842 1.23 1.91 1.23 3.22 0 4.61-2.805 5.624-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

// ── SDK Grid ───────────────────────────────────────────────────────────────

type Sdk = {
  id: string;
  name: string;
  sub: string;
  install: { label: string; code: string };
  init: { language: string; code: string };
  symbolicate?: "native" | "minify";
};

const SDKS: Sdk[] = [
  {
    id: "cocoa",
    name: "iOS / macOS",
    sub: "Swift · Sentry-Cocoa",
    install: {
      label: "Swift Package Manager",
      code: "https://github.com/getsentry/sentry-cocoa",
    },
    init: {
      language: "swift",
      code: `import Sentry

SentrySDK.start { options in
  options.dsn = "<DSN>"
  options.enableAutoSessionTracking = true
}`,
    },
    symbolicate: "native",
  },
  {
    id: "android",
    name: "Android",
    sub: "Kotlin/Java · sentry-android",
    install: {
      label: "Gradle",
      code: `implementation("io.sentry:sentry-android:7.+")`,
    },
    init: {
      language: "kotlin",
      code: `SentryAndroid.init(context) { options ->
  options.dsn = "<DSN>"
  options.tracesSampleRate = 1.0
}`,
    },
    symbolicate: "native",
  },
  {
    id: "web",
    name: "Web",
    sub: "JavaScript · @sentry/browser",
    install: { label: "npm", code: "npm install @sentry/browser" },
    init: {
      language: "javascript",
      code: `import * as Sentry from "@sentry/browser";

Sentry.init({ dsn: "<DSN>" });`,
    },
    symbolicate: "minify",
  },
  {
    id: "node",
    name: "Node.js",
    sub: "@sentry/node",
    install: { label: "npm", code: "npm install @sentry/node" },
    init: {
      language: "javascript",
      code: `const Sentry = require("@sentry/node");

Sentry.init({ dsn: "<DSN>" });`,
    },
  },
  {
    id: "rn",
    name: "React Native",
    sub: "@sentry/react-native",
    install: {
      label: "Wizard",
      code: "npx @sentry/wizard@latest -i reactNative",
    },
    init: {
      language: "javascript",
      code: `import * as Sentry from "@sentry/react-native";

Sentry.init({ dsn: "<DSN>" });`,
    },
    symbolicate: "native",
  },
  {
    id: "flutter",
    name: "Flutter",
    sub: "sentry_flutter",
    install: { label: "pub", code: "flutter pub add sentry_flutter" },
    init: {
      language: "dart",
      code: `await SentryFlutter.init(
  (options) => options.dsn = "<DSN>",
  appRunner: () => runApp(MyApp()),
);`,
    },
    symbolicate: "native",
  },
  {
    id: "python",
    name: "Python",
    sub: "sentry-sdk",
    install: { label: "pip", code: "pip install sentry-sdk" },
    init: {
      language: "python",
      code: `import sentry_sdk

sentry_sdk.init(dsn="<DSN>")`,
    },
  },
  {
    id: "go",
    name: "Go",
    sub: "sentry-go",
    install: { label: "go get", code: "go get github.com/getsentry/sentry-go" },
    init: {
      language: "go",
      code: `sentry.Init(sentry.ClientOptions{
  Dsn: "<DSN>",
})`,
    },
  },
  {
    id: "rust",
    name: "Rust",
    sub: "sentry crate",
    install: { label: "Cargo", code: `sentry = "0.34"` },
    init: {
      language: "rust",
      code: `let _guard = sentry::init("<DSN>");`,
    },
  },
];

function SdkGrid() {
  return (
    <Section id="sdks" className="scroll-mt-20 pb-28">
      <Eyebrow tone="amber">Pick your SDK</Eyebrow>
      <SectionHeading
        sub="Sentry SDK と完全互換。既存プロジェクトは DSN を差し替えるだけです。"
      >
        全部対応、全部 1 行設定。
      </SectionHeading>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {SDKS.map((sdk) => (
          <SdkCard key={sdk.id} sdk={sdk} />
        ))}
      </div>
      <p className="mt-8 text-center text-[12.5px] text-kumo-subtle">
        他にも Ruby / Java / Unity / Unreal など、すべての Sentry SDK が動きます。
      </p>
    </Section>
  );
}

function SdkCard(props: { sdk: Sdk }) {
  const { sdk } = props;
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-kumo-hairline bg-kumo-recessed/40 p-5 backdrop-blur transition-colors hover:bg-kumo-recessed/60">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-kumo-default">
            {sdk.name}
          </h3>
          <p className="text-[11px] text-kumo-subtle">{sdk.sub}</p>
        </div>
        {sdk.symbolicate === "native" ? (
          <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
            dSYM 推奨
          </span>
        ) : sdk.symbolicate === "minify" ? (
          <span className="shrink-0 rounded-full border border-kumo-hairline bg-kumo-recessed px-2 py-0.5 text-[10px] font-medium text-kumo-subtle">
            sourcemap 推奨
          </span>
        ) : null}
      </div>
      <div className="mb-3">
        <p className="mb-1 text-[10px] uppercase tracking-[0.16em] text-kumo-subtle">
          {sdk.install.label}
        </p>
        <pre className="overflow-x-auto rounded-md border border-kumo-hairline bg-kumo-canvas/80 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-kumo-default">
          {sdk.install.code}
        </pre>
      </div>
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-[0.16em] text-kumo-subtle">
          {sdk.init.language}
        </p>
        <pre className="overflow-x-auto rounded-md border border-kumo-hairline bg-kumo-canvas/80 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-kumo-default">
          {sdk.init.code}
        </pre>
      </div>
    </div>
  );
}

// ── Native symbolicate sub-guide ───────────────────────────────────────────

function NativeGuide() {
  const xcodeScript = [
    `if which wana >/dev/null; then`,
    `  export WANA_DSN="<DSN>"`,
    `  wana upload-dif "$DWARF_DSYM_FOLDER_PATH"`,
    `fi`,
  ].join("\n");
  return (
    <Section className="pb-28">
      <Eyebrow tone="emerald">Native symbolicate</Eyebrow>
      <SectionHeading
        sub="iOS / macOS / Android NDK / RN / Flutter の native フレームは、対応する debug-info を Wana に送らないと関数名が出ません。CLI が build hook 経由で自動化します。"
      >
        dSYM は CLI で自動アップロード。
      </SectionHeading>
      <ol className="space-y-4">
        <Step n={1} title="CLI をインストール">
          <CodeBlock language="sh">{`npm install -g @wanahq/cli`}</CodeBlock>
          <p className="mt-3 text-[12.5px] text-kumo-subtle">
            macOS で Xcode CLT 必須 (UUID 抽出に{" "}
            <code className="rounded bg-kumo-base px-1 font-mono text-amber-300">
              dwarfdump
            </code>{" "}
            を使うため)。
          </p>
        </Step>
        <Step n={2} title="Xcode に Run Script を追加">
          <p className="mb-3 text-[13px] text-kumo-subtle">
            Target → Build Phases →{" "}
            <strong className="font-semibold text-kumo-default">
              + New Run Script Phase
            </strong>{" "}
            ─ Strip Debug Symbols の直後に配置。
          </p>
          <CodeBlock language="sh">{xcodeScript}</CodeBlock>
        </Step>
        <Step n={3} title="ビルドする">
          <p className="text-[13px] text-kumo-subtle">
            これ以降のビルド / Archive で dSYM + git SHA + repo が自動送信。
            ストレージは UUID 単位で常に最新 1 つだけ保持され、古い build の dSYM
            は自動で破棄されます。
          </p>
        </Step>
      </ol>
    </Section>
  );
}

// ── FAQ ────────────────────────────────────────────────────────────────────

function FaqSection() {
  return (
    <Section id="faq" className="pb-28">
      <Eyebrow tone="sky">FAQ</Eyebrow>
      <SectionHeading>よくある質問</SectionHeading>
      <div className="space-y-3">
        <Faq q="Sentry からどれくらい簡単に切り替えできる？">
          <p>
            DSN を差し替えるだけです。Sentry SDK の envelope 形式をそのまま受けるので、
            アプリ側のコードは 1 行も変えなくて OK。
          </p>
        </Faq>
        <Faq q="Cloudflare のどのプランが要る？">
          <p>
            Workers Containers が Workers Paid ($5/月〜) 必須。 D1 / R2 / Queues /
            Pages は無料枠の範囲で十分回ります。 個人プロジェクトなら月数百円〜数千円規模。
          </p>
        </Faq>
        <Faq q="dSYM を Wana 側に置くのが嫌">
          <p>
            UUID 単位で常に最新 1 つだけ。CLI が次のビルドをアップした瞬間に古いものを R2
            から削除します。 シンボリケート結果は別ファイル (symbols.json) に分離保管されるので、
            dSYM 自体は将来的にもっと短い TTL に下げる予定。
          </p>
        </Faq>
        <Faq q="セルフホストできる？">
          <p>
            完全に出来ます。むしろそれがデフォルト。 GitHub から clone →{" "}
            <code className="rounded bg-kumo-base px-1 font-mono text-[12px] text-amber-300">
              wana provision
            </code>{" "}
            →{" "}
            <code className="rounded bg-kumo-base px-1 font-mono text-[12px] text-amber-300">
              wana deploy
            </code>{" "}
            で自分の Cloudflare に立ち上がります。
          </p>
        </Faq>
        <Faq q="GitHub Issues との連携は？">
          <p>
            フレームから GitHub の該当行へ直リンクします (CLI が SHA + repo を送る)。 issue
            双方向同期 / suspect-commit 検出は順次実装中。
          </p>
        </Faq>
      </div>
    </Section>
  );
}

function Faq(props: { q: string; children: ReactNode }) {
  return (
    <details className="group overflow-hidden rounded-xl border border-kumo-hairline bg-kumo-recessed/40 backdrop-blur transition-colors hover:bg-kumo-recessed/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
        <h3 className="text-sm font-semibold text-kumo-default sm:text-base">
          {props.q}
        </h3>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-kumo-hairline text-kumo-subtle transition-transform group-open:rotate-45 group-open:text-amber-300">
          +
        </span>
      </summary>
      <div className="border-t border-kumo-hairline px-5 py-4 text-[13px] leading-relaxed text-kumo-subtle">
        {props.children}
      </div>
    </details>
  );
}

// ── Closing CTA ────────────────────────────────────────────────────────────

function ClosingCta(props: { showSignup: boolean }) {
  if (!props.showSignup) return null;
  return (
    <Section className="pb-20">
      <div className="relative overflow-hidden rounded-3xl border border-kumo-hairline bg-kumo-canvas/60 p-12 text-center backdrop-blur sm:p-16">
        {/* Conic-gradient backdrop */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 opacity-50"
          style={{
            background:
              "conic-gradient(from 180deg at 50% 50%, rgba(245,158,11,0.25), rgba(244,63,94,0.0) 25%, rgba(139,92,246,0.20) 55%, rgba(56,189,248,0.0) 75%, rgba(245,158,11,0.25))",
            filter: "blur(60px)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-px h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(245,158,11,0.6), transparent)",
          }}
        />

        <h2
          className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-kumo-default sm:text-5xl"
          style={{ textWrap: "balance" as const, letterSpacing: "-0.03em" }}
        >
          サインアップ →{" "}
          <span
            className="inline-block bg-clip-text text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(110deg, #fde68a, #f59e0b, #f97316)",
            }}
          >
            DSN コピー
          </span>
          。所要 1 分。
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-base text-kumo-subtle">
          プロジェクトを作って、SDK の DSN を差し替えるだけ。
          Cloudflare のあなたのアカウントで動き始めます。
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/signup"
            className="group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-lg px-7 text-sm font-semibold text-zinc-950 shadow-xl shadow-amber-500/30 transition-all hover:-translate-y-0.5 hover:shadow-amber-500/50"
            style={{
              background:
                "linear-gradient(135deg, #fde68a 0%, #f59e0b 50%, #fb923c 100%)",
            }}
          >
            <span
              aria-hidden="true"
              className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full"
            />
            <span className="relative flex items-center gap-2">
              無料で始める
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
            </span>
          </a>
          <a
            href="/login"
            className="inline-flex h-12 items-center justify-center rounded-lg border border-kumo-hairline bg-kumo-recessed/60 px-6 text-sm font-medium text-kumo-default backdrop-blur transition-colors hover:border-amber-500/40 hover:text-amber-300"
          >
            サインイン
          </a>
        </div>
      </div>
    </Section>
  );
}

// ── Footer ─────────────────────────────────────────────────────────────────

function LandingFooter(props: { showSignup: boolean }) {
  return (
    <footer className="relative mt-12 border-t border-kumo-hairline">
      <div
        className="mx-auto w-full px-5 pb-10 pt-14 sm:px-6"
        style={{ maxWidth: "76rem" }}
      >
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-sm">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 ring-1 ring-amber-500/20">
                <WanaMark size={22} />
              </span>
              <span className="text-base font-semibold tracking-tight text-kumo-default">
                Wana
              </span>
            </div>
            <p className="text-[12.5px] leading-relaxed text-kumo-subtle">
              Cloudflare-native crash reporting. Sentry-compatible. MIT licensed.
              Built on Workers, Containers, R2, Queues, D1 and Pages.
            </p>
          </div>
          <FooterColumn title="Product">
            <FooterLink href="#features">Features</FooterLink>
            <FooterLink href="#sdks">SDK 一覧</FooterLink>
            <FooterLink href="#architecture">Architecture</FooterLink>
            <FooterLink href="#compare">Compare</FooterLink>
            <FooterLink href="/login">Dashboard</FooterLink>
            {props.showSignup ? (
              <FooterLink href="/signup">新規登録</FooterLink>
            ) : null}
          </FooterColumn>
          <FooterColumn title="Developers">
            <FooterLink
              href="https://www.npmjs.com/package/@wanahq/cli"
              external
            >
              @wanahq/cli
            </FooterLink>
            <FooterLink href="https://github.com/getsentry/sentry-cocoa" external>
              Sentry-Cocoa
            </FooterLink>
            <FooterLink href="https://github.com/shakenokirimi12/wana" external>
              GitHub
            </FooterLink>
          </FooterColumn>
          <FooterColumn title="Infrastructure">
            <FooterLink href="https://www.cloudflare.com/" external>
              Cloudflare
            </FooterLink>
            <FooterLink
              href="https://developers.cloudflare.com/containers/"
              external
            >
              Workers Containers
            </FooterLink>
            <FooterLink
              href="https://developers.cloudflare.com/durable-objects/"
              external
            >
              Durable Objects
            </FooterLink>
          </FooterColumn>
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-kumo-hairline pt-6 text-[11px] text-kumo-subtle">
          <span>© 2026 Wana · MIT Licensed</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
            </span>
            Built on Cloudflare
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn(props: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-kumo-subtle">
        {props.title}
      </p>
      <ul className="space-y-2.5 text-[12.5px]">{props.children}</ul>
    </div>
  );
}

function FooterLink(props: {
  href: string;
  children: ReactNode;
  external?: boolean;
}) {
  return (
    <li>
      <a
        href={props.href}
        target={props.external ? "_blank" : undefined}
        rel={props.external ? "noopener noreferrer" : undefined}
        className="text-kumo-default transition-colors hover:text-amber-300"
      >
        {props.children}
      </a>
    </li>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────────

function Step(props: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="relative flex gap-5 overflow-hidden rounded-2xl border border-kumo-hairline bg-kumo-recessed/40 p-6 backdrop-blur">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/40 font-mono text-sm font-semibold tabular-nums text-amber-300"
        style={{
          background:
            "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.03))",
        }}
      >
        {props.n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="mb-3 text-base font-semibold tracking-tight text-kumo-default sm:text-lg">
          {props.title}
        </h3>
        {props.children}
      </div>
    </li>
  );
}

function CodeBlock(props: { children: string; language: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-kumo-hairline bg-kumo-canvas/80 shadow-inner shadow-zinc-950/40">
      <div className="flex items-center justify-between border-b border-kumo-hairline bg-kumo-base/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-kumo-subtle">
        <span>{props.language}</span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500/50" />
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500/50" />
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/50" />
        </span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-kumo-default">
        {props.children}
      </pre>
    </div>
  );
}

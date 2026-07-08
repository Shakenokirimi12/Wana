/**
 * SSR-only chart primitives. No client JS, no islands — pure inline SVG
 * rendered alongside the rest of the page. Inputs come from
 * ProjectDataStore.getEventHistogram() which returns N hourly bins
 * newest-last (so bins[N-1] is the in-progress hour).
 */

type Bucket = { bucketStartMs: number; count: number };

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmtHour(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:00`;
}

function fmtRangeTitle(b: Bucket): string {
  const d = new Date(b.bucketStartMs);
  const e = new Date(b.bucketStartMs + 3600_000);
  return `${pad2(d.getHours())}:00–${pad2(e.getHours())}:00 · ${b.count} event${b.count === 1 ? "" : "s"}`;
}

/**
 * Full-width area chart for the project overview. Shows N hour bars
 * (default 24) with an overlay line. Axes are kept minimal — only the
 * leftmost and rightmost hour labels — so the chart reads well at any width.
 */
export function AreaChart24h({
  buckets,
  height = 140,
}: {
  buckets: Bucket[];
  height?: number;
}) {
  if (buckets.length === 0) return null;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const width = 800;
  const padL = 32;
  const padR = 8;
  const padT = 8;
  const padB = 18;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const barW = plotW / buckets.length;
  const yFor = (n: number): number =>
    padT + plotH - (n / max) * plotH;

  const linePts = buckets
    .map((b, i) => `${padL + i * barW + barW / 2},${yFor(b.count)}`)
    .join(" ");
  // Closed polygon for the area fill (line + back along the x-axis).
  const areaPts =
    `${padL},${padT + plotH} ` +
    linePts +
    ` ${padL + buckets.length * barW},${padT + plotH}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Events per hour, last ${buckets.length} hours`}
      className="block h-full w-full"
    >
      {/* y-axis baseline */}
      <line
        x1={padL}
        x2={width - padR}
        y1={padT + plotH}
        y2={padT + plotH}
        className="stroke-kumo-hairline"
        strokeWidth="1"
      />
      {/* y-axis mid gridline (50%) */}
      <line
        x1={padL}
        x2={width - padR}
        y1={padT + plotH / 2}
        y2={padT + plotH / 2}
        className="stroke-kumo-hairline"
        strokeWidth="0.5"
        strokeDasharray="2 3"
      />
      {/* area fill */}
      <polyline
        points={areaPts}
        fill="rgb(245 158 11 / 0.18)"
        stroke="none"
      />
      {/* line */}
      <polyline
        points={linePts}
        fill="none"
        className="stroke-amber-500"
        strokeWidth="1.5"
      />
      {/* bars (transparent — only for hover title) */}
      {buckets.map((b, i) => (
        <rect
          key={i}
          x={padL + i * barW}
          y={padT}
          width={barW}
          height={plotH}
          fill="transparent"
        >
          <title>{fmtRangeTitle(b)}</title>
        </rect>
      ))}
      {/* y-axis max label */}
      <text
        x={padL - 4}
        y={padT + 4}
        textAnchor="end"
        className="fill-kumo-subtle"
        fontSize="10"
      >
        {max}
      </text>
      <text
        x={padL - 4}
        y={padT + plotH}
        textAnchor="end"
        className="fill-kumo-subtle"
        fontSize="10"
      >
        0
      </text>
      {/* x-axis: leftmost + rightmost hour labels */}
      <text
        x={padL}
        y={height - 4}
        className="fill-kumo-subtle"
        fontSize="10"
      >
        {fmtHour(buckets[0].bucketStartMs)}
      </text>
      <text
        x={width - padR}
        y={height - 4}
        textAnchor="end"
        className="fill-kumo-subtle"
        fontSize="10"
      >
        {fmtHour(buckets[buckets.length - 1].bucketStartMs)}
      </text>
    </svg>
  );
}

/**
 * Tiny inline sparkline — fixed pixel size, intended to sit next to a
 * heading or in a card row. No axis labels; per-bar hover titles only.
 */
export function Sparkline24h({
  buckets,
  width = 120,
  height = 28,
}: {
  buckets: Bucket[];
  width?: number;
  height?: number;
}) {
  if (buckets.length === 0) return null;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const barW = width / buckets.length;
  const yFor = (n: number): number => height - (n / max) * height;

  const linePts = buckets
    .map((b, i) => `${i * barW + barW / 2},${yFor(b.count)}`)
    .join(" ");
  const areaPts =
    `0,${height} ` + linePts + ` ${buckets.length * barW},${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Sparkline, last ${buckets.length} hours`}
      width={width}
      height={height}
      className="inline-block align-middle"
    >
      <polyline points={areaPts} fill="rgb(245 158 11 / 0.18)" stroke="none" />
      <polyline
        points={linePts}
        fill="none"
        className="stroke-amber-500"
        strokeWidth="1.25"
      />
      {buckets.map((b, i) => (
        <rect
          key={i}
          x={i * barW}
          y={0}
          width={barW}
          height={height}
          fill="transparent"
        >
          <title>{fmtRangeTitle(b)}</title>
        </rect>
      ))}
    </svg>
  );
}

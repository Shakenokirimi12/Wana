import type { IssueStatus } from "@wana/types";

/** Default stream matches Sentry: open unresolved issues only. */
export const DEFAULT_ISSUE_STREAM_QUERY = "is:unresolved";

export type IssueStreamFilter =
  | { kind: "all" }
  | { kind: "status"; status: IssueStatus };

export function parseIssueStreamQuery(
  raw: string | undefined
): IssueStreamFilter {
  const q = (raw ?? "").trim();
  if (q === "" || q === DEFAULT_ISSUE_STREAM_QUERY || q === "unresolved") {
    return { kind: "status", status: "unresolved" };
  }
  if (q === "is:all" || q === "all") return { kind: "all" };
  if (q === "is:resolved" || q === "resolved")
    return { kind: "status", status: "resolved" };
  if (q === "is:ignored" || q === "ignored")
    return { kind: "status", status: "ignored" };
  if (q === "is:unresolved") return { kind: "status", status: "unresolved" };
  return { kind: "status", status: "unresolved" };
}

/** Canonical `query` param value for WebSocket client filtering. */
export function issueStreamQueryParam(filter: IssueStreamFilter): string {
  if (filter.kind === "all") return "is:all";
  return `is:${filter.status}`;
}

export function issueStreamTabHref(
  projectId: string,
  filter: IssueStreamFilter
): string {
  const base = `/p/${projectId}`;
  if (filter.kind === "status" && filter.status === "unresolved") return base;
  return `${base}?query=${encodeURIComponent(issueStreamQueryParam(filter))}`;
}

export function isIssueStreamTabActive(
  active: IssueStreamFilter,
  tab: IssueStreamFilter
): boolean {
  if (active.kind !== tab.kind) return false;
  if (active.kind === "all") return true;
  return tab.kind === "status" && active.status === tab.status;
}

/** Sentry-style short relative time (issue stream "Last seen"). */
export function formatIssueStreamRelativeTime(tsMs: number): string {
  const sec = Math.floor((Date.now() - tsMs) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(tsMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Issue detail: absolute timestamp (closer to Sentry event list). */
export function formatIssueDetailTime(tsMs: number): string {
  return new Date(tsMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Tokenize a Sentry-style search bar query into structured filters.
 *
 *   browser:Chrome environment:prod release:v1.2 is:unresolved foo bar
 *   level:error,warning            → tag with multiple OR values
 *   !browser:Chrome                → negation (no event in issue has the tag)
 *   has:release / !has:release     → tag presence / absence
 *   "key":"with space"             → quoted values
 *
 * Same module is reused on the server (Hono route) and inside the live-stream
 * inline JS (project-issues-live.ts), so both paths agree on which issues
 * should currently be visible.
 */

export interface ParsedSearchQuery {
  /** `is:unresolved` etc. — null means no explicit status (defaults to all). */
  status: "unresolved" | "resolved" | "ignored" | "all" | null;
  /** Positive tag filters: each entry = key + at least one accepted value (OR within entry). */
  tagFilters: { key: string; values: string[] }[];
  /** Negative tag filters: matched event-in-issue must NOT exist with these. */
  negTagFilters: { key: string; value: string }[];
  /** Presence requirements: at least one event in the issue must have the tag set. */
  hasKeys: string[];
  /** Absence requirements: no event in the issue has the tag set. */
  negHasKeys: string[];
  /** Free text tokens — matched against issue value / type / culprit (substring). */
  freeText: string[];
}

const KEY_RE = /^[a-z0-9._-]{1,64}$/;
const IS_VALUES = new Set(["unresolved", "resolved", "ignored", "all"]);

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const out: ParsedSearchQuery = {
    status: null,
    tagFilters: [],
    negTagFilters: [],
    hasKeys: [],
    negHasKeys: [],
    freeText: [],
  };
  const tokens = tokenize(raw);
  for (const tok of tokens) {
    let s = tok;
    let neg = false;
    if (s.startsWith("!")) {
      neg = true;
      s = s.slice(1);
    }
    const colonIdx = s.indexOf(":");
    if (colonIdx === -1) {
      if (s) out.freeText.push(s);
      continue;
    }
    const key = s.slice(0, colonIdx).toLowerCase();
    const rawValue = s.slice(colonIdx + 1);
    const value = stripQuotes(rawValue);
    if (!KEY_RE.test(key)) {
      // Treat malformed key:value as plain free text (token preserved).
      out.freeText.push(tok);
      continue;
    }
    if (key === "is") {
      const v = value.toLowerCase();
      if (IS_VALUES.has(v)) out.status = v as ParsedSearchQuery["status"];
      continue;
    }
    if (key === "has") {
      const k = value.toLowerCase();
      if (k && KEY_RE.test(k)) {
        (neg ? out.negHasKeys : out.hasKeys).push(k);
      }
      continue;
    }
    if (!value) continue;
    if (neg) {
      out.negTagFilters.push({ key, value });
    } else {
      // OR within a single key when comma-separated.
      const values = value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (values.length > 0) out.tagFilters.push({ key, values });
    }
  }
  return out;
}

function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = raw.length;
  while (i < n) {
    while (i < n && raw[i] === " ") i++;
    if (i >= n) break;
    let start = i;
    let inQuotes = false;
    while (i < n) {
      const c = raw[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === " " && !inQuotes) break;
      i++;
    }
    if (i > start) tokens.push(raw.slice(start, i));
  }
  return tokens;
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Match a single issue row (with the tag maps of each of its events) against
 * the parsed query. Used for in-memory filtering (live-stream client + the
 * dashboard SSR fallback).
 */
export interface IssueLike {
  status: string;
  value: string;
  type: string;
  culprit: string | null;
  /** All tag maps from every event in this issue. */
  eventTagMaps: Record<string, string>[];
}

export function matchIssue(issue: IssueLike, q: ParsedSearchQuery): boolean {
  if (q.status && q.status !== "all" && issue.status !== q.status) return false;

  if (q.freeText.length > 0) {
    const hay = `${issue.value}\n${issue.type}\n${issue.culprit ?? ""}`.toLowerCase();
    for (const t of q.freeText) {
      if (!hay.includes(t.toLowerCase())) return false;
    }
  }

  // Positive tag filters: at least ONE event must satisfy ALL filters.
  if (q.tagFilters.length > 0 || q.hasKeys.length > 0) {
    const ok = issue.eventTagMaps.some((tags) => {
      for (const tf of q.tagFilters) {
        const got = tags[tf.key];
        if (got == null) return false;
        if (!tf.values.some((v) => v.toLowerCase() === got.toLowerCase())) return false;
      }
      for (const k of q.hasKeys) {
        if (tags[k] == null) return false;
      }
      return true;
    });
    if (!ok) return false;
  }

  // Negation: NO event in the issue may have the value.
  for (const nf of q.negTagFilters) {
    const hit = issue.eventTagMaps.some(
      (tags) =>
        tags[nf.key] != null &&
        tags[nf.key].toLowerCase() === nf.value.toLowerCase()
    );
    if (hit) return false;
  }
  for (const nk of q.negHasKeys) {
    const hit = issue.eventTagMaps.some((tags) => tags[nk] != null);
    if (hit) return false;
  }

  return true;
}

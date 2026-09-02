import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { durableObjectIdForStoredProject } from "@wana/core";
import type { IssueStatus } from "@wana/types";
import type { Env } from "../types";
import { listProjectsForUser, getAccessibleProject } from "../data/access";
import { parseStoredEventPayload } from "../data/event-payload";

const STATUS_VALUES = ["unresolved", "resolved", "ignored"] as const;

async function requireProject(env: Env, userId: string, projectId: string) {
  const project = await getAccessibleProject(env.DB_CONTROL, userId, projectId);
  if (!project) {
    throw new Error(
      `Project "${projectId}" was not found, or you are not a member of its organization.`
    );
  }
  return project;
}

/**
 * `ProjectDataStore.updateIssueStatus`/`addIssueComment` silently no-op (or,
 * for comments, insert an orphaned row — `issue_comments.issue_id` has no
 * FK) when `issueId` doesn't exist, so callers must check existence
 * themselves to avoid reporting success for a typo'd id.
 */
async function requireIssue(
  store: ReturnType<typeof projectStore>,
  projectId: string,
  issueId: string
) {
  const issue = await store.getIssue(issueId);
  if (!issue) {
    throw new Error(`Issue "${issueId}" was not found in project "${projectId}".`);
  }
  return issue;
}

/**
 * Rewrites `is:assigned-to-me` / `assignee:@me` (and their `!`-negated
 * forms) to the caller's real user id — mirrors the dashboard's identical
 * rewrite in apps/dashboard/app/routes/p/index.tsx, since the DO's search
 * grammar (packages/core/src/search-query.ts) has no notion of "me".
 */
function resolveAssignedToMe(query: string, userId: string): string {
  return query
    .replace(/(^|\s)is:assigned-to-me(?=\s|$)/g, `$1assignee:${userId}`)
    .replace(/(^|\s)assignee:@me(?=\s|$)/g, `$1assignee:${userId}`)
    .replace(/(^|\s)!is:assigned-to-me(?=\s|$)/g, `$1!assignee:${userId}`)
    .replace(/(^|\s)!assignee:@me(?=\s|$)/g, `$1!assignee:${userId}`);
}

function projectStore(env: Env, doId: string) {
  const id = durableObjectIdForStoredProject(env.PROJECT_DO, doId);
  return env.PROJECT_DO.get(id);
}

function text(value: unknown) {
  return {
    content: [
      { type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

/** Registers every Wana tool on a fresh per-request `McpServer` instance. */
export function registerTools(server: McpServer, env: Env, userId: string): void {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List every Wana project the caller can access, across all of their organizations.",
    },
    async () => {
      const rows = await listProjectsForUser(env.DB_CONTROL, userId);
      return text(
        rows.map((r) => ({
          projectId: r.id,
          projectName: r.name,
          orgSlug: r.orgSlug,
          orgName: r.orgName,
        }))
      );
    }
  );

  server.registerTool(
    "search_issues",
    {
      title: "Search issues",
      description:
        "Search error issues in a Wana project. Supports Sentry-style search syntax " +
        '(e.g. `is:unresolved TypeError`, `is:assigned-to-me`, `tag:value`).',
      inputSchema: {
        projectId: z.string().describe("Wana project id (see list_projects)"),
        query: z.string().optional().describe("Free-text / Sentry-style search query"),
        status: z.enum(STATUS_VALUES).optional().describe("Filter by issue status"),
        limit: z.number().int().min(1).max(100).default(25),
      },
    },
    async ({ projectId, query, status, limit }) => {
      const project = await requireProject(env, userId, projectId);
      const store = projectStore(env, project.doId);
      const issues = await store.getIssues({
        search: query ? resolveAssignedToMe(query, userId) : query,
        status: status as IssueStatus | undefined,
        limit,
      });
      return text(
        issues.map((i) => ({
          issueId: i.id,
          type: i.type,
          value: i.value,
          culprit: i.culprit,
          status: i.status,
          eventsCount: i.eventsCount,
          firstSeen: i.firstSeen,
          lastSeen: i.lastSeen,
          assigneeUserId: i.assigneeUserId,
        }))
      );
    }
  );

  server.registerTool(
    "get_issue",
    {
      title: "Get issue detail",
      description:
        "Get full detail for one issue: metadata, the latest event's exception/message/tags, " +
        "and its most recent activity timeline (status changes, assignments, comments).",
      inputSchema: {
        projectId: z.string(),
        issueId: z.string(),
      },
    },
    async ({ projectId, issueId }) => {
      const project = await requireProject(env, userId, projectId);
      const store = projectStore(env, project.doId);

      const issue = await requireIssue(store, projectId, issueId);

      const [events, tags, timeline] = await Promise.all([
        store.getEvents(issueId, { limit: 1 }),
        store.getLatestEventTags(issueId),
        store.getIssueTimeline(issueId, 20),
      ]);

      let latestEvent: {
        message: string | null;
        exceptionType: string | null;
        exceptionValue: string | null;
        frames: unknown;
      } | null = null;
      const latest = events[0];
      if (latest) {
        const payloadObj = await env.PAYLOAD_STORAGE.get(latest.r2PayloadKey);
        const raw = payloadObj ? await payloadObj.text() : null;
        const parsed = raw ? parseStoredEventPayload(raw) : null;
        const firstException = parsed?.exception?.values?.[0];
        latestEvent = {
          message: parsed?.message ?? null,
          exceptionType: firstException?.type ?? null,
          exceptionValue: firstException?.value ?? null,
          // Unsymbolicated frames (native dSYM merge is dashboard-only) —
          // still readable for JS/TS stacks and gives an AI agent a
          // starting point for native ones.
          frames: firstException?.stacktrace?.frames ?? null,
        };
      }

      return text({
        issueId: issue.id,
        type: issue.type,
        value: issue.value,
        culprit: issue.culprit,
        status: issue.status,
        eventsCount: issue.eventsCount,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
        assigneeUserId: issue.assigneeUserId,
        tags,
        latestEvent,
        recentActivity: timeline,
      });
    }
  );

  server.registerTool(
    "update_issue_status",
    {
      title: "Update issue status",
      description: "Resolve, ignore, or re-open (unresolved) an issue.",
      inputSchema: {
        projectId: z.string(),
        issueId: z.string(),
        status: z.enum(STATUS_VALUES),
      },
    },
    async ({ projectId, issueId, status }) => {
      const project = await requireProject(env, userId, projectId);
      const store = projectStore(env, project.doId);
      await requireIssue(store, projectId, issueId);
      await store.updateIssueStatus(issueId, status, project.id, userId);
      return text(`Issue ${issueId} set to ${status}.`);
    }
  );

  server.registerTool(
    "add_issue_comment",
    {
      title: "Add issue comment",
      description: "Post a comment on an issue's activity timeline.",
      inputSchema: {
        projectId: z.string(),
        issueId: z.string(),
        body: z.string().min(1).max(4000),
      },
    },
    async ({ projectId, issueId, body }) => {
      const project = await requireProject(env, userId, projectId);
      const store = projectStore(env, project.doId);
      await requireIssue(store, projectId, issueId);
      await store.addIssueComment(issueId, userId, body);
      return text(`Comment added to issue ${issueId}.`);
    }
  );
}

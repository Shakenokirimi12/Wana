// Sentry Envelope Types
export interface EnvelopeHeader {
  event_id?: string;
  sent_at?: string;
  dsn?: string;
  sdk?: {
    name: string;
    version: string;
  };
  trace?: Record<string, unknown>;
}

export interface EnvelopeItemHeader {
  type:
    | "event"
    | "error"
    | "transaction"
    | "session"
    | "sessions"
    | "attachment"
    | "client_report"
    | string;
  length?: number;
  content_type?: string;
}

export interface SentryException {
  type: string;
  value: string;
  module?: string;
  stacktrace?: {
    frames: StackFrame[];
  };
}

export interface StackFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  abs_path?: string;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  in_app?: boolean;
}

export interface Breadcrumb {
  timestamp: number;
  type?: string;
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
  level?: "fatal" | "error" | "warning" | "info" | "debug";
}

export interface SentryEventPayload {
  event_id: string;
  timestamp?: number;
  platform?: string;
  level?: "fatal" | "error" | "warning" | "info" | "debug";
  environment?: string;
  release?: string;
  exception?: {
    values: SentryException[];
  };
  breadcrumbs?: Breadcrumb[];
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: {
    id?: string;
    email?: string;
    username?: string;
    ip_address?: string;
  };
  contexts?: Record<string, unknown>;
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
  };
  /** captureMessage / logger-only events */
  message?: string;
  logger?: string;
}

export interface ParsedEnvelope {
  header: EnvelopeHeader & { event_id: string };
  items: Array<{
    header: EnvelopeItemHeader;
    payload: SentryEventPayload | Record<string, unknown>;
  }>;
}

// Queue Message Types
export interface QueueMessage {
  projectId: string;
  doId: string;
  envelope: ParsedEnvelope;
  receivedAt: number;
}

// Issue & Event Types (Data Plane)
export type IssueStatus = "unresolved" | "resolved" | "ignored";

export interface Issue {
  id: string;
  fingerprint: string;
  type: string;
  value: string;
  status: IssueStatus;
  eventsCount: number;
  firstSeen: number;
  lastSeen: number;
}

export interface Event {
  id: string;
  issueId: string;
  timestamp: number;
  environment: string | null;
  release: string | null;
  r2PayloadKey: string;
}

// Control Plane Types
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: number;
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  doId: string;
}

export interface ApiKey {
  id: string;
  projectId: string;
  keyHash: string;
  hint: string;
  isActive: boolean;
}

// DSN Authentication
export interface ParsedDsn {
  publicKey: string;
  projectId: string;
}

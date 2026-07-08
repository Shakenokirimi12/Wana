/**
 * Seed script for local development
 * Run with: npx wrangler d1 execute wana-control-plane --local --file=./seed.sql
 * (Prefer editing seed.sql; this generator mirrors it for ad-hoc regeneration.)
 */

// Generate a test DSN key and its hash
async function hashDsn(dsn: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(dsn);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function generateSeedSQL() {
  const testDsnKey = "wana_test_key_abc123";
  const keyHash = await hashDsn(testDsnKey);

  const now = Date.now();
  const userId = "user_01";
  const orgId = "org_01";
  const projectId = "proj_01";
  // idFromName key (not arbitrary 64 hex). See durableObjectIdForStoredProject in worker/dashboard.
  const doId = `wana:${projectId}`;

  const sql = `
-- Seed data for local development
-- Test DSN Key: ${testDsnKey}

DELETE FROM api_keys;
DELETE FROM projects;

INSERT OR REPLACE INTO users (id, email, name, created_at, username, email_verified_at)
VALUES ('${userId}', 'dev@example.com', 'Developer', ${now}, 'developer', ${now});

INSERT OR REPLACE INTO organizations (id, slug, name)
VALUES ('${orgId}', 'test-org', 'Test Organization');

INSERT OR REPLACE INTO organization_members (id, org_id, user_id, role)
VALUES ('member_01', '${orgId}', '${userId}', 'owner');

INSERT INTO projects (id, org_id, name, do_id, external_id, created_at)
VALUES ('${projectId}', '${orgId}', 'Wana test project', '${doId}', 100000001, ${now});

INSERT INTO api_keys (id, project_id, key_hash, hint, is_active, created_at)
VALUES ('key_01', '${projectId}', '${keyHash}', 'wana_test_...c123', 1, ${now});
`;

  console.log(sql);
}

generateSeedSQL();

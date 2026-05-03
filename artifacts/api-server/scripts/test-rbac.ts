/**
 * RBAC + cross-org isolation smoke test.
 *
 * Pre-condition: api-server running on http://localhost:8080.
 * Seeds (idempotent) a 2nd organization with an admin user, then asserts:
 *   - reader/editor cannot mutate (403 forbidden, audit_log row written)
 *   - cross-org reads return 404 (not 403)
 *   - cross-org PATCH/DELETE returns 404
 *   - /auth/me includes capabilities[]
 *   - admin can list, but only sees their own org's resources
 */
import {
  db,
  pool,
  organizationsTable,
  usersTable,
  userOrgRolesTable,
  policiesTable,
  rulesTable,
  auditLogTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

const API = process.env.API_URL ?? "http://localhost:8080";
const PWD = "TestPassword123!";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log("  ✓", label); }
  else { fail++; console.log("  ✗", label, detail ?? ""); }
}

interface Session {
  cookie: string;
  csrf: string;
  capabilities: string[];
  user: { id: number; organizationId: number; role: string };
}

async function login(email: string): Promise<Session> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PWD }),
  });
  if (!res.ok) throw new Error(`login ${email} failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  const cookies = setCookie.map((c) => c.split(";")[0]).join("; ");
  const csrfMatch = cookies.match(/(?:^|; )csrf=([^;]+)/);
  if (!csrfMatch) throw new Error(`no csrf cookie for ${email}`);
  const me = await fetch(`${API}/api/auth/me`, { headers: { cookie: cookies } });
  const meBody = await me.json();
  return {
    cookie: cookies,
    csrf: decodeURIComponent(csrfMatch[1]),
    capabilities: meBody.capabilities ?? [],
    user: meBody.user,
  };
}

async function call(s: Session, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: {
      cookie: s.cookie,
      "Content-Type": "application/json",
      "x-csrf-token": s.csrf,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

async function findOrInsert<T extends { id: number }>(
  rows: T[],
  insert: () => Promise<T[]>,
): Promise<T> {
  if (rows.length > 0) return rows[0];
  const inserted = await insert();
  return inserted[0];
}

async function ensureSeed() {
  const hash = await bcrypt.hash(PWD, 12);

  const orgRow = await findOrInsert(
    await db.select().from(organizationsTable).where(eq(organizationsTable.name, "Globex Test Co")),
    () => db.insert(organizationsTable)
      .values({ name: "Globex Test Co", description: "rbac test fixture", industry: "Test" })
      .returning(),
  );

  const bAdmin = await ensureUser(orgRow.id, "Bob Globex", "bob.globex@globex.example", "admin", hash);
  const aEditor = await ensureUser(4, "Eve Editor", "eve.editor@acme.example", "editor", hash);
  const aReader = await ensureUser(4, "Rita Reader", "rita.reader@acme.example", "reader", hash);
  // (Re-)set Diana's password so the test is robust against prior seed state.
  await db.execute(sql`update user_passwords set hash = ${hash} where user_id = (select id from users where email = 'diana.park@acme.example')`);

  const bPolicy = await findOrInsert(
    await db.select().from(policiesTable).where(eq(policiesTable.name, "Globex Travel Policy")),
    () => db.insert(policiesTable)
      .values({ organizationId: orgRow.id, name: "Globex Travel Policy", domain: "Expense", status: "draft", version: 1 })
      .returning(),
  );

  const bRule = await findOrInsert(
    await db.select().from(rulesTable).where(eq(rulesTable.name, "Globex hotel cap")),
    () => db.insert(rulesTable).values({
      policyId: bPolicy.id,
      name: "Globex hotel cap",
      priority: 10,
      status: "draft",
      version: 1,
      outcome: "approved",
      naturalLanguageText: "Hotels under $300/night ok.",
      structuredRepresentation: { kind: "threshold", field: "hotel", operator: "<=", value: 300 },
    }).returning(),
  );

  return {
    orgB: orgRow,
    bAdminEmail: bAdmin.email,
    aEditorEmail: aEditor.email,
    aReaderEmail: aReader.email,
    bPolicyId: bPolicy.id,
    bRuleId: bRule.id,
  };
}

async function ensureUser(orgId: number, name: string, email: string, role: "admin"|"editor"|"approver"|"reader", hash: string) {
  const row = await findOrInsert(
    await db.select().from(usersTable).where(eq(usersTable.email, email)),
    () => db.insert(usersTable)
      .values({ organizationId: orgId, name, email, role, emailVerifiedAt: new Date() })
      .returning(),
  );
  await db.execute(sql`insert into user_passwords (user_id, hash) values (${row.id}, ${hash}) on conflict (user_id) do update set hash = excluded.hash`);
  await db.insert(userOrgRolesTable).values({ userId: row.id, organizationId: orgId, role }).onConflictDoNothing();
  return row;
}

async function main() {
  console.log(`API: ${API}`);
  const seed = await ensureSeed();

  console.log("\n[1] login + /auth/me capabilities");
  const aAdmin = await login("diana.park@acme.example");
  const aEditor = await login(seed.aEditorEmail);
  const aReader = await login(seed.aReaderEmail);
  const bAdmin = await login(seed.bAdminEmail);
  check("admin has policy.publish", aAdmin.capabilities.includes("policy.publish"));
  check("editor lacks policy.publish", !aEditor.capabilities.includes("policy.publish"));
  check("reader lacks policy.create", !aReader.capabilities.includes("policy.create"));
  check("reader has policy.read", aReader.capabilities.includes("policy.read"));
  check("orgs differ", aAdmin.user.organizationId !== bAdmin.user.organizationId);

  console.log("\n[2] cross-org isolation (Acme admin probing Globex resources)");
  const r1 = await call(aAdmin, "GET", `/policies/${seed.bPolicyId}`);
  check(`GET cross-org policy → 404 (got ${r1.status})`, r1.status === 404);
  const r2 = await call(aAdmin, "PATCH", `/policies/${seed.bPolicyId}`, { name: "hijack" });
  check(`PATCH cross-org policy → 404 (got ${r2.status})`, r2.status === 404);
  const r3 = await call(aAdmin, "DELETE", `/policies/${seed.bPolicyId}`);
  check(`DELETE cross-org policy → 404 (got ${r3.status})`, r3.status === 404);
  const r4 = await call(aAdmin, "GET", `/rules/${seed.bRuleId}`);
  check(`GET cross-org rule → 404 (got ${r4.status})`, r4.status === 404);
  const r5 = await call(aAdmin, "POST", `/rules/${seed.bRuleId}/publish`);
  check(`POST cross-org rule.publish → 404 (got ${r5.status})`, r5.status === 404);
  const r6 = await call(aAdmin, "GET", `/users`);
  const acmeOnly = Array.isArray(r6.body) && r6.body.every((u: any) => u.organizationId === aAdmin.user.organizationId);
  check(`GET /users only returns own-org users (count=${r6.body?.length})`, acmeOnly);

  console.log("\n[3] role gating within Acme");
  const r7 = await call(aReader, "POST", `/policies`, { name: "rdr-attempt", domain: "Expense", description: null });
  check(`reader POST /policies → 403 (got ${r7.status}, action=${r7.body?.action})`, r7.status === 403 && r7.body?.action === "policy.create");
  const r8 = await call(aEditor, "POST", `/policies`, { name: "ed-draft-" + Date.now(), domain: "Expense", description: null });
  check(`editor POST /policies → 201 (got ${r8.status})`, r8.status === 201);
  const newPolicyId = r8.body?.id;
  if (newPolicyId) {
    const r9 = await call(aEditor, "POST", `/policies/${newPolicyId}/publish`);
    check(`editor publish own draft → 403 (got ${r9.status}, action=${r9.body?.action})`, r9.status === 403 && r9.body?.action === "policy.publish");
    const r10 = await call(aAdmin, "POST", `/policies/${newPolicyId}/publish`);
    check(`admin publish that draft → 200 (got ${r10.status})`, r10.status === 200);
    await call(aAdmin, "DELETE", `/policies/${newPolicyId}`); // cleanup
  }

  const r11 = await call(aReader, "POST", `/users`, { organizationId: aAdmin.user.organizationId, name: "x", email: "x@y.z", role: "reader" });
  check(`reader invite user → 403 (got ${r11.status}, action=${r11.body?.action})`, r11.status === 403 && r11.body?.action === "user.invite");

  console.log("\n[4] audit_log writes");
  const auditCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogTable);
  const denials = await db.execute(sql`select action, result, organization_id from audit_log where actor_user_id = ${aReader.user.id} and result = 'denied' order by created_at desc limit 5`);
  check(`audit_log has rows (total=${auditCount[0].count})`, auditCount[0].count > 0);
  check(`reader denials recorded (count=${denials.rows.length})`, denials.rows.length >= 2);

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

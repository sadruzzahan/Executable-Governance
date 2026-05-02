import {
  db,
  organizationsTable,
  policiesTable,
  rulesTable,
  ruleVersionsTable,
  usersTable,
  userOrgRolesTable,
  pool,
} from "@workspace/db";

async function main() {
  console.log("Clearing existing data...");
  await db.delete(userOrgRolesTable);
  await db.delete(ruleVersionsTable);
  await db.delete(rulesTable);
  await db.delete(policiesTable);
  await db.delete(usersTable);
  await db.delete(organizationsTable);

  console.log("Seeding organization...");
  const [acme] = await db
    .insert(organizationsTable)
    .values([
      {
        name: "Acme Corp",
        description: "Mid-size manufacturing conglomerate. Sample tenant for the Executable Governance demo.",
        industry: "Manufacturing",
      },
    ])
    .returning();

  console.log("Seeding users...");
  const [admin, editor] = await db
    .insert(usersTable)
    .values([
      { organizationId: acme.id, name: "Diana Park", email: "diana.park@acme.example", role: "admin" },
      { organizationId: acme.id, name: "Priya Nair", email: "priya.nair@acme.example", role: "editor" },
    ])
    .returning();

  console.log("Seeding user org roles...");
  await db.insert(userOrgRolesTable).values([
    { userId: admin.id, organizationId: acme.id, role: "admin" },
    { userId: editor.id, organizationId: acme.id, role: "editor" },
  ]);

  console.log("Seeding policy...");
  const [expensePolicy] = await db
    .insert(policiesTable)
    .values([
      {
        organizationId: acme.id,
        name: "Expense Policy",
        description: "Company-wide expense policy: travel, meals, lodging, and ad-hoc reimbursements.",
        domain: "Expense",
        status: "published",
        version: 2,
      },
    ])
    .returning();

  console.log("Seeding rules...");
  const ruleSpecs = [
    {
      policyId: expensePolicy.id,
      name: "Hotel cap per night",
      priority: 10,
      status: "published" as const,
      version: 2,
      outcome: "approved" as const,
      naturalLanguageText:
        "Hotel charges up to $250 per night are approved for any domestic city. Charges above $250 require manager approval.",
      structuredRepresentation: {
        kind: "threshold",
        field: "hotel_per_night",
        operator: "<=",
        value: 250,
        currency: "USD",
        scope: "domestic",
      },
    },
    {
      policyId: expensePolicy.id,
      name: "International hotel cap",
      priority: 11,
      status: "published" as const,
      version: 1,
      outcome: "needs_review" as const,
      naturalLanguageText:
        "International hotels above $400 per night require VP approval and a written travel justification.",
      structuredRepresentation: {
        kind: "threshold",
        field: "hotel_per_night",
        operator: ">",
        value: 400,
        currency: "USD",
        scope: "international",
      },
    },
    {
      policyId: expensePolicy.id,
      name: "Per-diem meals cap",
      priority: 20,
      status: "published" as const,
      version: 2,
      outcome: "approved" as const,
      naturalLanguageText:
        "Daily per-diem of $75 covers all meals during travel. Amounts over per-diem are denied unless pre-approved.",
      structuredRepresentation: {
        kind: "threshold",
        field: "daily_meal_total",
        operator: "<=",
        value: 75,
        currency: "USD",
      },
    },
    {
      policyId: expensePolicy.id,
      name: "Client dinner cap per head",
      priority: 21,
      status: "published" as const,
      version: 1,
      outcome: "approved" as const,
      naturalLanguageText:
        "Client dinners up to $120 per attendee are approved. Above $120 per head requires director sign-off.",
      structuredRepresentation: {
        kind: "threshold",
        field: "dinner_per_head",
        operator: "<=",
        value: 120,
        currency: "USD",
        scope: "client_entertainment",
      },
    },
    {
      policyId: expensePolicy.id,
      name: "Airfare class restriction",
      priority: 30,
      status: "published" as const,
      version: 1,
      outcome: "denied" as const,
      naturalLanguageText:
        "Business class airfare is denied for flights under 6 hours. Premium economy is permitted instead.",
      structuredRepresentation: {
        kind: "conditional",
        field: "flight_duration_hours",
        operator: "<",
        value: 6,
        denied_class: "business",
      },
    },
    {
      policyId: expensePolicy.id,
      name: "Rideshare cap",
      priority: 40,
      status: "published" as const,
      version: 1,
      outcome: "approved" as const,
      naturalLanguageText:
        "Single rideshare trips up to $80 are approved. Above $80 requires receipt with itinerary.",
      structuredRepresentation: {
        kind: "threshold",
        field: "rideshare_trip",
        operator: "<=",
        value: 80,
        currency: "USD",
      },
    },
    {
      policyId: expensePolicy.id,
      name: "Receipt required threshold",
      priority: 50,
      status: "draft" as const,
      version: 1,
      outcome: "needs_review" as const,
      naturalLanguageText:
        "Any individual expense above $25 requires an itemized receipt. Submissions without receipts are sent back for review.",
      structuredRepresentation: {
        kind: "threshold",
        field: "expense_amount",
        operator: ">",
        value: 25,
        currency: "USD",
        requires: ["itemized_receipt"],
      },
    },
  ];

  const insertedRules = await db.insert(rulesTable).values(ruleSpecs).returning();

  console.log("Seeding rule versions...");
  const versionRows = insertedRules.flatMap((r) => {
    const versions = [];
    for (let v = 1; v <= r.version; v++) {
      versions.push({
        ruleId: r.id,
        version: v,
        naturalLanguageText: v === r.version ? r.naturalLanguageText : `[v${v}] ${r.naturalLanguageText}`,
        structuredRepresentation: r.structuredRepresentation,
        outcome: r.outcome,
        changedBy: v === 1 ? "system" : "Diana Park",
        changeNote: v === 1 ? "Initial version" : "Quarterly review revision",
      });
    }
    return versions;
  });
  await db.insert(ruleVersionsTable).values(versionRows);

  console.log(
    `Done. Seeded 1 organization (Acme Corp), 1 policy (Expense Policy), ${insertedRules.length} rules, 2 users.`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

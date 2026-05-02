import { db, organizationsTable, policiesTable, rulesTable, ruleVersionsTable, usersTable, pool } from "@workspace/db";

async function main() {
  console.log("Clearing existing data...");
  await db.delete(ruleVersionsTable);
  await db.delete(rulesTable);
  await db.delete(policiesTable);
  await db.delete(usersTable);
  await db.delete(organizationsTable);

  console.log("Seeding organizations...");
  const [acme, helio, northwind] = await db.insert(organizationsTable).values([
    { name: "Acme Industries", description: "Mid-size manufacturing conglomerate", industry: "Manufacturing" },
    { name: "Helio Health", description: "Regional healthcare network", industry: "Healthcare" },
    { name: "Northwind Software", description: "B2B SaaS company, 800 employees", industry: "Technology" },
  ]).returning();

  console.log("Seeding users...");
  await db.insert(usersTable).values([
    { organizationId: acme.id, name: "Diana Park", email: "diana.park@acme.example", role: "admin" },
    { organizationId: acme.id, name: "Marcus Webb", email: "marcus.webb@acme.example", role: "approver" },
    { organizationId: acme.id, name: "Priya Nair", email: "priya.nair@acme.example", role: "editor" },
    { organizationId: acme.id, name: "Tomás Rivera", email: "tomas.rivera@acme.example", role: "reader" },
    { organizationId: helio.id, name: "Elena Sokolov", email: "elena.sokolov@helio.example", role: "admin" },
    { organizationId: helio.id, name: "Jamal Reed", email: "jamal.reed@helio.example", role: "approver" },
    { organizationId: helio.id, name: "Aisha Khan", email: "aisha.khan@helio.example", role: "editor" },
    { organizationId: northwind.id, name: "Henrik Lund", email: "henrik.lund@northwind.example", role: "admin" },
    { organizationId: northwind.id, name: "Wei Zhang", email: "wei.zhang@northwind.example", role: "approver" },
    { organizationId: northwind.id, name: "Olivia Brennan", email: "olivia.brennan@northwind.example", role: "editor" },
  ]);

  console.log("Seeding policies...");
  const [acmeTravel, acmeMeals, acmeSoftware, helioTravel, helioPpe, northwindTravel, northwindClient] = await db.insert(policiesTable).values([
    { organizationId: acme.id, name: "Travel & Lodging Policy", description: "Governs all employee business travel and lodging reimbursements.", domain: "Expense", status: "published", version: 4 },
    { organizationId: acme.id, name: "Meals & Entertainment Policy", description: "Per-diem and client entertainment guidelines.", domain: "Expense", status: "published", version: 2 },
    { organizationId: acme.id, name: "Software & Subscriptions Policy", description: "Approval workflow for SaaS purchases under $10K.", domain: "Procurement", status: "draft", version: 1 },
    { organizationId: helio.id, name: "Clinical Travel Policy", description: "Travel reimbursements for clinical staff and conferences.", domain: "Expense", status: "published", version: 3 },
    { organizationId: helio.id, name: "PPE Procurement Policy", description: "Standards for personal protective equipment purchases.", domain: "Procurement", status: "draft", version: 1 },
    { organizationId: northwind.id, name: "Engineering Travel Policy", description: "Travel rules for engineering team offsites and conferences.", domain: "Expense", status: "published", version: 5 },
    { organizationId: northwind.id, name: "Client Entertainment Policy", description: "Limits on client dinners and event spending.", domain: "Expense", status: "archived", version: 2 },
  ]).returning();

  console.log("Seeding rules...");
  const ruleSpecs = [
    // Acme Travel
    { policyId: acmeTravel.id, name: "Hotel cap per night", priority: 10, status: "published" as const, version: 3, outcome: "approved" as const,
      naturalLanguageText: "Hotel charges up to $250 per night are approved for any domestic city. Charges above $250 require manager approval.",
      structuredRepresentation: { kind: "threshold", field: "hotel_per_night", operator: "<=", value: 250, currency: "USD", scope: "domestic" } },
    { policyId: acmeTravel.id, name: "International hotel cap", priority: 11, status: "published" as const, version: 2, outcome: "needs_review" as const,
      naturalLanguageText: "International hotels above $400 per night require VP approval and a travel justification memo.",
      structuredRepresentation: { kind: "threshold", field: "hotel_per_night", operator: ">", value: 400, currency: "USD", scope: "international", requires: ["vp_approval", "justification_memo"] } },
    { policyId: acmeTravel.id, name: "Airfare class", priority: 20, status: "published" as const, version: 4, outcome: "denied" as const,
      naturalLanguageText: "Business class airfare is denied for flights under 6 hours. Premium economy is permitted instead.",
      structuredRepresentation: { kind: "conditional", condition: { field: "flight_duration_hours", operator: "<", value: 6 }, denied_class: "business", allowed_alternative: "premium_economy" } },
    { policyId: acmeTravel.id, name: "Weekend stays", priority: 30, status: "draft" as const, version: 1, outcome: "escalated" as const,
      naturalLanguageText: "If a weekend stay is added to extend a trip and the total cost exceeds the weekday-only cost by more than $300, escalate to finance.",
      structuredRepresentation: { kind: "comparison", base: "weekday_only_cost", actual: "total_trip_cost", delta_operator: ">", delta_value: 300 } },

    // Acme Meals
    { policyId: acmeMeals.id, name: "Per-diem cap", priority: 10, status: "published" as const, version: 2, outcome: "approved" as const,
      naturalLanguageText: "Daily per-diem of $75 covers all meals during travel. Over per-diem amounts are denied unless pre-approved.",
      structuredRepresentation: { kind: "threshold", field: "daily_meal_total", operator: "<=", value: 75, currency: "USD" } },
    { policyId: acmeMeals.id, name: "Client dinner cap per head", priority: 20, status: "published" as const, version: 1, outcome: "approved" as const,
      naturalLanguageText: "Client dinners up to $120 per attendee are approved. Above $120 per head requires director sign-off.",
      structuredRepresentation: { kind: "threshold", field: "dinner_per_head", operator: "<=", value: 120, currency: "USD", scope: "client_entertainment" } },
    { policyId: acmeMeals.id, name: "Alcohol expenses", priority: 30, status: "draft" as const, version: 1, outcome: "denied" as const,
      naturalLanguageText: "Alcohol expenses are denied for solo meals. For client meals, alcohol up to 30% of the bill is approved.",
      structuredRepresentation: { kind: "conditional", condition: { field: "meal_type", value: "solo" }, denied_categories: ["alcohol"] } },

    // Acme Software
    { policyId: acmeSoftware.id, name: "SaaS purchase under $1K", priority: 10, status: "draft" as const, version: 1, outcome: "approved" as const,
      naturalLanguageText: "SaaS subscriptions under $1,000 annually can be approved by team leads without procurement review.",
      structuredRepresentation: { kind: "threshold", field: "annual_cost", operator: "<", value: 1000, currency: "USD", approver: "team_lead" } },
    { policyId: acmeSoftware.id, name: "SaaS purchase $1K-$10K", priority: 20, status: "draft" as const, version: 1, outcome: "needs_review" as const,
      naturalLanguageText: "SaaS subscriptions between $1,000 and $10,000 require security review and procurement approval.",
      structuredRepresentation: { kind: "range", field: "annual_cost", min: 1000, max: 10000, currency: "USD", requires: ["security_review", "procurement_approval"] } },

    // Helio Travel
    { policyId: helioTravel.id, name: "Conference registration", priority: 10, status: "published" as const, version: 2, outcome: "approved" as const,
      naturalLanguageText: "Clinical conference registration up to $1,500 is approved for licensed clinicians once per fiscal year.",
      structuredRepresentation: { kind: "threshold", field: "conference_fee", operator: "<=", value: 1500, currency: "USD", role_required: "licensed_clinician", frequency: "annual" } },
    { policyId: helioTravel.id, name: "Hotel cap clinical travel", priority: 20, status: "published" as const, version: 3, outcome: "approved" as const,
      naturalLanguageText: "Hotel rates up to $300 per night are approved for clinical travel within the United States.",
      structuredRepresentation: { kind: "threshold", field: "hotel_per_night", operator: "<=", value: 300, currency: "USD", scope: "domestic" } },
    { policyId: helioTravel.id, name: "Mileage reimbursement", priority: 30, status: "published" as const, version: 1, outcome: "approved" as const,
      naturalLanguageText: "Personal vehicle mileage is reimbursed at the federal IRS standard rate when public transit is not feasible.",
      structuredRepresentation: { kind: "rate", field: "mileage", rate: "irs_standard", condition: "public_transit_not_feasible" } },

    // Helio PPE
    { policyId: helioPpe.id, name: "Approved PPE vendors", priority: 10, status: "draft" as const, version: 1, outcome: "approved" as const,
      naturalLanguageText: "PPE purchases from approved vendors (3M, Honeywell, Kimberly-Clark) are approved without further review.",
      structuredRepresentation: { kind: "allowlist", field: "vendor", allowed: ["3M", "Honeywell", "Kimberly-Clark"] } },

    // Northwind Travel
    { policyId: northwindTravel.id, name: "Engineering offsite cap", priority: 10, status: "published" as const, version: 4, outcome: "approved" as const,
      naturalLanguageText: "Quarterly engineering offsite spend up to $2,500 per attendee is approved without VP review.",
      structuredRepresentation: { kind: "threshold", field: "per_attendee_cost", operator: "<=", value: 2500, currency: "USD", scope: "offsite", frequency: "quarterly" } },
    { policyId: northwindTravel.id, name: "Conference travel", priority: 20, status: "published" as const, version: 3, outcome: "needs_review" as const,
      naturalLanguageText: "Conference travel above $3,000 total cost requires manager approval and a writeup within two weeks of return.",
      structuredRepresentation: { kind: "threshold", field: "total_cost", operator: ">", value: 3000, currency: "USD", requires: ["manager_approval", "post_trip_writeup"] } },
    { policyId: northwindTravel.id, name: "Rideshare cap", priority: 30, status: "published" as const, version: 2, outcome: "approved" as const,
      naturalLanguageText: "Single rideshare trips up to $80 are approved. Above $80 require receipt with itinerary.",
      structuredRepresentation: { kind: "threshold", field: "rideshare_trip", operator: "<=", value: 80, currency: "USD" } },
    { policyId: northwindTravel.id, name: "First-class flight ban", priority: 40, status: "published" as const, version: 1, outcome: "denied" as const,
      naturalLanguageText: "First-class airfare is denied under all circumstances. Business class is permitted only for international flights over 8 hours.",
      structuredRepresentation: { kind: "denylist", field: "flight_class", denied: ["first"], conditional_allowed: { class: "business", condition: "international_over_8h" } } },

    // Northwind Client (archived)
    { policyId: northwindClient.id, name: "Client dinner cap", priority: 10, status: "archived" as const, version: 2, outcome: "approved" as const,
      naturalLanguageText: "Client dinner spending up to $150 per attendee was approved under the legacy policy.",
      structuredRepresentation: { kind: "threshold", field: "dinner_per_head", operator: "<=", value: 150, currency: "USD" } },
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
        changedBy: v === 1 ? "system" : ["Diana Park", "Elena Sokolov", "Henrik Lund"][v % 3],
        changeNote: v === 1 ? "Initial version" : v === r.version ? "Latest revision" : `Revision v${v}`,
      });
    }
    return versions;
  });
  await db.insert(ruleVersionsTable).values(versionRows);

  console.log(`Done. Seeded ${insertedRules.length} rules across 7 policies.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

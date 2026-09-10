/**
 * Demo people for exercising walk attendees.
 *
 *   npx tsx scripts/seed-walk-attendees.ts --add
 *   npx tsx scripts/seed-walk-attendees.ts --remove
 *   npx tsx scripts/seed-walk-attendees.ts            (report only)
 *
 * Every address is @example.com, which RFC 2606 reserves and no mail server
 * will ever deliver to. That matters here: inviting a vendor sends a real
 * email, and seeding a plausible-looking address on a real subcontractor would
 * eventually put a test message in somebody's actual inbox.
 *
 * The profiles are roster rows only. profiles.id is meant to match a Supabase
 * auth user and there is no cross-schema foreign key to enforce it, so these
 * can be assigned to walks and appear everywhere a person appears — but nobody
 * can sign in as them. Creating real auth users is a separate, deliberate act
 * and not something a seed script should do.
 *
 * --remove deletes exactly what --add created, matched on the @example.com
 * domain and the marker below, and clears any walk attendance first.
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

const MARKER = "[demo]";
const DOMAIN = "@example.com";

/** Construction-management staff: the people a CM would put on a walk. */
const TEAM = [
  { name: "Marcus Webb", email: `marcus.webb${DOMAIN}`, role: "cm" },
  { name: "Tanya Ruiz", email: `tanya.ruiz${DOMAIN}`, role: "cm" },
  { name: "Curtis Nolan", email: `curtis.nolan${DOMAIN}`, role: "site" },
  { name: "Priya Raman", email: `priya.raman${DOMAIN}`, role: "site" },
];

/** Trades, each with a contact who can be invited. */
const VENDORS = [
  { vendor: `${MARKER} Brightline Drywall`, contact: "Hector Salas", title: "Foreman" },
  { vendor: `${MARKER} Kestrel Plumbing`, contact: "Dana Whitmore", title: "Service Manager" },
  { vendor: `${MARKER} Ridgeway Electric`, contact: "Sam Okafor", title: "Superintendent" },
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: "require", max: 1 });
  const mode = process.argv.includes("--add")
    ? "add"
    : process.argv.includes("--remove")
      ? "remove"
      : "report";

  if (mode === "add") {
    for (const t of TEAM) {
      await sql`
        insert into profiles (id, email, full_name, role)
        values (${crypto.randomUUID()}, ${t.email}, ${t.name}, ${t.role})
        on conflict do nothing
      `;
    }
    console.log(`team: ${TEAM.length} profile(s) ensured`);

    for (const v of VENDORS) {
      const [vendor] = await sql<{ id: number }[]>`
        insert into vendors (name) values (${v.vendor})
        returning id
      `;
      await sql`
        insert into vendor_contacts (vendor_id, name, title, email, is_primary, active)
        values (${vendor.id}, ${v.contact}, ${v.title},
                ${v.contact.toLowerCase().replace(/[^a-z]+/g, ".") + DOMAIN}, true, true)
        on conflict do nothing
      `;
    }
    console.log(`vendors: ${VENDORS.length} created, each with one contact`);
  }

  if (mode === "remove") {
    // Attendance first: audit_attendees references both.
    const a = await sql`
      delete from audit_attendees
      where profile_id in (select id from profiles where email like ${"%" + DOMAIN})
         or vendor_contact_id in (
              select id from vendor_contacts where email like ${"%" + DOMAIN}
            )
      returning id
    `;
    const c = await sql`
      delete from vendor_contacts where email like ${"%" + DOMAIN} returning id
    `;
    const v = await sql`
      delete from vendors where name like ${MARKER + "%"} returning id
    `;
    const p = await sql`
      delete from profiles where email like ${"%" + DOMAIN} returning id
    `;
    console.log(
      `removed — ${a.length} attendance row(s), ${c.length} contact(s), ${v.length} vendor(s), ${p.length} profile(s)`,
    );
  }

  const team = await sql<{ full_name: string; role: string }[]>`
    select full_name, role from profiles
    where email like ${"%" + DOMAIN} and archived_at is null order by full_name
  `;
  const contacts = await sql<{ name: string; vendor: string }[]>`
    select c.name, v.name as vendor from vendor_contacts c
    join vendors v on v.id = c.vendor_id
    where c.email like ${"%" + DOMAIN} order by v.name
  `;
  console.log(`\ndemo team (${team.length}):`);
  for (const t of team) console.log(`  ${t.full_name} — ${t.role}`);
  console.log(`demo vendor contacts (${contacts.length}):`);
  for (const c of contacts) console.log(`  ${c.name} — ${c.vendor}`);

  await sql.end();
}

main();

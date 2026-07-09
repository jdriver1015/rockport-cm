/**
 * Seeds the master chart of accounts from the Westcreek Cost Code Bank
 * (source: "Retreat at Westpark - Construction Tracker.xlsx").
 *
 * Run: npm run db:seed
 * Idempotent — safe to re-run; existing codes are left untouched.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { costCategories, costCodes } from "./schema";

const CATEGORIES: { code: string; name: string }[] = [
  { code: "1000", name: "Exterior Paint / Carpentry" },
  { code: "1100", name: "Roof" },
  { code: "1200", name: "New Windows" },
  { code: "1300", name: "General Exterior Repairs" },
  { code: "1400", name: "Lighting Enhancements" },
  { code: "1500", name: "Parking Lot Repairs" },
  { code: "1600", name: "Clubhouse Upgrades" },
  { code: "1700", name: "Signage" },
  { code: "1800", name: "Pool" },
  { code: "1900", name: "Landscaping" },
  { code: "2000", name: "General Amenities" },
  { code: "3000", name: "Misc / Fees" },
  { code: "4000", name: "Interiors" },
];

const CODES: { code: string; name: string }[] = [
  { code: "1000-0001", name: "Exterior Paint" },
  { code: "1000-0002", name: "Carpentry Repairs" },
  { code: "1000-0003", name: "Carpentry Adds" },
  { code: "1100-0001", name: "Roofing Repair" },
  { code: "1100-0002", name: "Gutter Repair" },
  { code: "1100-0003", name: "Gutter Clean" },
  { code: "1200-0001", name: "Window Replacements" },
  { code: "1200-0002", name: "Window Repairs" },
  { code: "1300-0001", name: "Site Drainage" },
  { code: "1300-0002", name: "Sidewalk Repairs/Replace" },
  { code: "1300-0003", name: "Dumpster Enclosures" },
  { code: "1300-0004", name: "Stair Treads Repairs/Replace" },
  { code: "1300-0005", name: "Stair Railings Repair/Replace" },
  { code: "1300-0006", name: "Stair Landing Repairs" },
  { code: "1300-0007", name: "Replace Masonry Walls" },
  { code: "1300-0008", name: "Masonry Tuck and Point" },
  { code: "1300-0009", name: "Balcony Enclosures" },
  { code: "1300-0010", name: "Foundation Repairs" },
  { code: "1400-0001", name: "LED Retrofit" },
  { code: "1500-0001", name: "Parking Lot Paving Repair/Replace" },
  { code: "1500-0002", name: "Parking Lot Sealcoat" },
  { code: "1500-0003", name: "Parking Lot Striping" },
  { code: "1600-0001", name: "Leasing Center Enhancements" },
  { code: "1600-0002", name: "Leasing Center Furniture" },
  { code: "1600-0003", name: "Workout Facility Equipment" },
  { code: "1700-0001", name: "New Building Monument Signage" },
  { code: "1800-0001", name: "Pool Deck Resurface" },
  { code: "1800-0002", name: "Pool Furniture" },
  { code: "1800-0003", name: "Pool Fence" },
  { code: "1900-0001", name: "General Landscaping Enhancements" },
  { code: "1900-0002", name: "Tree Trim Removal" },
  { code: "1900-0003", name: "Irrigation System" },
  { code: "1900-0004", name: "Retaining Walls Repair/Replace" },
  { code: "1900-0005", name: "Retaining Walls Add" },
  { code: "1900-0006", name: "Dog Park Fence" },
  { code: "2000-0001", name: "Mailbox Structures" },
  { code: "2000-0002", name: "Laundry Room Enhancements" },
  { code: "2000-0003", name: "Save Water Plumbing" },
  { code: "2000-0004", name: "Boiler Repair/Replacements" },
  { code: "2000-0005", name: "Electrical GFCI Replacements" },
  { code: "2000-0006", name: "Elkay Faucets" },
  { code: "2000-0007", name: "Smart Tech" },
  { code: "3000-0001", name: "Deferred Maintenance" },
  { code: "3000-0002", name: "Contingency" },
  { code: "3000-0003", name: "Exterior Supervision Fee" },
  { code: "3000-0004", name: "Interior Supervision Fee" },
  { code: "3000-0005", name: "CR Capital Construction Fee" },
  { code: "4000-0001", name: "Paint" },
  { code: "4000-0002", name: "Flooring" },
  { code: "4000-0003", name: "Appliances" },
  { code: "4000-0004", name: "Countertops" },
  { code: "4000-0005", name: "Kitchen Backsplash" },
  { code: "4000-0006", name: "Cabinet Doors" },
  { code: "4000-0007", name: "Fixtures" },
  { code: "4000-0008", name: "Labor" },
  { code: "4000-0009", name: "Miscellaneous" },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false });
  const db = drizzle(client);

  const insertedCategories = await db
    .insert(costCategories)
    .values(CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })))
    .onConflictDoNothing({ target: costCategories.code })
    .returning();
  console.log(`Categories: ${insertedCategories.length} inserted, ${CATEGORIES.length - insertedCategories.length} already present`);

  const allCategories = await db.select().from(costCategories);
  const categoryIdByCode = new Map(allCategories.map((c) => [c.code, c.id]));

  const rows = CODES.map((c) => {
    const prefix = c.code.slice(0, 4);
    const categoryId = categoryIdByCode.get(prefix);
    if (!categoryId) throw new Error(`No category for cost code ${c.code}`);
    return { ...c, categoryId, isInterior: prefix === "4000" };
  });

  const insertedCodes = await db
    .insert(costCodes)
    .values(rows)
    .onConflictDoNothing({ target: costCodes.code })
    .returning();
  console.log(`Cost codes: ${insertedCodes.length} inserted, ${CODES.length - insertedCodes.length} already present`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * The ids the probes build against, resolved at run time.
 *
 * These used to be literals — property 1, cost codes 1 and 2, vendors 1 and 2.
 * Wiping every property except Aston Post Oak broke all three probes at once,
 * which is the failure mode a hard-coded id always has: it is a bet that the
 * row it names outlives the script. Resolved by shape instead, so the probes
 * follow the data rather than a snapshot of it.
 */
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "../src/db";

export type Fixtures = {
  propertyId: number;
  propertySlug: string;
  /** Two distinct cost codes on the property's own chart. */
  codeA: number;
  codeB: number;
  /** Two distinct active vendors. */
  vendorA: number;
  vendorB: number;
};

export async function loadFixtures(): Promise<Fixtures> {
  const property = await db().query.properties.findFirst({ orderBy: asc(schema.properties.id) });
  if (!property) throw new Error("no properties in the database to probe against");

  const codes = await db()
    .select({ id: schema.costCodes.id })
    .from(schema.costCodes)
    .where(eq(schema.costCodes.chartId, property.chartOfAccountsId))
    .orderBy(asc(schema.costCodes.id))
    .limit(2);
  if (codes.length < 2) {
    throw new Error(`property ${property.slug} needs two cost codes on chart ${property.chartOfAccountsId}`);
  }

  const vendors = await db()
    .select({ id: schema.vendors.id })
    .from(schema.vendors)
    .where(eq(schema.vendors.active, true))
    .orderBy(asc(schema.vendors.id))
    .limit(2);
  if (vendors.length < 2) throw new Error("two active vendors are needed to probe a split award");

  return {
    propertyId: property.id,
    propertySlug: property.slug,
    codeA: codes[0].id,
    codeB: codes[1].id,
    vendorA: vendors[0].id,
    vendorB: vendors[1].id,
  };
}

/** A budget group on the property, for probes that create an interior turn. */
export async function firstBudgetGroup(propertyId: number): Promise<number> {
  const group = await db().query.budgetGroups.findFirst({
    where: and(eq(schema.budgetGroups.propertyId, propertyId)),
    orderBy: asc(schema.budgetGroups.id),
  });
  if (!group) throw new Error(`no budget group on property ${propertyId}`);
  return group.id;
}

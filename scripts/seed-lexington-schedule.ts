/**
 * Lexington at Champions import, step 3 of 4: creates the 6 common-area
 * projects from the Construction Schedule sheet (excludes the grand-rollup
 * "General/Exterior CapEx" row, which isn't a discrete work item).
 *
 * Run after seed-lexington-coa-budget.ts (needs its cost codes).
 * Run: npx tsx scripts/seed-lexington-schedule.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { costCodes, projects, projectStageEvents } from "../src/db/schema";
import { CHART_ID, PROPERTY_ID, excelSerialToISO, loadWorkbook, parseConstructionSchedule } from "./lexington-workbook";
import type { ProjectStageKey } from "../src/lib/stages";

function stageFor(status: string, pctDone: number): ProjectStageKey {
  if (status === "Completed") return "complete";
  if (status === "In Progress" || pctDone > 0) return "in_progress";
  return "planned";
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.propertyId, PROPERTY_ID), eq(projects.kind, "common")));
  // The property starts with exactly 1 pre-existing common project (Exterior
  // Paint); more than that means this script already ran.
  if (existing.length > 1) {
    throw new Error(`Property ${PROPERTY_ID} already has extra common projects — aborting to avoid duplicates.`);
  }

  const wb = loadWorkbook();
  const groups = parseConstructionSchedule(wb);

  const codes = await db
    .select({ id: costCodes.id, code: costCodes.code })
    .from(costCodes)
    .where(eq(costCodes.chartId, CHART_ID));
  const idByCode = new Map(codes.map((c) => [c.code, c.id]));

  let count = 0;
  for (const g of groups) {
    const costCodeId = idByCode.get(g.costCode);
    if (!costCodeId) throw new Error(`Cost code ${g.costCode} not found for schedule group "${g.name}"`);
    const stage = stageFor(g.status, g.pctDone);

    const [project] = await db
      .insert(projects)
      .values({
        propertyId: PROPERTY_ID,
        name: g.name,
        kind: "common",
        costCodeId,
        stage,
        startDate: excelSerialToISO(g.start),
        completeDate: stage === "complete" ? excelSerialToISO(g.end) : null,
        targetCompletionDate: stage !== "complete" ? excelSerialToISO(g.end) : null,
      })
      .returning({ id: projects.id });
    await db.insert(projectStageEvents).values({ projectId: project.id, toStage: stage });
    count++;
  }

  await client.end();
  console.log(`${count} common-area projects created for property ${PROPERTY_ID}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

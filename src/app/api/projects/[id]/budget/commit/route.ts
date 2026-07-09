import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";

const bodySchema = z.object({
  rows: z
    .array(
      z.object({
        costCodeId: z.number().int().positive(),
        uwAmount: z.number().finite(),
        perUnitAmount: z.number().finite().optional(),
        plannedUnits: z.number().int().positive().optional(),
      }),
    )
    .min(1),
  note: z.string().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const values = parsed.data.rows.map((r) => ({
    projectId,
    costCodeId: r.costCodeId,
    uwAmount: r.uwAmount.toFixed(2),
    perUnitAmount: r.perUnitAmount?.toFixed(2),
    plannedUnits: r.plannedUnits,
    note: parsed.data.note,
  }));

  await db()
    .insert(schema.budgetLines)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.budgetLines.projectId, schema.budgetLines.costCodeId],
      set: {
        uwAmount: sql`excluded.uw_amount`,
        perUnitAmount: sql`excluded.per_unit_amount`,
        plannedUnits: sql`excluded.planned_units`,
        note: sql`excluded.note`,
        updatedAt: sql`now()`,
      },
    });

  revalidatePath(`/projects/${projectId}/budget`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");

  return NextResponse.json({ ok: true, count: values.length });
}

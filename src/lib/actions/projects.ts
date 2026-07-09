"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { PROJECT_STAGES } from "@/lib/stages";

const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  entity: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  unitCount: z.coerce.number().int().positive().optional(),
  pmSystem: z.string().trim().optional(),
});

export async function createProject(formData: FormData) {
  const parsed = createProjectSchema.parse({
    name: formData.get("name"),
    entity: formData.get("entity") || undefined,
    city: formData.get("city") || undefined,
    state: formData.get("state") || undefined,
    unitCount: formData.get("unitCount") || undefined,
    pmSystem: formData.get("pmSystem") || undefined,
  });

  const [project] = await db()
    .insert(schema.projects)
    .values(parsed)
    .returning();

  await db().insert(schema.projectStageEvents).values({
    projectId: project.id,
    toStage: "setup",
    note: "Project created",
  });

  revalidatePath("/");
  redirect(`/projects/${project.id}`);
}

const stageKeys = PROJECT_STAGES.map((s) => s.key) as [string, ...string[]];

const setStageSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  toStage: z.enum(stageKeys),
  note: z.string().trim().optional(),
});

export async function setProjectStage(formData: FormData) {
  const parsed = setStageSchema.parse({
    projectId: formData.get("projectId"),
    toStage: formData.get("toStage"),
    note: formData.get("note") || undefined,
  });

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, parsed.projectId),
  });
  if (!project) throw new Error("Project not found");
  if (project.stage === parsed.toStage) return;

  await db()
    .update(schema.projects)
    .set({ stage: parsed.toStage as typeof project.stage })
    .where(eq(schema.projects.id, parsed.projectId));

  await db().insert(schema.projectStageEvents).values({
    projectId: parsed.projectId,
    fromStage: project.stage,
    toStage: parsed.toStage as typeof project.stage,
    note: parsed.note,
  });

  revalidatePath(`/projects/${parsed.projectId}`);
  revalidatePath("/");
}

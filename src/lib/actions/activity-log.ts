"use server";

import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { phaseLabel } from "@/lib/stages";

export type FieldChange = {
  /** Stable machine key, e.g. "name", "phase", "milestone:Permit Submitted:plannedDate" */
  field: string;
  /** What's actually rendered — no lookup needed at read time */
  fieldLabel: string;
  from: string | null;
  to: string | null;
};

/** Insert one row per changed field. Call sites pre-format from/to (money(), fmtDate(), phaseLabel()...). */
export async function logFieldChanges(params: {
  projectId: number;
  userId: string | null;
  changes: FieldChange[];
  note?: string | null;
}) {
  const rows = params.changes
    .filter((c) => c.from !== c.to)
    .map((c) => ({
      projectId: params.projectId,
      userId: params.userId,
      field: c.field,
      fieldLabel: c.fieldLabel,
      fromValue: c.from,
      toValue: c.to,
      note: params.note ?? null,
    }));
  if (rows.length === 0) return;
  await db().insert(schema.projectActivityLog).values(rows);
}

/** Single-field convenience wrapper around logFieldChanges. */
export async function logFieldChange(params: {
  projectId: number;
  userId: string | null;
  field: string;
  fieldLabel: string;
  from: string | null;
  to: string | null;
  note?: string | null;
}) {
  await logFieldChanges({
    projectId: params.projectId,
    userId: params.userId,
    note: params.note,
    changes: [{ field: params.field, fieldLabel: params.fieldLabel, from: params.from, to: params.to }],
  });
}

export type ActivityLogRow = {
  id: string;
  createdAt: Date;
  userName: string | null;
  field: string;
  fieldLabel: string;
  fromValue: string | null;
  toValue: string | null;
  note: string | null;
};

/** Null when the left join found no profile (userId was null, e.g. legacy/system rows). */
function displayName(fullName: string | null, email: string | null): string | null {
  if (email == null) return null;
  return fullName?.trim() || email;
}

/**
 * Merges the new generic log with the legacy phase-only log (pre-2026-08-19
 * rows only ever exist there) into one sorted, capped list for display.
 */
export async function fetchActivityLog(projectId: number, limit = 200): Promise<ActivityLogRow[]> {
  const [fieldRows, legacyRows] = await Promise.all([
    db()
      .select({
        id: schema.projectActivityLog.id,
        createdAt: schema.projectActivityLog.createdAt,
        field: schema.projectActivityLog.field,
        fieldLabel: schema.projectActivityLog.fieldLabel,
        fromValue: schema.projectActivityLog.fromValue,
        toValue: schema.projectActivityLog.toValue,
        note: schema.projectActivityLog.note,
        userFullName: schema.profiles.fullName,
        userEmail: schema.profiles.email,
      })
      .from(schema.projectActivityLog)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.projectActivityLog.userId))
      .where(eq(schema.projectActivityLog.projectId, projectId))
      .orderBy(desc(schema.projectActivityLog.createdAt))
      .limit(limit),
    db()
      .select({
        id: schema.projectStageEvents.id,
        createdAt: schema.projectStageEvents.createdAt,
        fromPhase: schema.projectStageEvents.fromPhase,
        toPhase: schema.projectStageEvents.toPhase,
        note: schema.projectStageEvents.note,
        userFullName: schema.profiles.fullName,
        userEmail: schema.profiles.email,
      })
      .from(schema.projectStageEvents)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.projectStageEvents.userId))
      .where(eq(schema.projectStageEvents.projectId, projectId))
      .orderBy(desc(schema.projectStageEvents.createdAt))
      .limit(limit),
  ]);

  const merged: ActivityLogRow[] = [
    ...fieldRows.map((r) => ({
      id: `field-${r.id}`,
      createdAt: r.createdAt,
      userName: displayName(r.userFullName, r.userEmail),
      field: r.field,
      fieldLabel: r.fieldLabel,
      fromValue: r.fromValue,
      toValue: r.toValue,
      note: r.note,
    })),
    ...legacyRows.map((r) => ({
      id: `stage-${r.id}`,
      createdAt: r.createdAt,
      userName: displayName(r.userFullName, r.userEmail),
      field: "phase",
      fieldLabel: "Phase",
      fromValue: r.fromPhase ? phaseLabel(r.fromPhase) : null,
      toValue: r.toPhase ? phaseLabel(r.toPhase) : null,
      note: r.note,
    })),
  ];

  merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return merged.slice(0, limit);
}

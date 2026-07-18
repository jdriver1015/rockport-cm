import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { ScheduleNav } from "@/components/schedule/schedule-nav";

export const dynamic = "force-dynamic";

export default async function ScheduleLayout({ children }: { children: React.ReactNode }) {
  const properties = await db()
    .select({ id: schema.properties.id, name: schema.properties.name })
    .from(schema.properties)
    .orderBy(asc(schema.properties.name));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-navy">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Construction timelines across the portfolio
        </p>
      </div>
      <ScheduleNav properties={properties} />
      {children}
    </div>
  );
}

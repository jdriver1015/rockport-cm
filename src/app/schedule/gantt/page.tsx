import { GanttView } from "@/components/schedule/gantt-view";
import { getScheduleProjects } from "@/lib/schedule-data";

export const dynamic = "force-dynamic";

export default async function ScheduleGanttPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>;
}) {
  const sp = await searchParams;
  const propertyId = sp.property ? Number(sp.property) : undefined;
  const projects = await getScheduleProjects({
    propertyId: propertyId && Number.isInteger(propertyId) ? propertyId : undefined,
  });

  return <GanttView projects={projects} />;
}

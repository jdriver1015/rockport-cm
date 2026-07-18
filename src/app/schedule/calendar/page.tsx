import { CalendarView } from "@/components/schedule/calendar-view";
import { getScheduleProjects } from "@/lib/schedule-data";

export const dynamic = "force-dynamic";

export default async function ScheduleCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>;
}) {
  const sp = await searchParams;
  const propertyId = sp.property ? Number(sp.property) : undefined;
  const projects = await getScheduleProjects({
    propertyId: propertyId && Number.isInteger(propertyId) ? propertyId : undefined,
  });

  return <CalendarView projects={projects} />;
}

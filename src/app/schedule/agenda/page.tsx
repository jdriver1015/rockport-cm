import { AgendaView } from "@/components/schedule/agenda-view";
import { getScheduleProjects } from "@/lib/schedule-data";

export const dynamic = "force-dynamic";

export default async function ScheduleAgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>;
}) {
  const sp = await searchParams;
  const propertyId = sp.property ? Number(sp.property) : undefined;
  const projects = await getScheduleProjects({
    propertyId: propertyId && Number.isInteger(propertyId) ? propertyId : undefined,
  });

  return <AgendaView projects={projects} />;
}

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { CommonProjectWizard } from "@/components/common-project-wizard";
import { readBudgetLinesForPicker } from "@/lib/budget-picker";
import { readScheduleDefaults } from "@/lib/interior-defaults";
import { suggestSchedule, todayInBusinessZone } from "@/lib/schedule-defaults";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) notFound();

  const [budgetLines, schedule] = await Promise.all([
    readBudgetLinesForPicker(property.id),
    readScheduleDefaults(),
  ]);

  // Computed here, in one fixed timezone, so the server-rendered dates and the
  // hydrated ones cannot disagree by a day.
  const suggestedDates = suggestSchedule(schedule, todayInBusinessZone());

  return (
    <div className="mx-auto max-w-2xl">
      <CommonProjectWizard
        propertyId={property.id}
        propertySlug={property.slug}
        budgetLines={budgetLines.sort((a, b) => a.code.localeCompare(b.code))}
        schedule={schedule}
        suggestedDates={suggestedDates}
      />
    </div>
  );
}

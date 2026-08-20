import { redirect } from "next/navigation";

// Renamed to /interiors/types/[typeId] — the thing is a renovation type, not
// only a budget group, and it now carries scope and specs as well as pricing.
// Keep this route so old links and bookmarks still work.
export default async function BudgetGroupRedirect({
  params,
}: {
  params: Promise<{ slug: string; groupId: string }>;
}) {
  const { slug, groupId } = await params;
  redirect(`/properties/${slug}/interiors/types/${groupId}`);
}

import { redirect } from "next/navigation";

// The Turn Plan tab is gone. Its turn list had already moved to the Projects
// board and its plan to the Budget tab's Interior view, leaving only a KPI
// strip — those figures now belong on the Performance tab. The sub-routes under
// /interiors (the wizard, renovation types, triggers) are still live and are
// reached from the Budget tab's Interior toolbar and the Projects board.
//
// Kept as a redirect so old links and bookmarks still work.
export default async function InteriorsRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/properties/${slug}`);
}

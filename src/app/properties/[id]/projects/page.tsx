import { redirect } from "next/navigation";

// The projects list was merged into the property board at /properties/[id].
// Keep this route as a redirect so old links and bookmarks still work.
export default async function ProjectsRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/properties/${id}`);
}

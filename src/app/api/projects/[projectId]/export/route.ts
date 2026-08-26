import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { ProjectSheetDocument } from "@/lib/project-sheet-document";
import { readProjectSheet } from "@/lib/project-sheet";

/**
 * The project as a one-page sheet.
 *
 * Rendered rather than printed, for the same reason contracts are: the screen
 * mounts either the scope panel or the workflow panel, never both, so a browser
 * print would silently drop whichever one you were not looking at — including
 * the awards and contracts.
 *
 * Signed-in only. A project sheet carries vendor names and prices.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId: pid } = await ctx.params;
  const projectId = Number(pid);
  if (!Number.isInteger(projectId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const data = await readProjectSheet(projectId);
  if (!data) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const buffer = await renderToBuffer(ProjectSheetDocument({ data }));
  const filename = `${data.projectName} - project sheet.pdf`.replace(/[^a-zA-Z0-9 .\-_]/g, "_");

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      // The sheet is a snapshot of live figures; a cached one is a wrong one.
      "Cache-Control": "no-store",
    },
  });
}

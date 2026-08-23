import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { ContractDocument } from "@/lib/contract-document";
import { readContract, readContractDocument } from "@/lib/contracts";

/**
 * The contract as a PDF.
 *
 * Signed-in only, unlike /bid/[token] — a contract names both parties and the
 * price, and nothing about it should be reachable with a link alone.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
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

  const live = await readContract(projectId);
  if (!live) return NextResponse.json({ error: "No contract" }, { status: 404 });

  const data = await readContractDocument(live.id);
  if (!data) return NextResponse.json({ error: "No contract" }, { status: 404 });

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { name: true },
  });

  const buffer = await renderToBuffer(ContractDocument({ data }));
  const filename = `${data.contractNumber} - ${project?.name ?? "contract"}.pdf`.replace(
    /[^a-zA-Z0-9 .\-_]/g,
    "_",
  );
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      // A draft changes every time it is regenerated, and an executed one must
      // not be served from a cache that predates the signature.
      "Cache-Control": "no-store",
    },
  });
}

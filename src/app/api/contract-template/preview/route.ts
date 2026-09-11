import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { ContractDocument, type ContractData } from "@/lib/contract-document";
import { fillTemplate, SAMPLE_FIELDS, SAMPLE_LINES } from "@/lib/contract-template-starter";
import { pdfResponse, requireSignedInApiUser } from "@/lib/pdf-route";

/**
 * What a template body looks like as a real document — with sample data
 * standing in for the vendor, property and amount a real contract would
 * carry, since this is edited outside any project.
 *
 * Takes the body straight from the request rather than reading the saved
 * row, so the editor can preview what's typed before it's saved.
 */
export async function POST(req: NextRequest) {
  const auth = await requireSignedInApiUser();
  if (!auth.ok) return auth.response;

  const json = await req.json().catch(() => null);
  const body = typeof json?.body === "string" ? json.body : null;
  if (!body || !body.trim()) {
    return NextResponse.json({ error: "Nothing to preview yet" }, { status: 400 });
  }

  const filled = fillTemplate(body, SAMPLE_FIELDS);
  const amount = SAMPLE_LINES.reduce((s, l) => s + l.amount, 0);

  const data: ContractData = {
    company: SAMPLE_FIELDS.company,
    propertyName: SAMPLE_FIELDS.property,
    projectName: SAMPLE_FIELDS.project,
    vendorName: SAMPLE_FIELDS.vendor,
    vendorContact: "Jane Doe · jane@example.com",
    body: filled,
    lines: SAMPLE_LINES,
    amount,
    linesArePriced: true,
    contractNumber: "SAMPLE — for preview only",
    dateLabel: SAMPLE_FIELDS.date,
    awardNote: null,
    draft: true,
  };

  const buffer = await renderToBuffer(ContractDocument({ data }));
  return pdfResponse(buffer, "template-preview.pdf");
}

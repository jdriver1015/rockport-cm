import { appOrigin } from "@/lib/email";

// ---------------------------------------------------------------------------
// The invitation a vendor receives.
//
// Table-based with inline styles, because Outlook renders mail with Word's HTML
// engine: no flexbox, no grid, no external stylesheet, and margins on block
// elements are unreliable. It looks primitive on purpose.
//
// Same navy as the contract PDF and the walk report, so the three things a
// vendor receives from Westcreek look like they came from one company.
// ---------------------------------------------------------------------------

const NAVY = "#1b355d";
const MARINER = "#1457a5";
const SLATE = "#26303a";
const MUTED = "#6b7684";
const HAIR = "#e6e8ea";

export type InvitationInput = {
  vendorName: string;
  contactName: string | null;
  propertyName: string;
  projectName: string;
  scopeItems: { item: string; costCodeName: string | null }[];
  /** The token is the credential — this link is unique to one vendor. */
  token: string;
  dueDate: string | null;
  senderName: string | null;
  /** Signs the pixel to one bid, so an open can be attributed. */
  bidId: number;
  /** Rendered for somebody to read before sending, not for delivery. */
  preview?: boolean;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function fmtDue(d: string | null): string | null {
  if (!d) return null;
  const parsed = new Date(`${d}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function invitationSubject(i: InvitationInput): string {
  return `Bid request — ${i.projectName} at ${i.propertyName}`;
}

export function invitationHtml(i: InvitationInput): string {
  const origin = appOrigin();
  const link = `${origin}/bid/${i.token}`;
  // Omitted from a preview: the draft is rendered in an iframe inside the app,
  // so the pixel would fire a tracking request on a message nobody has received.
  const pixel = `${origin}/api/bid/${i.token}/open.gif`;
  const due = fmtDue(i.dueDate);
  const greeting = i.contactName?.trim() ? `Hi ${esc(i.contactName.trim().split(" ")[0])},` : "Hello,";

  const rows = i.scopeItems
    .map(
      (s) => `
        <tr>
          <td style="padding:7px 12px;border-bottom:1px solid #f1f3f5;font-size:13px;color:${SLATE};">
            ${esc(s.item)}${
              s.costCodeName
                ? ` <span style="color:#8a94a2;font-size:11px;">· ${esc(s.costCodeName)}</span>`
                : ""
            }
          </td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(invitationSubject(i))}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${HAIR};font-family:-apple-system,'Segoe UI',Arial,sans-serif;">

  <tr><td style="background:${NAVY};padding:18px 24px;">
    <div style="color:#9db8dc;font-size:10px;letter-spacing:3px;text-transform:lowercase;">westcreek</div>
    <div style="color:#ffffff;font-size:17px;font-weight:600;padding-top:4px;">Request for pricing</div>
    <div style="color:#c3d3ec;font-size:12px;padding-top:3px;">${esc(i.projectName)} · ${esc(i.propertyName)}</div>
  </td></tr>

  <tr><td style="padding:22px 24px;color:${SLATE};font-size:13.5px;line-height:1.6;">
    <p style="margin:0 0 13px;">${greeting}</p>
    <p style="margin:0 0 13px;">Westcreek Capital is asking <strong>${esc(i.vendorName)}</strong> to price the
      work below at <strong>${esc(i.propertyName)}</strong>. Enter a price per line and submit — it comes
      straight back to us, and no other bidder sees your numbers.</p>
    ${
      due
        ? `<p style="margin:0 0 13px;">Please respond by <strong>${esc(due)}</strong>.</p>`
        : ""
    }

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${HAIR};border-radius:4px;margin:14px 0;">
      <tr><td style="background:#f7f8f9;padding:7px 12px;font-size:9.5px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${HAIR};">
        Scope to price · ${i.scopeItems.length} item${i.scopeItems.length === 1 ? "" : "s"}
      </td></tr>
      ${rows}
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 0 8px;">
      <a href="${link}" style="display:inline-block;background:${MARINER};color:#ffffff;text-decoration:none;padding:12px 26px;border-radius:5px;font-size:14px;font-weight:600;">Price this scope</a>
    </td></tr></table>

    <p style="margin:14px 0 0;font-size:11.5px;color:${MUTED};line-height:1.5;">
      This link is unique to ${esc(i.vendorName)} and works without a password — please do not forward it.
      If anything in the scope is unclear, reply to this email before pricing rather than guessing.
    </p>
  </td></tr>

  <tr><td style="border-top:1px solid ${HAIR};padding:14px 24px;font-size:11px;color:#8a94a2;line-height:1.5;">
    Westcreek Capital${i.senderName ? ` · sent by ${esc(i.senderName)}` : ""}<br>
    You are receiving this because ${esc(i.vendorName)} is an approved vendor on this property.
  </td></tr>

</table>
</td></tr></table>
${i.preview ? "" : `<img src="${pixel}" width="1" height="1" alt="" style="display:block;border:0;">`}
</body></html>`;
}

/** The same message for clients that refuse HTML. */
export function invitationText(i: InvitationInput): string {
  const link = `${appOrigin()}/bid/${i.token}`;
  const due = fmtDue(i.dueDate);
  const greeting = i.contactName?.trim() ? `Hi ${i.contactName.trim().split(" ")[0]},` : "Hello,";

  return [
    greeting,
    "",
    `Westcreek Capital is asking ${i.vendorName} to price the work below at ${i.propertyName} (${i.projectName}).`,
    due ? `Please respond by ${due}.` : "",
    "",
    `Scope to price (${i.scopeItems.length}):`,
    ...i.scopeItems.map((s) => `  - ${s.item}${s.costCodeName ? ` (${s.costCodeName})` : ""}`),
    "",
    "Price it here:",
    link,
    "",
    `This link is unique to ${i.vendorName} and works without a password — please do not forward it.`,
    "If anything in the scope is unclear, reply to this email before pricing rather than guessing.",
    "",
    `Westcreek Capital${i.senderName ? ` · sent by ${i.senderName}` : ""}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

// ---------------------------------------------------------------------------
// The account mail a person receives: a welcome with a link to set their
// password, or a link to set a new one.
//
// Table-based with inline styles for the same reason as the bid invitation
// (bid-invitation.ts): Outlook renders mail with Word's HTML engine. Same navy
// header, so everything Westcreek sends looks like it came from one place.
//
// There is no password in it. The link sets one — it works once and expires —
// so nothing that could sign somebody in sits in an inbox afterwards.
// ---------------------------------------------------------------------------

const NAVY = "#1b355d";
const MARINER = "#1457a5";
const SLATE = "#26303a";
const MUTED = "#6b7684";
const HAIR = "#e6e8ea";

export type AccountEmailKind = "invite" | "reset";

export type AccountEmailInput = {
  kind: AccountEmailKind;
  fullName: string | null;
  email: string;
  roleLabel: string;
  /** The one-time link that signs them in and opens "set your password". */
  link: string;
  /** Who sent it, so the email is not from nobody. */
  senderName: string | null;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function firstName(fullName: string | null): string | null {
  return fullName?.trim() ? fullName.trim().split(/\s+/)[0] : null;
}

export function accountEmailSubject(i: AccountEmailInput): string {
  return i.kind === "invite"
    ? "You're invited to Rockport Construction Manager"
    : "Set a new password for Rockport";
}

export function accountEmailHtml(i: AccountEmailInput): string {
  const name = firstName(i.fullName);
  const greeting = name ? `Hi ${esc(name)},` : "Hello,";
  const invite = i.kind === "invite";
  const sender = i.senderName?.trim() ? esc(i.senderName.trim()) : "Westcreek Capital";

  const body = invite
    ? `<p style="margin:0 0 13px;">${sender} has added you to <strong>Rockport</strong>, Westcreek's
         construction manager, as <strong>${esc(i.roleLabel)}</strong>.</p>
       <p style="margin:0 0 13px;">Choose your password to finish setting up your account. You'll sign
         in with <strong>${esc(i.email)}</strong> and that password from then on.</p>`
    : `<p style="margin:0 0 13px;">Use the button below to choose a new password for
         <strong>${esc(i.email)}</strong>. Your current password keeps working until you do.</p>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(accountEmailSubject(i))}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${HAIR};font-family:-apple-system,'Segoe UI',Arial,sans-serif;">

  <tr><td style="background:${NAVY};padding:18px 24px;">
    <div style="color:#9db8dc;font-size:10px;letter-spacing:3px;text-transform:lowercase;">westcreek</div>
    <div style="color:#ffffff;font-size:17px;font-weight:600;padding-top:4px;">${
      invite ? "Welcome to Rockport" : "Set a new password"
    }</div>
    <div style="color:#c3d3ec;font-size:12px;padding-top:3px;">Construction Manager</div>
  </td></tr>

  <tr><td style="padding:22px 24px;color:${SLATE};font-size:13.5px;line-height:1.6;">
    <p style="margin:0 0 13px;">${greeting}</p>
    ${body}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 0 8px;">
      <a href="${esc(i.link)}" style="display:inline-block;background:${MARINER};color:#ffffff;text-decoration:none;padding:12px 26px;border-radius:5px;font-size:14px;font-weight:600;">${
        invite ? "Set your password" : "Choose a new password"
      }</a>
    </td></tr></table>

    <p style="margin:14px 0 0;font-size:11.5px;color:${MUTED};line-height:1.5;">
      The link works once and expires soon. If it has, ask ${sender} to send a new one.
      ${invite ? "" : "If you didn't expect this, you can ignore it — nothing changes until the link is used."}
    </p>
  </td></tr>

  <tr><td style="border-top:1px solid ${HAIR};padding:14px 24px;font-size:11px;color:#8a94a2;line-height:1.5;">
    Westcreek Capital · Rockport Construction Manager<br>
    Sent to ${esc(i.email)}. Please don't forward this email — the link signs in as you.
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

/** The same message for clients that refuse HTML. */
export function accountEmailText(i: AccountEmailInput): string {
  const name = firstName(i.fullName);
  const sender = i.senderName?.trim() || "Westcreek Capital";
  const invite = i.kind === "invite";
  return [
    name ? `Hi ${name},` : "Hello,",
    "",
    invite
      ? `${sender} has added you to Rockport, Westcreek's construction manager, as ${i.roleLabel}.`
      : `Use the link below to choose a new password for ${i.email}.`,
    invite
      ? `Choose your password to finish setting up your account. You'll sign in with ${i.email} and that password from then on.`
      : "Your current password keeps working until you do.",
    "",
    invite ? "Set your password:" : "Choose a new password:",
    i.link,
    "",
    `The link works once and expires soon. If it has, ask ${sender} to send a new one.`,
    "Please don't forward this email — the link signs in as you.",
  ].join("\n");
}

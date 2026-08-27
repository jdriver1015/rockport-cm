// ---------------------------------------------------------------------------
// Sending mail.
//
// Nothing in this app sent email before this. "Send for pricing" created bid
// rows, marked them sent, and left somebody to copy a link into Outlook by hand.
//
// The provider sits behind this seam for one reason: a sending domain has to be
// verified before a single message is delivered, and that is DNS work on
// somebody's calendar rather than code. Without RESEND_API_KEY the app still
// does everything else — mints the links, records the invitations, shows the
// draft — and reports honestly that delivery is not configured. Setting the key
// turns it on with no code change.
// ---------------------------------------------------------------------------

export type SendOutcome =
  | { ok: true; id: string | null }
  | { ok: false; error: string; configured: boolean };

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  /** Shown in clients that refuse HTML, and it keeps spam filters calmer. */
  text: string;
  replyTo?: string;
};

/** The address invitations come from. */
export const FROM_ADDRESS =
  process.env.BID_FROM_ADDRESS ?? "bids@multifamily-construction.io";

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Send one message.
 *
 * Talks to Resend over fetch rather than through its SDK — one POST, and a
 * dependency that exists to build one JSON body is a dependency to keep updated.
 */
export async function sendEmail(mail: OutgoingEmail): Promise<SendOutcome> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, error: "Email delivery is not configured", configured: false };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      // The body carries the real reason — an unverified domain, a blocked
      // address — and it is worth surfacing rather than "send failed".
      const body = await res.text();
      return {
        ok: false,
        error: `Resend rejected the message (${res.status}): ${body.slice(0, 200)}`,
        configured: true,
      };
    }

    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json.id ?? null };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Send failed",
      configured: true,
    };
  }
}

/**
 * The origin links in outgoing mail point at.
 *
 * A relative URL is meaningless in an inbox, and VERCEL_URL is the deployment's
 * own hostname rather than the one people use, so the canonical host is set
 * explicitly and only falls back for local work.
 */
export function appOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
  );
}

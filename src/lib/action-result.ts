/**
 * Shared shape for Server Action results. Expected errors (validation,
 * conflicts, business rules) must be returned as values, not thrown — this
 * Next.js version bubbles a thrown Server Action error straight to the
 * nearest error boundary instead of rejecting the caller's promise, so a
 * client-side try/catch never sees it.
 */
export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

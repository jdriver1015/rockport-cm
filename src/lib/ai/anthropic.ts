/**
 * Minimal server-only Anthropic client. Direct fetch to the Messages API — no
 * SDK dependency, and lazy (reads the key per-call) so `next build` works
 * without ANTHROPIC_API_KEY set. Never import into a Client Component.
 */

/** Current default model for rent-roll parsing (column mapping + PDF vision). */
export const RENT_ROLL_MODEL = "claude-sonnet-5";

export function hasAnthropicKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
    };

type Message = { role: "user" | "assistant"; content: string | ContentBlock[] };

/**
 * Call the Anthropic Messages API and return the first text block. Throws if no
 * key is configured or the request fails — callers decide whether that's fatal.
 */
export async function anthropicMessage(
  messages: Message[],
  opts?: { model?: string; maxTokens?: number; system?: string; pdf?: boolean },
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
  // Native PDF document blocks — harmless on models where PDF support is GA.
  if (opts?.pdf) headers["anthropic-beta"] = "pdfs-2024-09-25";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: opts?.model ?? RENT_ROLL_MODEL,
      max_tokens: opts?.maxTokens ?? 8192,
      ...(opts?.system ? { system: opts.system } : {}),
      messages,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic request failed (${res.status}): ${detail.slice(0, 500)}`);
  }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = json.content?.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Anthropic returned no text content");
  return text;
}

/** Strip markdown code fences and parse JSON from an LLM text response. */
export function parseJsonResponse(raw: string): unknown {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(stripped);
}

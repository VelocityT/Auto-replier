import crypto from "crypto";

// Instagram + Facebook both go through the Meta Graph API.
// Comments arrive via webhooks (real-time, no polling needed).
const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

export interface MetaCommentEvent {
  platform: "instagram" | "facebook";
  pageOrAccountId: string; // IG business account ID or FB Page ID — used to look up the client
  commentId: string;
  text: string;
  authorName: string | null;
}

/**
 * Verify the `X-Hub-Signature-256` header Meta sends on every webhook POST.
 * Always do this before trusting webhook payload contents.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

  // Constant-time comparison
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Normalize a Meta webhook payload (Instagram or Facebook Page) into a flat
 * list of new comment events. Returns an empty array for event types we
 * don't care about (likes, mentions, etc.).
 */
export function parseWebhookEvents(payload: any): MetaCommentEvent[] {
  const events: MetaCommentEvent[] = [];

  for (const entry of payload.entry ?? []) {
    // Instagram comments
    for (const change of entry.changes ?? []) {
      if (change.field === "comments" && change.value?.id && change.value?.text) {
        events.push({
          platform: "instagram",
          pageOrAccountId: entry.id, // IG business account ID
          commentId: change.value.id,
          text: change.value.text,
          authorName: change.value.from?.username ?? null,
        });
      }

      // Facebook Page feed comments
      if (
        change.field === "feed" &&
        change.value?.item === "comment" &&
        change.value?.verb === "add" &&
        change.value?.comment_id &&
        change.value?.message
      ) {
        events.push({
          platform: "facebook",
          pageOrAccountId: entry.id, // FB Page ID
          commentId: change.value.comment_id,
          text: change.value.message,
          authorName: change.value.from?.name ?? null,
        });
      }
    }
  }

  return events;
}

/**
 * Reply to a comment. Works for both Instagram and Facebook — Graph API
 * exposes the same `/{comment-id}/replies` edge for both.
 */
export async function replyToComment(
  commentId: string,
  message: string,
  pageAccessToken: string
): Promise<void> {
  const url = `${GRAPH_API_BASE}/${commentId}/replies`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, access_token: pageAccessToken }),
  });

  if (!res.ok) {
    throw new Error(`Meta reply failed: ${res.status} ${await res.text()}`);
  }
}

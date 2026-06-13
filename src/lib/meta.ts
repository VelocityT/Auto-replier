import crypto from "crypto";
import type { PostRef } from "@/lib/types";

// Instagram + Facebook both go through the Meta Graph API.
// Comments arrive via webhooks (real-time, no polling needed).
const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

export interface MetaCommentEvent {
  platform: "instagram" | "facebook";
  pageOrAccountId: string; // IG business account ID or FB Page ID — used to look up the client
  commentId: string;
  text: string;
  authorName: string | null;
  // The post/media this comment was left on, when Meta includes it in the
  // webhook payload. Used for the "which post got comments" dashboard view.
  postRef: PostRef | null;
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
        const mediaId: string | undefined = change.value.media?.id;
        events.push({
          platform: "instagram",
          pageOrAccountId: entry.id, // IG business account ID
          commentId: change.value.id,
          text: change.value.text,
          authorName: change.value.from?.username ?? null,
          postRef: mediaId
            ? { id: mediaId, label: "Instagram post", url: null }
            : null,
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
        const postId: string | undefined = change.value.post_id;
        events.push({
          platform: "facebook",
          pageOrAccountId: entry.id, // FB Page ID
          commentId: change.value.comment_id,
          text: change.value.message,
          authorName: change.value.from?.name ?? null,
          postRef: postId
            ? { id: postId, label: "Facebook post", url: `https://www.facebook.com/${postId}` }
            : null,
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

// ─────────────────────────────────────────────
// OAuth connect flow — used by /api/oauth/meta (Instagram + Facebook share
// one Meta Page Access Token). Requires META_APP_ID / META_APP_SECRET, and
// for client accounts other than the app's own developers/testers, Meta App
// Review approval of the pages_* / instagram_* scopes below.
// ─────────────────────────────────────────────

export const META_APP_ID = process.env.META_APP_ID;
export const META_APP_SECRET = process.env.META_APP_SECRET;

// Short-lived cookie used to pass candidate Pages (with their page access
// tokens) from /api/oauth/meta/callback to the /meta-pages picker, when the
// user manages more than one Page. Cleared once a Page is selected.
export const META_PAGES_COOKIE = "ar_meta_pages";

// Scopes needed to read + reply to comments on a Page's posts and on the
// Page's linked Instagram Business account.
export const META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_manage_comments",
  "business_management",
].join(",");

/** Exchange an OAuth `code` for a short-lived user access token. */
export async function exchangeMetaCode(code: string, redirectUri: string): Promise<{ access_token: string }> {
  const params = new URLSearchParams({
    client_id: META_APP_ID ?? "",
    client_secret: META_APP_SECRET ?? "",
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch(`${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`);

  if (!res.ok) {
    throw new Error(`Meta code exchange failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

/** Exchange a short-lived user token for a long-lived one (~60 days). */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{ access_token: string }> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: META_APP_ID ?? "",
    client_secret: META_APP_SECRET ?? "",
    fb_exchange_token: shortLivedToken,
  });

  const res = await fetch(`${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`);

  if (!res.ok) {
    throw new Error(`Meta long-lived token exchange failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

export interface MetaPage {
  id: string;
  name: string;
  access_token: string; // page access token, long-lived if exchanged from a long-lived user token
}

/**
 * List the Facebook Pages this user manages (and that the app has access
 * to). Each page comes with its own page access token. Returns an empty
 * array if no pages are accessible — typical before Meta App Review
 * approval, when only the app's own developers/testers can be returned.
 */
export async function listPages(userAccessToken: string): Promise<MetaPage[]> {
  const url = `${GRAPH_API_BASE}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userAccessToken)}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Meta accounts.list failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return (data.data ?? []) as MetaPage[];
}

/**
 * Look up the Instagram Business account linked to a Facebook Page, if any.
 */
export async function getInstagramAccountForPage(pageId: string, pageAccessToken: string): Promise<string | null> {
  const url = `${GRAPH_API_BASE}/${pageId}?fields=instagram_business_account&access_token=${encodeURIComponent(pageAccessToken)}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Meta page lookup failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.instagram_business_account?.id ?? null;
}

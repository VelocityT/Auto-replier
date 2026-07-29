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
  pageAccessToken: string,
  platform: "instagram" | "facebook" = "instagram"
): Promise<void> {
  // Instagram Login tokens only work against graph.instagram.com; Facebook
  // Page tokens only work against graph.facebook.com. Route accordingly.
  const base = platform === "instagram" ? INSTAGRAM_GRAPH_BASE : GRAPH_API_BASE;
  const url = `${base}/${commentId}/replies`;

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

// ─────────────────────────────────────────────
// Instagram API with Instagram Login
//
// The app is submitted to Meta App Review for the `instagram_business_*`
// permission set. Those permissions are only issued through Instagram Login
// (instagram.com/oauth/authorize) — NOT the Facebook Login dialog. A client
// connects their Instagram Business/Creator account directly; no linked
// Facebook Page is required, which matters for smaller clients who never set
// one up properly.
//
// Legacy note: this app previously requested the Facebook Login permission
// set (instagram_basic, instagram_manage_comments, pages_*). Those are a
// different product configuration and do NOT match the current submission —
// requesting them would fail with "Invalid Scope" once review is approved.
// ─────────────────────────────────────────────

/** Instagram app ID — distinct from the Facebook app ID. */
export const INSTAGRAM_APP_ID = process.env.INSTAGRAM_APP_ID;
export const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET;

export const INSTAGRAM_OAUTH_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
export const INSTAGRAM_OAUTH_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
export const INSTAGRAM_GRAPH_BASE = "https://graph.instagram.com/v23.0";

// Scopes needed to read + reply to comments on the client's Instagram
// Business account. Must stay in sync with the Meta App Review submission.
export const META_OAUTH_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
  "instagram_business_manage_insights",
].join(",");

/**
 * Exchange an Instagram OAuth `code` for a short-lived access token.
 *
 * Unlike the Facebook token endpoint this is a POST with form-encoded body,
 * and it returns the Instagram user id alongside the token.
 */
export async function exchangeMetaCode(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; user_id: string; permissions?: string }> {
  const body = new URLSearchParams({
    client_id: INSTAGRAM_APP_ID ?? "",
    client_secret: INSTAGRAM_APP_SECRET ?? "",
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch(INSTAGRAM_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Instagram code exchange failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    user_id: String(data.user_id ?? ""),
    permissions: data.permissions,
  };
}

/**
 * Exchange a short-lived Instagram token for a long-lived one (~60 days).
 *
 * Long-lived tokens are refreshable — see `refreshLongLivedToken`. Refresh
 * before day 60 or the client silently stops receiving replies.
 */
export async function exchangeForLongLivedToken(
  shortLivedToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: INSTAGRAM_APP_SECRET ?? "",
    access_token: shortLivedToken,
  });

  const res = await fetch(`${INSTAGRAM_GRAPH_BASE}/access_token?${params.toString()}`);

  if (!res.ok) {
    throw new Error(`Instagram long-lived token exchange failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

/**
 * Refresh a long-lived Instagram token for another 60 days. The token must be
 * at least 24 hours old and not yet expired. Run this on a schedule (the
 * existing cron is a natural home) so client connections don't lapse.
 */
export async function refreshLongLivedToken(
  longLivedToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const params = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: longLivedToken,
  });

  const res = await fetch(`${INSTAGRAM_GRAPH_BASE}/refresh_access_token?${params.toString()}`);

  if (!res.ok) {
    throw new Error(`Instagram token refresh failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

/** The connected Instagram Business account's own profile. */
export interface InstagramAccount {
  id: string;
  username: string;
  name?: string;
}

/**
 * Fetch the profile of the Instagram account that authorized the app. Used
 * in place of the old Page picker — Instagram Login authorizes exactly one
 * account, so there is nothing to choose between.
 */
export async function getInstagramAccount(accessToken: string): Promise<InstagramAccount> {
  const url = `${INSTAGRAM_GRAPH_BASE}/me?fields=id,username,name&access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Instagram account lookup failed: ${res.status} ${await res.text()}`);
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

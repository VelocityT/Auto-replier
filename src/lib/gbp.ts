import { getGoogleAccessToken } from "./google-auth";

// Google Business Profile reviews are managed via the legacy "My Business
// API v4" endpoint. As of mid-2026 this remains the only endpoint for
// reading/replying to reviews (review management was NOT split out into the
// newer per-resource APIs). Access requires a separate, manually-approved
// API access request — see README for the process.
const API_BASE = "https://mybusiness.googleapis.com/v4";

export interface GbpReview {
  reviewId: string; // last path segment of `name`
  name: string; // full resource name, needed for the reply call
  comment: string;
  starRating: string; // ONE | TWO | THREE | FOUR | FIVE
  reviewerName: string;
  createTime: string;
  hasReply: boolean;
}

/**
 * List reviews for a location, newest first. Call this on a schedule
 * (cron) — GBP has no webhooks for new reviews.
 */
export async function listReviews(
  accountId: string,
  locationId: string,
  refreshToken: string,
  pageSize = 20
): Promise<GbpReview[]> {
  const accessToken = await getGoogleAccessToken(refreshToken);

  const url = `${API_BASE}/accounts/${accountId}/locations/${locationId}/reviews?pageSize=${pageSize}&orderBy=updateTime desc`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`GBP reviews.list failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();

  return (data.reviews ?? []).map((r: any) => ({
    reviewId: r.name.split("/").pop(),
    name: r.name,
    comment: r.comment ?? "",
    starRating: r.starRating,
    reviewerName: r.reviewer?.displayName ?? "Anonymous",
    createTime: r.createTime,
    hasReply: !!r.reviewReply,
  }));
}

/**
 * Post (or update) the owner reply to a review.
 * `reviewName` is the full resource name returned by listReviews (the `name` field).
 */
export async function replyToReview(
  reviewName: string,
  replyText: string,
  refreshToken: string
): Promise<void> {
  const accessToken = await getGoogleAccessToken(refreshToken);

  const res = await fetch(`${API_BASE}/${reviewName}/reply`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ comment: replyText }),
  });

  if (!res.ok) {
    throw new Error(`GBP reviews.updateReply failed: ${res.status} ${await res.text()}`);
  }
}

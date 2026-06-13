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

// ─────────────────────────────────────────────
// Account / location discovery — used by the
// /api/oauth/gbp connect flow and the location picker.
//
// These hit the newer per-resource APIs (account management /
// business information), which are separate from the v4 "My Business
// API" used above for reviews. Both require the same `business.manage`
// scope, but account/location access tends to be granted sooner than
// full review-management access — so this can succeed even while
// listReviews/replyToReview are still pending approval (case 7-5896000040841).
// ─────────────────────────────────────────────

export interface GbpAccount {
  name: string; // resource name, e.g. "accounts/1234567890"
  accountName: string; // human-readable
  type: string;
}

/**
 * List the Business Profile accounts accessible to this refresh token.
 * Throws if the API isn't enabled/approved yet for this project.
 */
export async function listAccounts(refreshToken: string): Promise<GbpAccount[]> {
  const accessToken = await getGoogleAccessToken(refreshToken);

  const res = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`GBP accounts.list failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();

  return (data.accounts ?? []).map((a: any) => ({
    name: a.name,
    accountName: a.accountName ?? a.name,
    type: a.type ?? "",
  }));
}

export interface GbpLocation {
  name: string; // resource name, e.g. "accounts/123/locations/456"
  title: string;
  address: string;
}

/**
 * List the locations under a given account (e.g. "accounts/1234567890").
 */
export async function listLocations(refreshToken: string, accountName: string): Promise<GbpLocation[]> {
  const accessToken = await getGoogleAccessToken(refreshToken);

  const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title,storefrontAddress`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`GBP locations.list failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();

  return (data.locations ?? []).map((l: any) => {
    const addr = l.storefrontAddress;
    const addressParts = addr ? [addr.addressLines?.join(", "), addr.locality, addr.administrativeArea] : [];
    return {
      name: l.name,
      title: l.title ?? l.name,
      address: addressParts.filter(Boolean).join(", "),
    };
  });
}

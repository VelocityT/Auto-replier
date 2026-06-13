// Shared helper for refreshing Google OAuth access tokens (used by both
// the YouTube Data API and the Google Business Profile API).
//
// Each CLIENT in your Supabase `clients` table stores its own refresh token
// (obtained once via the OAuth consent flow described in the README). This
// function exchanges that refresh token for a short-lived access token.

export const GOOGLE_OAUTH_CLIENT_ID = process.env.YOUTUBE_OAUTH_CLIENT_ID || process.env.GBP_OAUTH_CLIENT_ID;
export const GOOGLE_OAUTH_CLIENT_SECRET =
  process.env.YOUTUBE_OAUTH_CLIENT_SECRET || process.env.GBP_OAUTH_CLIENT_SECRET;

if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET) {
  console.warn(
    "[google-auth] OAuth client id/secret not set. " +
      "Set YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET " +
      "(a single Google Cloud OAuth client can be used for both YouTube and GBP)."
  );
}

export async function getGoogleAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to refresh Google access token: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/**
 * One-time exchange of an OAuth `code` (from the consent-screen redirect)
 * for an access token + refresh token. Used by the /api/oauth/youtube and
 * /api/oauth/gbp connect flows.
 */
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google code exchange failed: ${res.status} ${body}`);
  }

  return res.json();
}

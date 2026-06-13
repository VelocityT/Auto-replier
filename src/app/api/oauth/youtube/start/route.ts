import { NextRequest, NextResponse } from "next/server";
import { GOOGLE_OAUTH_CLIENT_ID } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

// GET /api/oauth/youtube/start?clientId=...
// Redirects the admin to Google's consent screen. The client's row id is
// passed through as `state` so the callback knows which client to update.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");

  if (!clientId) {
    return NextResponse.json({ ok: false, error: "Missing clientId" }, { status: 400 });
  }

  if (!GOOGLE_OAUTH_CLIENT_ID) {
    const url = new URL(`/admin/clients/${clientId}`, req.url);
    url.searchParams.set("error", "youtube_not_configured");
    return NextResponse.redirect(url);
  }

  const redirectUri = `${req.nextUrl.origin}/api/oauth/youtube/callback`;

  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: "https://www.googleapis.com/auth/youtube.force-ssl",
    state: clientId,
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

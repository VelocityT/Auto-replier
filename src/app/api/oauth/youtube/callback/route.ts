import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { exchangeGoogleCode } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

// GET /api/oauth/youtube/callback — Google redirects here after consent.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const clientId = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (!clientId) {
    // No state at all — nowhere useful to send the admin back to.
    return NextResponse.redirect(new URL("/admin/clients", req.url));
  }

  const adminUrl = new URL(`/admin/clients/${clientId}`, req.url);

  if (oauthError) {
    adminUrl.searchParams.set("error", `youtube_${oauthError}`);
    return NextResponse.redirect(adminUrl);
  }

  if (!code) {
    adminUrl.searchParams.set("error", "youtube_missing_code");
    return NextResponse.redirect(adminUrl);
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/oauth/youtube/callback`;
    const tokens = await exchangeGoogleCode(code, redirectUri);

    if (!tokens.refresh_token) {
      // Happens if the client previously granted access without revoking —
      // Google only issues a refresh token on the first consent (or when
      // prompt=consent forces re-consent, which /start already sets).
      adminUrl.searchParams.set("error", "youtube_no_refresh_token");
      return NextResponse.redirect(adminUrl);
    }

    // Fetch the channel that owns this token, so we can store its ID.
    let channelId: string | null = null;
    try {
      const channelRes = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
      );
      if (channelRes.ok) {
        const channelData = await channelRes.json();
        channelId = channelData.items?.[0]?.id ?? null;
      }
    } catch {
      // Non-fatal — the refresh token is still saved below.
    }

    const { error: dbError } = await supabase
      .from("clients")
      .update({
        youtube_refresh_token: tokens.refresh_token,
        youtube_channel_id: channelId,
      })
      .eq("id", clientId);

    if (dbError) {
      adminUrl.searchParams.set("error", "youtube_save_failed");
      return NextResponse.redirect(adminUrl);
    }

    adminUrl.searchParams.set("connected", "youtube");
    return NextResponse.redirect(adminUrl);
  } catch {
    adminUrl.searchParams.set("error", "youtube_token_exchange_failed");
    return NextResponse.redirect(adminUrl);
  }
}

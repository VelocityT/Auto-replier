import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  exchangeMetaCode,
  exchangeForLongLivedToken,
  getInstagramAccount,
} from "@/lib/meta";

export const dynamic = "force-dynamic";

// GET /api/oauth/meta/callback — Meta redirects here after the login dialog.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const clientId = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (!clientId) {
    return NextResponse.redirect(new URL("/admin/clients", req.url));
  }

  const adminUrl = new URL(`/admin/clients/${clientId}`, req.url);

  if (oauthError) {
    adminUrl.searchParams.set("error", "meta_access_denied");
    return NextResponse.redirect(adminUrl);
  }

  if (!code) {
    adminUrl.searchParams.set("error", "meta_token_exchange_failed");
    return NextResponse.redirect(adminUrl);
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/oauth/meta/callback`;

    const shortLived = await exchangeMetaCode(code, redirectUri);
    const longLived = await exchangeForLongLivedToken(shortLived.access_token);

    // Instagram Login authorizes exactly one account, so there is no Page
    // list and no picker step — read the profile straight off the token.
    const account = await getInstagramAccount(longLived.access_token);

    // Long-lived tokens last ~60 days and must be refreshed before expiry.
    // Store the expiry so the cron can refresh proactively.
    const expiresAt = new Date(Date.now() + (longLived.expires_in ?? 0) * 1000).toISOString();

    const { error: dbError } = await supabase
      .from("clients")
      .update({
        meta_ig_account_id: account.id,
        meta_ig_username: account.username,
        meta_page_access_token: longLived.access_token,
        meta_token_expires_at: expiresAt,
        // No Facebook Page in the Instagram Login flow.
        meta_page_id: null,
      })
      .eq("id", clientId);

    if (dbError) {
      adminUrl.searchParams.set("error", "meta_save_failed");
      return NextResponse.redirect(adminUrl);
    }

    adminUrl.searchParams.set("connected", "instagram");
    return NextResponse.redirect(adminUrl);
  } catch {
    adminUrl.searchParams.set("error", "meta_token_exchange_failed");
    return NextResponse.redirect(adminUrl);
  }
}

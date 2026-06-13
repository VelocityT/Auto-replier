import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { exchangeGoogleCode } from "@/lib/google-auth";
import { listAccounts, listLocations } from "@/lib/gbp";

export const dynamic = "force-dynamic";

// Resource names look like "accounts/1234567890" or
// "accounts/1234567890/locations/9876543210" — we only store the trailing id.
function lastSegment(resourceName: string): string {
  return resourceName.split("/").pop() ?? resourceName;
}

// GET /api/oauth/gbp/callback — Google redirects here after consent.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const clientId = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (!clientId) {
    return NextResponse.redirect(new URL("/admin/clients", req.url));
  }

  const adminUrl = new URL(`/admin/clients/${clientId}`, req.url);

  if (oauthError) {
    adminUrl.searchParams.set("error", `gbp_${oauthError}`);
    return NextResponse.redirect(adminUrl);
  }

  if (!code) {
    adminUrl.searchParams.set("error", "gbp_missing_code");
    return NextResponse.redirect(adminUrl);
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/oauth/gbp/callback`;
    const tokens = await exchangeGoogleCode(code, redirectUri);

    if (!tokens.refresh_token) {
      adminUrl.searchParams.set("error", "gbp_no_refresh_token");
      return NextResponse.redirect(adminUrl);
    }

    // Save the refresh token immediately, regardless of whether account/
    // location discovery below succeeds. GBP API access is a separate,
    // manually-approved step (case 7-5896000040841) — if it's still
    // pending, the connection is still recorded and locations can be
    // picked later once access is granted.
    const { error: saveError } = await supabase
      .from("clients")
      .update({ gbp_refresh_token: tokens.refresh_token })
      .eq("id", clientId);

    if (saveError) {
      adminUrl.searchParams.set("error", "gbp_save_failed");
      return NextResponse.redirect(adminUrl);
    }

    // Try to discover accounts/locations so we can auto-fill the IDs.
    let accounts;
    try {
      accounts = await listAccounts(tokens.refresh_token);
    } catch {
      // Likely 403 — API access not yet approved for this project.
      // The refresh token is already saved; surface a clear message.
      adminUrl.searchParams.set("error", "gbp_no_accounts");
      return NextResponse.redirect(adminUrl);
    }

    if (accounts.length === 0) {
      adminUrl.searchParams.set("error", "gbp_no_accounts");
      return NextResponse.redirect(adminUrl);
    }

    if (accounts.length > 1) {
      // Multiple accounts — let the admin pick.
      return NextResponse.redirect(new URL(`/admin/clients/${clientId}/gbp-locations`, req.url));
    }

    // Exactly one account — try to resolve a single location too.
    const account = accounts[0];
    const accountId = lastSegment(account.name);

    let locations;
    try {
      locations = await listLocations(tokens.refresh_token, account.name);
    } catch {
      await supabase.from("clients").update({ gbp_account_id: accountId }).eq("id", clientId);
      adminUrl.searchParams.set("error", "gbp_no_locations");
      return NextResponse.redirect(adminUrl);
    }

    if (locations.length === 0) {
      await supabase.from("clients").update({ gbp_account_id: accountId }).eq("id", clientId);
      adminUrl.searchParams.set("error", "gbp_no_locations");
      return NextResponse.redirect(adminUrl);
    }

    if (locations.length > 1) {
      await supabase.from("clients").update({ gbp_account_id: accountId }).eq("id", clientId);
      return NextResponse.redirect(
        new URL(`/admin/clients/${clientId}/gbp-locations?account=${encodeURIComponent(account.name)}`, req.url)
      );
    }

    // Exactly one account, exactly one location — fully resolved.
    const locationId = lastSegment(locations[0].name);

    const { error: dbError } = await supabase
      .from("clients")
      .update({ gbp_account_id: accountId, gbp_location_id: locationId })
      .eq("id", clientId);

    if (dbError) {
      adminUrl.searchParams.set("error", "gbp_save_failed");
      return NextResponse.redirect(adminUrl);
    }

    adminUrl.searchParams.set("connected", "gbp");
    return NextResponse.redirect(adminUrl);
  } catch {
    adminUrl.searchParams.set("error", "gbp_token_exchange_failed");
    return NextResponse.redirect(adminUrl);
  }
}

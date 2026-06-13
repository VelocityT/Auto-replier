import { NextRequest, NextResponse } from "next/server";
import { META_APP_ID, META_OAUTH_SCOPES } from "@/lib/meta";

export const dynamic = "force-dynamic";

// GET /api/oauth/meta/start?clientId=...
// Redirects the admin to Facebook's Login dialog. Covers both Instagram and
// Facebook — they share a single Page Access Token. The client's row id is
// passed through as `state` so the callback knows which client to update.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");

  if (!clientId) {
    return NextResponse.json({ ok: false, error: "Missing clientId" }, { status: 400 });
  }

  if (!META_APP_ID) {
    const url = new URL(`/admin/clients/${clientId}`, req.url);
    url.searchParams.set("error", "meta_not_configured");
    return NextResponse.redirect(url);
  }

  const redirectUri = `${req.nextUrl.origin}/api/oauth/meta/callback`;

  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: META_OAUTH_SCOPES,
    state: clientId,
  });

  return NextResponse.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`);
}

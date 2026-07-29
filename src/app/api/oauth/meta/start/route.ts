import { NextRequest, NextResponse } from "next/server";
import {
  INSTAGRAM_APP_ID,
  INSTAGRAM_OAUTH_AUTHORIZE_URL,
  META_OAUTH_SCOPES,
} from "@/lib/meta";

export const dynamic = "force-dynamic";

// GET /api/oauth/meta/start?clientId=...
//
// Redirects the client to Instagram's Business Login dialog. The client
// authorizes their own Instagram Business/Creator account directly — no
// linked Facebook Page needed, and no Page picker afterwards, since
// Instagram Login grants exactly one account per authorization.
//
// The client's row id rides along as `state` so the callback knows which
// client row to write the token to.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");

  if (!clientId) {
    return NextResponse.json({ ok: false, error: "Missing clientId" }, { status: 400 });
  }

  if (!INSTAGRAM_APP_ID) {
    const url = new URL(`/admin/clients/${clientId}`, req.url);
    url.searchParams.set("error", "meta_not_configured");
    return NextResponse.redirect(url);
  }

  const redirectUri = `${req.nextUrl.origin}/api/oauth/meta/callback`;

  const params = new URLSearchParams({
    client_id: INSTAGRAM_APP_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: META_OAUTH_SCOPES,
    state: clientId,
  });

  return NextResponse.redirect(`${INSTAGRAM_OAUTH_AUTHORIZE_URL}?${params.toString()}`);
}

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  exchangeMetaCode,
  exchangeForLongLivedToken,
  listPages,
  getInstagramAccountForPage,
  META_PAGES_COOKIE,
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

    const pages = await listPages(longLived.access_token);

    if (pages.length === 0) {
      // Typical before Meta App Review — only the app's own
      // developers/testers can be returned as manageable Pages.
      adminUrl.searchParams.set("error", "meta_no_pages");
      return NextResponse.redirect(adminUrl);
    }

    if (pages.length > 1) {
      // Multiple Pages — let the admin pick which one belongs to this client.
      const res = NextResponse.redirect(new URL(`/admin/clients/${clientId}/meta-pages`, req.url));
      res.cookies.set(
        META_PAGES_COOKIE,
        JSON.stringify({ clientId, pages }),
        {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 10, // 10 minutes
        }
      );
      return res;
    }

    // Exactly one Page — resolve its linked Instagram account (if any) and save.
    const page = pages[0];

    let igAccountId: string | null = null;
    try {
      igAccountId = await getInstagramAccountForPage(page.id, page.access_token);
    } catch {
      // Non-fatal — Facebook connection is still saved below.
    }

    const { error: dbError } = await supabase
      .from("clients")
      .update({
        meta_page_id: page.id,
        meta_page_access_token: page.access_token,
        meta_ig_account_id: igAccountId,
      })
      .eq("id", clientId);

    if (dbError) {
      adminUrl.searchParams.set("error", "meta_save_failed");
      return NextResponse.redirect(adminUrl);
    }

    adminUrl.searchParams.set("connected", "facebook");
    return NextResponse.redirect(adminUrl);
  } catch {
    adminUrl.searchParams.set("error", "meta_token_exchange_failed");
    return NextResponse.redirect(adminUrl);
  }
}

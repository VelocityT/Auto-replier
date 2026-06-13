import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getInstagramAccountForPage, META_PAGES_COOKIE, type MetaPage } from "@/lib/meta";

export const dynamic = "force-dynamic";

// POST /api/oauth/meta/select — form submission from the meta-pages picker.
// Resolves the chosen Page's linked Instagram account, saves the page
// access token, and clears the candidate-pages cookie.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const clientId = String(form.get("clientId") ?? "");
  const pageId = String(form.get("pageId") ?? "");

  if (!clientId) {
    return NextResponse.redirect(new URL("/admin/clients", req.url));
  }

  const adminUrl = new URL(`/admin/clients/${clientId}`, req.url);

  const raw = req.cookies.get(META_PAGES_COOKIE)?.value;
  if (!raw) {
    adminUrl.searchParams.set("error", "meta_no_pages");
    return NextResponse.redirect(adminUrl);
  }

  let pages: MetaPage[] = [];
  try {
    const parsed = JSON.parse(raw) as { clientId: string; pages: MetaPage[] };
    if (parsed.clientId !== clientId) {
      adminUrl.searchParams.set("error", "meta_no_pages");
      return NextResponse.redirect(adminUrl);
    }
    pages = parsed.pages ?? [];
  } catch {
    adminUrl.searchParams.set("error", "meta_no_pages");
    return NextResponse.redirect(adminUrl);
  }

  const page = pages.find((p) => p.id === pageId);
  if (!page) {
    adminUrl.searchParams.set("error", "meta_no_pages");
    return NextResponse.redirect(adminUrl);
  }

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
    const res = NextResponse.redirect(adminUrl);
    res.cookies.set(META_PAGES_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  adminUrl.searchParams.set("connected", "facebook");
  const res = NextResponse.redirect(adminUrl);
  res.cookies.set(META_PAGES_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

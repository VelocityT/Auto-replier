import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function lastSegment(resourceName: string): string {
  return resourceName.split("/").pop() ?? resourceName;
}

// POST /api/oauth/gbp/select — form submission from the gbp-locations picker.
// Saves the chosen account/location ids for a client and sends the admin
// back to the client edit page.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const clientId = String(form.get("clientId") ?? "");
  const accountName = String(form.get("accountName") ?? ""); // "accounts/123"
  const locationName = String(form.get("locationName") ?? ""); // "accounts/123/locations/456"

  if (!clientId) {
    return NextResponse.redirect(new URL("/admin/clients", req.url));
  }

  const adminUrl = new URL(`/admin/clients/${clientId}`, req.url);

  if (!accountName || !locationName) {
    adminUrl.searchParams.set("error", "gbp_no_locations");
    return NextResponse.redirect(adminUrl);
  }

  const { error } = await supabase
    .from("clients")
    .update({
      gbp_account_id: lastSegment(accountName),
      gbp_location_id: lastSegment(locationName),
    })
    .eq("id", clientId);

  if (error) {
    adminUrl.searchParams.set("error", "gbp_save_failed");
    return NextResponse.redirect(adminUrl);
  }

  adminUrl.searchParams.set("connected", "gbp");
  return NextResponse.redirect(adminUrl);
}

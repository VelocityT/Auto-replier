import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

// TEMPORARY DEBUG ROUTE — remove before onboarding real clients (see task #16).
// Visit /api/debug/env-check on the deployed site to see (masked) env values
// and the live result of the Review Queue query.

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.SUPABASE_URL ?? null;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  const keyPreview = key
    ? `${key.slice(0, 14)}...${key.slice(-4)} (len ${key.length})`
    : null;

  const { data, error } = await supabase
    .from("flagged_items")
    .select("id, status, client_id, clients(name)")
    .eq("status", "pending");

  // Exact same query as src/app/page.tsx (Review Queue), for comparison.
  const { data: pageData, error: pageError } = await supabase
    .from("flagged_items")
    .select("id, platform, author_name, original_text, ai_analysis, created_at, clients(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return NextResponse.json({
    supabaseUrl: url,
    serviceKeyPreview: keyPreview,
    queryError: error ? error.message : null,
    rowCount: data?.length ?? null,
    data,
    pageQuery: {
      error: pageError ? pageError.message : null,
      rowCount: pageData?.length ?? null,
      data: pageData,
    },
  });
}

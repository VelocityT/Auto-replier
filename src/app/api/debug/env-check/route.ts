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

  // Simple columns + order only (isolate .order()).
  const { data: orderOnlyData, error: orderOnlyError } = await supabase
    .from("flagged_items")
    .select("id, status, client_id, clients(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  // Full columns, no order (isolate extra columns).
  const { data: fullNoOrderData, error: fullNoOrderError } = await supabase
    .from("flagged_items")
    .select("id, platform, author_name, original_text, ai_analysis, created_at, clients(name)")
    .eq("status", "pending");

  // Full columns minus ai_analysis, with order (isolate ai_analysis jsonb column).
  const { data: noAiAnalysisData, error: noAiAnalysisError } = await supabase
    .from("flagged_items")
    .select("id, platform, author_name, original_text, created_at, clients(name)")
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
    orderOnly: {
      error: orderOnlyError ? orderOnlyError.message : null,
      rowCount: orderOnlyData?.length ?? null,
    },
    fullNoOrder: {
      error: fullNoOrderError ? fullNoOrderError.message : null,
      rowCount: fullNoOrderData?.length ?? null,
    },
    noAiAnalysis: {
      error: noAiAnalysisError ? noAiAnalysisError.message : null,
      rowCount: noAiAnalysisData?.length ?? null,
    },
  });
}

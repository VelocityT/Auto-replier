import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Returns all pending flagged items (negative/urgent/spam comments and
// reviews waiting for a human to approve, edit, or reject the AI's
// suggested reply), newest first.
export async function GET() {
  const { data, error } = await supabase
    .from("flagged_items")
    .select("*, clients(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, items: data });
}

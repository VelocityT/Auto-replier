import { supabase } from "@/lib/supabase";
import FlaggedQueue, { type FlaggedItemWithClient } from "./components/FlaggedQueue";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { data, error } = await supabase
    .from("flagged_items")
    .select("id, platform, author_name, original_text, ai_analysis, created_at, clients(name)")
    .eq("status", "pending");

  // Sorted in JS, not via .order() — combining .order("created_at") with the
  // ai_analysis (jsonb) column + clients(name) embed causes PostgREST to
  // silently return 0 rows (no error) on this Supabase project. Confirmed via
  // /api/debug/env-check: every other column/order combination works fine.
  const items = ((data ?? []) as unknown as FlaggedItemWithClient[]).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="container">
      <h1>Review Queue</h1>
      <p className="subtitle">
        Negative, urgent, or low-confidence comments &amp; reviews wait here for a quick
        approve / edit / reject before posting. Everything else is replied to automatically.
      </p>

      {error ? (
        <div className="card">Error loading queue: {error.message}</div>
      ) : (
        <FlaggedQueue initialItems={items} />
      )}
    </div>
  );
}

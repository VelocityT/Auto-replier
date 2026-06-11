import { supabase } from "@/lib/supabase";
import FlaggedQueue, { type FlaggedItemWithClient } from "./components/FlaggedQueue";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { data, error } = await supabase
    .from("flagged_items")
    .select("id, platform, author_name, original_text, ai_analysis, created_at, clients(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

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
        <FlaggedQueue initialItems={(data ?? []) as unknown as FlaggedItemWithClient[]} />
      )}
    </div>
  );
}

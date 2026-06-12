import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { analyzeCommentsBatch } from "@/lib/ai";
import { listReviews, replyToReview } from "@/lib/gbp";
import type { ClientConfig } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Polling endpoint for Google Business Profile reviews — GBP has no webhooks.
 *
 * Trigger this on a schedule using a free external pinger such as
 * https://cron-job.org (every 15-30 minutes is plenty for reviews), e.g.:
 *   GET https://your-app.vercel.app/api/cron/gbp?secret=YOUR_CRON_SECRET
 *
 * NOTE: Negative reviews are ALWAYS flagged for human approval, never
 * auto-posted — see ai.ts guardrails. This is deliberate: a tone-deaf
 * AI reply to a 1-star review is the kind of mistake that costs a client
 * relationship.
 */
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { data: clients, error } = await supabase
    .from("clients")
    .select("*")
    .eq("active", true)
    .not("gbp_account_id", "is", null)
    .not("gbp_location_id", "is", null)
    .not("gbp_refresh_token", "is", null)
    .returns<ClientConfig[]>();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const summary: Record<string, number> = {};

  for (const client of clients ?? []) {
    let processedCount = 0;
    try {
      const reviews = await listReviews(
        client.gbp_account_id!,
        client.gbp_location_id!,
        client.gbp_refresh_token!,
        20
      );

      // Pass 1: figure out which reviews are actually new — no AI calls yet.
      const newReviews: typeof reviews = [];
      for (const review of reviews) {
        if (review.hasReply) continue;
        if (!review.comment) continue; // star-only reviews with no text — skip auto-analysis

        const { data: existing } = await supabase
          .from("processed_items")
          .select("id")
          .eq("client_id", client.id)
          .eq("platform", "gbp")
          .eq("external_id", review.reviewId)
          .maybeSingle();

        if (existing) continue;
        newReviews.push(review);
      }

      // Pass 2: one Gemini call for ALL of this client's new reviews.
      const analyses = await analyzeCommentsBatch(
        newReviews.map((r) => ({ id: r.reviewId, text: r.comment })),
        client.ai_instructions
      );

      for (const review of newReviews) {
        const analysis = analyses.get(review.reviewId)!;

        // Extra guardrail specific to reviews: only auto-post replies to
        // 4-5 star reviews. Anything 3 stars or below always goes to a human,
        // regardless of what the sentiment classifier says.
        const starNum = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[review.starRating] ?? 0;
        const safeToAutoReply = analysis.shouldAutoReply && starNum >= 4;

        if (safeToAutoReply && analysis.reply) {
          await replyToReview(review.name, analysis.reply, client.gbp_refresh_token!);

          await supabase.from("processed_items").insert({
            client_id: client.id,
            platform: "gbp",
            external_id: review.reviewId,
            status: "auto_replied",
          });
        } else {
          await supabase.from("flagged_items").insert({
            client_id: client.id,
            platform: "gbp",
            external_id: review.reviewId,
            author_name: review.reviewerName,
            original_text: review.comment,
            ai_analysis: analysis,
            status: "pending",
          });

          await supabase.from("processed_items").insert({
            client_id: client.id,
            platform: "gbp",
            external_id: review.reviewId,
            status: "flagged",
          });
        }

        processedCount++;
      }
    } catch (err) {
      console.error(`[cron/gbp] client ${client.id} failed`, err);
    }

    summary[client.name] = processedCount;
  }

  return NextResponse.json({ ok: true, processed: summary });
}

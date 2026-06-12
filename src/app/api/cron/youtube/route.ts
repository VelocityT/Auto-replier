import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { analyzeCommentsBatch } from "@/lib/ai";
import { listRecentComments, replyToComment } from "@/lib/youtube";
import type { ClientConfig } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — Vercel Hobby allows up to 60s on Node functions

/**
 * Polling endpoint for YouTube comments — YouTube has no webhooks.
 *
 * Trigger this on a schedule using a free external pinger such as
 * https://cron-job.org (every 5-15 minutes), e.g.:
 *   GET https://your-app.vercel.app/api/cron/youtube?secret=YOUR_CRON_SECRET
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
    .not("youtube_channel_id", "is", null)
    .not("youtube_refresh_token", "is", null)
    .returns<ClientConfig[]>();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const summary: Record<string, number> = {};

  for (const client of clients ?? []) {
    let processedCount = 0;
    try {
      const comments = await listRecentComments(
        client.youtube_channel_id!,
        client.youtube_refresh_token!,
        20
      );

      // Pass 1: figure out which comments are actually new — no AI calls yet.
      const newComments: typeof comments = [];
      for (const comment of comments) {
        const { data: existing } = await supabase
          .from("processed_items")
          .select("id")
          .eq("client_id", client.id)
          .eq("platform", "youtube")
          .eq("external_id", comment.commentId)
          .maybeSingle();

        if (existing) continue;
        newComments.push(comment);
      }

      // Pass 2: one Gemini call for ALL of this client's new comments.
      const analyses = await analyzeCommentsBatch(
        newComments.map((c) => ({ id: c.commentId, text: c.text })),
        client.ai_instructions
      );

      for (const comment of newComments) {
        const analysis = analyses.get(comment.commentId)!;

        if (analysis.shouldAutoReply && analysis.reply) {
          await replyToComment(comment.commentId, analysis.reply, client.youtube_refresh_token!);

          await supabase.from("processed_items").insert({
            client_id: client.id,
            platform: "youtube",
            external_id: comment.commentId,
            status: "auto_replied",
          });
        } else {
          await supabase.from("flagged_items").insert({
            client_id: client.id,
            platform: "youtube",
            external_id: comment.commentId,
            author_name: comment.authorName,
            original_text: comment.text,
            ai_analysis: analysis,
            status: "pending",
          });

          await supabase.from("processed_items").insert({
            client_id: client.id,
            platform: "youtube",
            external_id: comment.commentId,
            status: "flagged",
          });
        }

        processedCount++;
      }
    } catch (err) {
      console.error(`[cron/youtube] client ${client.id} failed`, err);
    }

    summary[client.name] = processedCount;
  }

  return NextResponse.json({ ok: true, processed: summary });
}

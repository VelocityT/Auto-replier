import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { analyzeCommentsBatch } from "@/lib/ai";
import { replyToComment } from "@/lib/meta";
import type { ClientConfig, PostRef } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — Vercel Hobby allows up to 60s on Node functions

interface PendingComment {
  id: string;
  client_id: string;
  platform: "instagram" | "facebook";
  external_id: string;
  author_name: string | null;
  text: string;
  post_ref: PostRef | null;
}

/**
 * Drains `pending_comments` — the queue the Instagram/Facebook webhook
 * enqueues into instead of calling the AI directly (see
 * src/app/api/webhooks/meta/route.ts).
 *
 * Why this exists: Gemini's free tier is 20 requests/day/model. Calling the
 * AI once per incoming comment (the old behaviour) is fine for a handful of
 * comments a day but falls over well before ~100/day — every comment after
 * the quota's gone gets silently flagged instead of replied. This route
 * batches whatever's piled up per client into ONE analyzeCommentsBatch()
 * call per run, exactly like the existing YouTube/GBP crons — so daily
 * request count tracks "how often there's something pending", not "how many
 * comments arrived".
 *
 * Trigger this on a schedule using a free external pinger such as
 * https://cron-job.org — every 3-5 minutes keeps reply latency low without
 * multiplying Gemini calls (a run finds nothing pending and does zero AI
 * calls if no comments arrived since the last one), e.g.:
 *   GET https://your-app.vercel.app/api/cron/flush-comments?secret=YOUR_CRON_SECRET
 */
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Which clients actually have something waiting? Only touch those — a
  // quiet client costs nothing, which is the whole point.
  const { data: pendingRows, error: pendingError } = await supabase
    .from("pending_comments")
    .select("client_id")
    .returns<Pick<PendingComment, "client_id">[]>();

  if (pendingError) {
    return NextResponse.json({ ok: false, error: pendingError.message }, { status: 500 });
  }

  const clientIds = [...new Set((pendingRows ?? []).map((r) => r.client_id))];
  const summary: Record<string, number> = {};

  if (clientIds.length === 0) {
    return NextResponse.json({ ok: true, processed: summary });
  }

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("*")
    .in("id", clientIds)
    .eq("active", true)
    .returns<ClientConfig[]>();

  if (clientsError) {
    return NextResponse.json({ ok: false, error: clientsError.message }, { status: 500 });
  }

  for (const client of clients ?? []) {
    let processedCount = 0;
    try {
      // Cap per run so one very chatty client can't eat the whole 60s budget
      // (and can't blow past a single Gemini call's practical size either).
      // Leftovers just wait for the next run.
      const { data: items, error: itemsError } = await supabase
        .from("pending_comments")
        .select("*")
        .eq("client_id", client.id)
        .order("created_at", { ascending: true })
        .limit(30)
        .returns<PendingComment[]>();

      if (itemsError || !items || items.length === 0) continue;

      console.log(
        `[cron/flush-comments] client ${client.name} (${client.id}): ${items.length} pending item(s) — ${items
          .map((i) => i.external_id)
          .join(", ")}`
      );

      const analyses = await analyzeCommentsBatch(
        items.map((c) => ({ id: c.external_id, text: c.text })),
        client.ai_instructions
      );

      for (const item of items) {
        const analysis = analyses.get(item.external_id)!;
        console.log(
          `[cron/flush-comments] ${item.external_id}: sentiment=${analysis.sentiment} shouldAutoReply=${analysis.shouldAutoReply}`
        );

        try {
          if (analysis.shouldAutoReply && analysis.reply && client.meta_page_access_token) {
            // Instagram tokens hit graph.instagram.com, Facebook Page tokens
            // hit graph.facebook.com — pass the platform so the right host
            // is used.
            await replyToComment(
              item.external_id,
              analysis.reply,
              client.meta_page_access_token,
              item.platform
            );

            await supabase.from("processed_items").insert({
              client_id: client.id,
              platform: item.platform,
              external_id: item.external_id,
              status: "auto_replied",
              post_ref: item.post_ref,
              original_text: item.text,
              reply_text: analysis.reply,
            });
          } else {
            await supabase.from("flagged_items").insert({
              client_id: client.id,
              platform: item.platform,
              external_id: item.external_id,
              author_name: item.author_name,
              original_text: item.text,
              ai_analysis: analysis,
              status: "pending",
              post_ref: item.post_ref,
            });

            await supabase.from("processed_items").insert({
              client_id: client.id,
              platform: item.platform,
              external_id: item.external_id,
              status: "flagged",
              post_ref: item.post_ref,
              original_text: item.text,
              reply_text: null,
            });
          }

          // Only dequeue once it's safely recorded in processed_items —
          // if anything above throws, this row is left in place and picked
          // up again next run instead of being lost.
          await supabase.from("pending_comments").delete().eq("id", item.id);
          processedCount++;
        } catch (err) {
          console.error(
            `[cron/flush-comments] client ${client.id} item ${item.external_id} failed, left queued for retry`,
            err
          );
        }
      }
    } catch (err) {
      console.error(`[cron/flush-comments] client ${client.id} failed`, err);
    }

    summary[client.name] = processedCount;
  }

  return NextResponse.json({ ok: true, processed: summary });
}

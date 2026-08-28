import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { parseWebhookEvents, verifyWebhookSignatureAny } from "@/lib/meta";
import type { ClientConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────
// GET: Meta webhook verification handshake.
// When you register the webhook URL in your Meta app, Meta calls this once
// with hub.mode=subscribe to confirm you control the endpoint.
// ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// ─────────────────────────────────────────────
// POST: real-time comment events from Instagram / Facebook.
// ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const signature = req.headers.get("x-hub-signature-256");

  // Instagram Login webhooks are signed with the INSTAGRAM app secret;
  // Facebook Page webhooks are signed with the FACEBOOK app secret. Both
  // land on this endpoint and look alike, so accept either.
  const accepted = verifyWebhookSignatureAny(rawBody, signature, [
    process.env.INSTAGRAM_APP_SECRET,
    process.env.META_APP_SECRET,
  ]);

  if (!accepted) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const events = parseWebhookEvents(payload);

  // Always return 200 quickly so Meta doesn't retry/disable the webhook —
  // process everything we can, but never let one bad event fail the batch.
  for (const event of events) {
    try {
      await handleCommentEvent(event);
    } catch (err) {
      console.error("[meta webhook] failed to handle event", event, err);
    }
  }

  return NextResponse.json({ ok: true });
}

async function handleCommentEvent(event: ReturnType<typeof parseWebhookEvents>[number]) {
  // Unconditional trace — every event Meta sends, logged before any filter
  // has a chance to drop it. Added after a comment (brajrajhospital
  // "Wonderful") vanished with zero trace: the webhook returned 200, but
  // nothing showed up in processed_items, flagged_items, or pending_comments,
  // and every other log line in this function only fires on a specific
  // branch (skip / not-found / error) — there was no way to tell which
  // branch even ran. This line always fires, so the next unexplained drop
  // is debuggable from logs alone instead of guessing.
  console.log(
    `[meta webhook] event received: platform=${event.platform} pageOrAccountId=${event.pageOrAccountId} authorId=${event.authorId} authorName=${event.authorName} commentId=${event.commentId}`
  );

  // Look up which client this page/IG account belongs to.
  const column = event.platform === "instagram" ? "meta_ig_account_id" : "meta_page_id";

  const { data: client, error } = await supabase
    .from("clients")
    .select("*")
    .eq(column, event.pageOrAccountId)
    .eq("active", true)
    .maybeSingle<ClientConfig>();

  if (error || !client) {
    console.warn(`[meta webhook] no active client found for ${column}=${event.pageOrAccountId}`, error ?? "");
    return;
  }

  console.log(`[meta webhook] matched client=${client.name} (${client.id})`);

  // Skip comments posted by the connected account itself. Posting a reply is
  // *also* a comment, and this account is subscribed to the `comments` field
  // on its own posts — so every auto-reply we send generates a brand new
  // webhook event that looks exactly like an incoming comment. Without this
  // check the app analyzes its own reply, decides it's a nice positive
  // message, and replies to itself again — a self-sustaining loop that only
  // ever stopped in production because the Gemini free-tier daily quota ran
  // out (confirmed live, Aug 2026: ~10 near-identical "Thank you for your
  // kind words..." replies stacked on one comment before the 429s started).
  const isSelfComment =
    (event.authorId && event.authorId === client.meta_ig_account_id) ||
    (event.authorName &&
      client.meta_ig_username &&
      event.authorName.toLowerCase() === client.meta_ig_username.toLowerCase());

  if (isSelfComment) {
    console.info(
      `[meta webhook] skipping self-authored comment ${event.commentId} (from connected account, not a real customer)`
    );
    return;
  }

  // Skip if we've already processed this comment (Meta can send duplicates).
  const { data: existing } = await supabase
    .from("processed_items")
    .select("id")
    .eq("client_id", client.id)
    .eq("platform", event.platform)
    .eq("external_id", event.commentId)
    .maybeSingle();

  if (existing) {
    console.log(`[meta webhook] comment ${event.commentId} already in processed_items, skipping`);
    return;
  }

  // Don't call the AI here — just enqueue. Gemini's free tier is 20
  // requests/day/model, so one call per incoming comment falls over well
  // before ~100 comments/day. /api/cron/flush-comments drains this table
  // per client in one analyzeCommentsBatch() call, the same batching trick
  // the YouTube/GBP crons already use. onConflict + ignoreDuplicates is a
  // second safety net alongside the processed_items check above, in case two
  // webhook deliveries for the same comment race each other here.
  const { error: enqueueError } = await supabase.from("pending_comments").upsert(
    {
      client_id: client.id,
      platform: event.platform,
      external_id: event.commentId,
      author_name: event.authorName,
      text: event.text,
      post_ref: event.postRef,
    },
    { onConflict: "client_id,platform,external_id", ignoreDuplicates: true }
  );

  if (enqueueError) {
    console.error(`[meta webhook] failed to enqueue comment ${event.commentId}`, enqueueError);
  } else {
    console.log(`[meta webhook] enqueued comment ${event.commentId} for client ${client.name}`);
  }
}

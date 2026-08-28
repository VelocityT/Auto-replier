import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { analyzeComment } from "@/lib/ai";
import { parseWebhookEvents, replyToComment, verifyWebhookSignatureAny } from "@/lib/meta";
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
  // Look up which client this page/IG account belongs to.
  const column = event.platform === "instagram" ? "meta_ig_account_id" : "meta_page_id";

  const { data: client, error } = await supabase
    .from("clients")
    .select("*")
    .eq(column, event.pageOrAccountId)
    .eq("active", true)
    .maybeSingle<ClientConfig>();

  if (error || !client) {
    console.warn(`[meta webhook] no active client found for ${column}=${event.pageOrAccountId}`);
    return;
  }

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

  if (existing) return;

  const analysis = await analyzeComment(event.text, client.ai_instructions);

  if (analysis.shouldAutoReply && analysis.reply && client.meta_page_access_token) {
    // Instagram tokens hit graph.instagram.com, Facebook Page tokens hit
    // graph.facebook.com — pass the platform so the right host is used.
    await replyToComment(
      event.commentId,
      analysis.reply,
      client.meta_page_access_token,
      event.platform
    );

    await supabase.from("processed_items").insert({
      client_id: client.id,
      platform: event.platform,
      external_id: event.commentId,
      status: "auto_replied",
      post_ref: event.postRef,
      original_text: event.text,
      reply_text: analysis.reply,
    });
  } else {
    await supabase.from("flagged_items").insert({
      client_id: client.id,
      platform: event.platform,
      external_id: event.commentId,
      author_name: event.authorName,
      original_text: event.text,
      ai_analysis: analysis,
      status: "pending",
      post_ref: event.postRef,
    });

    await supabase.from("processed_items").insert({
      client_id: client.id,
      platform: event.platform,
      external_id: event.commentId,
      status: "flagged",
      post_ref: event.postRef,
      original_text: event.text,
      reply_text: null,
    });
  }
}

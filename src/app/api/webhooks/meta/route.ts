import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { analyzeComment } from "@/lib/ai";
import { parseWebhookEvents, replyToComment, verifyWebhookSignature } from "@/lib/meta";
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
  const appSecret = process.env.META_APP_SECRET ?? "";

  if (!verifyWebhookSignature(rawBody, signature, appSecret)) {
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
    await replyToComment(event.commentId, analysis.reply, client.meta_page_access_token);

    await supabase.from("processed_items").insert({
      client_id: client.id,
      platform: event.platform,
      external_id: event.commentId,
      status: "auto_replied",
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
    });

    await supabase.from("processed_items").insert({
      client_id: client.id,
      platform: event.platform,
      external_id: event.commentId,
      status: "flagged",
    });
  }
}

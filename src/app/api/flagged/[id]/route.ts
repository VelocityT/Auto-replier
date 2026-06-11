import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { replyToComment as replyToMetaComment } from "@/lib/meta";
import { replyToComment as replyToYoutubeComment } from "@/lib/youtube";
import { replyToReview as replyToGbpReview } from "@/lib/gbp";
import type { ClientConfig, FlaggedItem } from "@/lib/types";

export const dynamic = "force-dynamic";

interface ActionBody {
  action: "approve" | "reject";
  // Optional: let the human edit the reply before posting.
  replyText?: string;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json()) as ActionBody;

  const { data: item, error } = await supabase
    .from("flagged_items")
    .select("*")
    .eq("id", params.id)
    .maybeSingle<FlaggedItem>();

  if (error || !item) {
    return NextResponse.json({ ok: false, error: "Flagged item not found" }, { status: 404 });
  }

  if (item.status !== "pending") {
    return NextResponse.json({ ok: false, error: `Item already ${item.status}` }, { status: 409 });
  }

  if (body.action === "reject") {
    await supabase.from("flagged_items").update({ status: "rejected" }).eq("id", item.id);
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // action === "approve"
  const replyText = body.replyText?.trim() || item.ai_analysis.reply;

  if (!replyText) {
    return NextResponse.json(
      { ok: false, error: "No reply text available — provide replyText to approve this item." },
      { status: 400 }
    );
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("*")
    .eq("id", item.client_id)
    .maybeSingle<ClientConfig>();

  if (clientError || !client) {
    return NextResponse.json({ ok: false, error: "Client not found" }, { status: 404 });
  }

  try {
    switch (item.platform) {
      case "instagram":
      case "facebook":
        if (!client.meta_page_access_token) throw new Error("Missing meta_page_access_token");
        await replyToMetaComment(item.external_id, replyText, client.meta_page_access_token);
        break;

      case "youtube":
        if (!client.youtube_refresh_token) throw new Error("Missing youtube_refresh_token");
        await replyToYoutubeComment(item.external_id, replyText, client.youtube_refresh_token);
        break;

      case "gbp": {
        if (!client.gbp_refresh_token) throw new Error("Missing gbp_refresh_token");
        const reviewName = `accounts/${client.gbp_account_id}/locations/${client.gbp_location_id}/reviews/${item.external_id}`;
        await replyToGbpReview(reviewName, replyText, client.gbp_refresh_token);
        break;
      }
    }
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: `Failed to post reply: ${err.message}` }, { status: 502 });
  }

  await supabase.from("flagged_items").update({ status: "posted" }).eq("id", item.id);

  return NextResponse.json({ ok: true, status: "posted" });
}

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { refreshLongLivedToken, subscribeToWebhooks } from "@/lib/meta";
import type { ClientConfig } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Keeps Instagram connections alive.
 *
 * Instagram long-lived tokens last ~60 days. When one lapses nothing errors
 * loudly — the client just silently stops getting auto-replies, and we only
 * find out when they complain. `refreshLongLivedToken` buys another 60 days
 * and can be called any time the token is >24h old and not yet expired.
 *
 * Trigger daily from cron-job.org:
 *   GET https://auto-replier.vercel.app/api/cron/refresh-tokens?secret=YOUR_CRON_SECRET
 *
 * Daily is deliberate overkill — the window is 7 days wide, so we can miss
 * six consecutive runs and still recover.
 */

// Refresh anything expiring within this many days.
const REFRESH_WINDOW_DAYS = 7;

// Meta rejects a refresh on a token younger than 24h. Skip those; the next
// day's run picks them up.
const MIN_TOKEN_AGE_HOURS = 24;

// A long-lived token is minted with ~60 days of life.
const LONG_LIVED_TOKEN_DAYS = 60;

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const now = Date.now();
  const cutoff = new Date(now + REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: clients, error } = await supabase
    .from("clients")
    .select("*")
    .eq("active", true)
    .not("meta_page_access_token", "is", null)
    .not("meta_token_expires_at", "is", null)
    .lte("meta_token_expires_at", cutoff)
    .returns<ClientConfig[]>();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const refreshed: string[] = [];
  const skipped: Record<string, string> = {};
  const failed: Record<string, string> = {};

  for (const client of clients ?? []) {
    try {
      const expiresAt = new Date(client.meta_token_expires_at!).getTime();

      // Already dead — refreshing won't work, the client has to reconnect.
      // Surface it rather than retrying forever.
      if (expiresAt <= now) {
        skipped[client.name] = "token already expired — client must reconnect Instagram";
        continue;
      }

      // Derive issue time from expiry. A token issued <24h ago can't be
      // refreshed yet.
      const issuedAt = expiresAt - LONG_LIVED_TOKEN_DAYS * 24 * 60 * 60 * 1000;
      const ageHours = (now - issuedAt) / (60 * 60 * 1000);
      if (ageHours < MIN_TOKEN_AGE_HOURS) {
        skipped[client.name] = "token younger than 24h — will retry tomorrow";
        continue;
      }

      const result = await refreshLongLivedToken(client.meta_page_access_token!);

      const newExpiry = new Date(now + (result.expires_in ?? 0) * 1000).toISOString();

      const { error: dbError } = await supabase
        .from("clients")
        .update({
          meta_page_access_token: result.access_token,
          meta_token_expires_at: newExpiry,
        })
        .eq("id", client.id);

      if (dbError) {
        // The refresh succeeded but we failed to persist it. The old token
        // still works for now, so the next run retries — but log loudly.
        failed[client.name] = `refreshed but DB write failed: ${dbError.message}`;
        console.error(`[cron/refresh-tokens] DB write failed for ${client.id}`, dbError);
        continue;
      }

      // Re-confirm the webhook subscription on every refresh. Cheap, and it
      // means a client can never silently drift into "connected but Meta
      // isn't actually sending events" the way the very first Instagram
      // Login connections did before this call existed in the OAuth callback.
      if (client.meta_ig_account_id) {
        await subscribeToWebhooks(client.meta_ig_account_id, result.access_token);
      }

      refreshed.push(client.name);
    } catch (err: any) {
      // Never log the token itself.
      failed[client.name] = String(err?.message ?? err).slice(0, 200);
      console.error(`[cron/refresh-tokens] client ${client.id} failed`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    checked: clients?.length ?? 0,
    refreshed,
    skipped,
    failed,
  });
}

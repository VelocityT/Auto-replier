import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { toSafeClient } from "@/lib/clients";
import type { ClientConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

// Fields cleared per platform. Instagram and Facebook share a single Meta
// Page connection (one Page Access Token covers both), so disconnecting
// either one clears the whole "meta" connection.
const FIELD_SETS: Record<string, Record<string, null>> = {
  youtube: {
    youtube_channel_id: null,
    youtube_refresh_token: null,
  },
  gbp: {
    gbp_account_id: null,
    gbp_location_id: null,
    gbp_refresh_token: null,
  },
  facebook: {
    meta_page_id: null,
    meta_ig_account_id: null,
    meta_page_access_token: null,
  },
  instagram: {
    meta_page_id: null,
    meta_ig_account_id: null,
    meta_page_access_token: null,
  },
};

interface DisconnectBody {
  platform?: string;
}

// POST /api/clients/[id]/disconnect — clear stored tokens for one platform.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: DisconnectBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const platform = body.platform ?? "";
  const fields = FIELD_SETS[platform];
  if (!fields) {
    return NextResponse.json(
      { ok: false, error: `Unknown platform "${platform}"` },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("clients")
    .update(fields)
    .eq("id", params.id)
    .select("*")
    .maybeSingle<ClientConfig>();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "Client not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, client: toSafeClient(data) });
}

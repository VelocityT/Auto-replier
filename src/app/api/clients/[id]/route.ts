import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { toSafeClient } from "@/lib/clients";
import type { ClientConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/clients/[id] — fetch one client (safe fields only).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", params.id)
    .maybeSingle<ClientConfig>();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "Client not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, client: toSafeClient(data) });
}

interface UpdateBody {
  name?: string;
  ai_instructions?: string;
  active?: boolean;
  // Escape hatch for the Instagram Login ID-mismatch issue: the ID returned
  // by graph.instagram.com/me at connect time (saved by the OAuth callback)
  // can differ from the ID Meta's webhook actually delivers in entry.id for
  // the very same account — a known, unresolved Meta bug (see CLAUDE.md,
  // "Known issues" — Instagram webhook account ID mismatch). When that
  // happens the webhook handler logs
  // "[meta webhook] no active client found for meta_ig_account_id=<id>"
  // forever, and no comment ever reaches the dashboard. Once you've seen
  // that log line, PATCH this field to the ID it reports and webhooks start
  // matching immediately. Not exposed in the UI (deliberately) — this is a
  // manual correction, not something a client-facing form should invite
  // people to fiddle with.
  meta_ig_account_id?: string;
}

// PATCH /api/clients/[id] — update name / ai_instructions / active.
// Platform connections are managed via /api/oauth/*, not this endpoint,
// except meta_ig_account_id — see the field comment above for why that one
// exists here too.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: UpdateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ ok: false, error: "Client name cannot be empty" }, { status: 400 });
    }
    update.name = name;
  }
  if (typeof body.ai_instructions === "string") update.ai_instructions = body.ai_instructions;
  if (typeof body.active === "boolean") update.active = body.active;
  if (typeof body.meta_ig_account_id === "string" && body.meta_ig_account_id.trim()) {
    update.meta_ig_account_id = body.meta_ig_account_id.trim();
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("clients")
    .update(update)
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

// DELETE /api/clients/[id] — remove a client entirely.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await supabase.from("clients").delete().eq("id", params.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

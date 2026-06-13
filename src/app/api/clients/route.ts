import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { toSafeClient } from "@/lib/clients";
import type { ClientConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/clients — list all clients (safe fields only, no tokens).
export async function GET() {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<ClientConfig[]>();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, clients: (data ?? []).map(toSafeClient) });
}

interface CreateBody {
  name?: string;
  ai_instructions?: string;
  active?: boolean;
}

// POST /api/clients — create a new client. Platform connections are added
// later via the "Connect" buttons on the client's edit page.
export async function POST(req: NextRequest) {
  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: "Client name is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("clients")
    .insert({
      name,
      ai_instructions: body.ai_instructions ?? "",
      active: body.active ?? true,
    })
    .select("*")
    .maybeSingle<ClientConfig>();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to create client" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, client: toSafeClient(data) }, { status: 201 });
}

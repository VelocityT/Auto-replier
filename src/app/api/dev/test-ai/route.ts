import { NextRequest, NextResponse } from "next/server";
import { analyzeComment } from "@/lib/ai";

// Quick local-testing endpoint — NOT used in production flows.
// Lets you try the AI sentiment/language/reply engine with just a
// GEMINI_API_KEY, no Supabase/Meta/YouTube/GBP setup required.
//
// POST /api/dev/test-ai  { "comment": "...", "instructions": "..." }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const comment: string = body.comment ?? "";
    const instructions: string =
      body.instructions ??
      "You are replying for a small local business. Be warm, professional, and concise.";

    if (!comment.trim()) {
      return NextResponse.json({ ok: false, error: "Missing 'comment' in request body" }, { status: 400 });
    }

    const analysis = await analyzeComment(comment, instructions);
    return NextResponse.json({ ok: true, analysis });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "Unknown error" }, { status: 500 });
  }
}

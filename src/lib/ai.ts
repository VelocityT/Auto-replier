import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { AiAnalysis } from "./types";

const apiKey = process.env.GEMINI_API_KEY;
// NOTE: gemini-2.0-flash was deprecated and shut down June 1, 2026 — default
// to 2.5-flash. Always set GEMINI_MODEL explicitly in your env vars anyway.
const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

if (!apiKey) {
  console.warn(
    "[ai] GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/app/apikey"
  );
}

const genAI = new GoogleGenerativeAI(apiKey ?? "placeholder");

// Structured output schema — forces Gemini to return exactly this shape,
// so we never have to fight with parsing free-form text.
const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    language: {
      type: SchemaType.STRING,
      enum: ["hindi", "english", "hinglish", "other"],
    },
    sentiment: {
      type: SchemaType.STRING,
      enum: ["positive", "neutral", "negative", "urgent", "spam"],
    },
    intent: {
      type: SchemaType.STRING,
      enum: ["praise", "question", "complaint", "appointment", "pricing", "spam", "other"],
    },
    shouldAutoReply: { type: SchemaType.BOOLEAN },
    reply: { type: SchemaType.STRING },
    reasoning: { type: SchemaType.STRING },
  },
  required: ["language", "sentiment", "intent", "shouldAutoReply", "reply", "reasoning"],
} as const;

const SYSTEM_PROMPT_TEMPLATE = `You are an assistant that triages and replies to public social media
comments and reviews on behalf of a business.

CLIENT-SPECIFIC INSTRUCTIONS (follow these for tone, services, language, etc.):
"""
{{CLIENT_INSTRUCTIONS}}
"""

For the comment given by the user, do the following:

1. Detect the language/script used: "hindi" (Devanagari), "english", "hinglish"
   (Hindi written in Latin script, or a mix of Hindi+English), or "other".
2. Classify sentiment:
   - "positive": praise, thanks, happy customer
   - "neutral": general question, neutral statement
   - "negative": complaint, dissatisfaction, criticism
   - "urgent": safety issue, medical emergency mention, threat to escalate
     publicly/legally, very angry tone
   - "spam": promotional spam, irrelevant links, bot-like content
3. Classify intent: praise, question, complaint, appointment, pricing, spam, other.
4. Decide shouldAutoReply:
   - true ONLY for sentiment "positive" or "neutral" AND intent is not spam.
   - false for "negative", "urgent", or "spam" — these always go to a human
     for review, no exceptions.
5. Write "reply":
   - If shouldAutoReply is true: write a short reply (under 40 words) in the
     SAME language/script as the original comment, following the client
     instructions above.
   - If shouldAutoReply is false: still write a SUGGESTED reply a human could
     review and post (or edit), in the same language/script as the comment.
     For "spam", suggested reply can be an empty string.
6. "reasoning": one short sentence (in English) explaining your sentiment/intent
   call — for internal logs only, never shown to the public.

Respond with JSON only, matching the provided schema.`;

export async function analyzeComment(
  commentText: string,
  clientInstructions: string
): Promise<AiAnalysis> {
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema as any,
      temperature: 0.4,
    },
  });

  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace(
    "{{CLIENT_INSTRUCTIONS}}",
    clientInstructions || "No specific instructions provided. Be polite, professional, and concise."
  );

  const result = await model.generateContent([
    { text: systemPrompt },
    { text: `Comment to analyze:\n"""${commentText}"""` },
  ]);

  const raw = result.response.text();

  let parsed: AiAnalysis;
  try {
    parsed = JSON.parse(raw) as AiAnalysis;
  } catch (err) {
    // Fail safe: if the model ever returns malformed JSON, never auto-reply.
    return {
      language: "other",
      sentiment: "negative",
      intent: "other",
      shouldAutoReply: false,
      reply: "",
      reasoning: `AI returned unparsable response, flagged for manual review. Raw: ${raw.slice(0, 200)}`,
    };
  }

  // Defensive guardrail: never trust the model blindly for risky categories,
  // even if it sets shouldAutoReply incorrectly.
  if (parsed.sentiment === "negative" || parsed.sentiment === "urgent" || parsed.sentiment === "spam") {
    parsed.shouldAutoReply = false;
  }

  return parsed;
}

// ─────────────────────────────────────────────
// Batch analysis — analyzes many comments/reviews for ONE client in a
// single Gemini call. Used by the cron routes (YouTube, GBP) where a single
// poll can surface several new items per client.
//
// Why this matters at scale (e.g. 25+ clients on the free tier):
// - gemini-2.5-flash free tier is ~10-15 requests/min and ~1,500 requests/day.
// - One call per comment would burn through both limits fast once you have
//   many active clients, and a backlog on one client could blow Vercel's
//   60s cron timeout.
// - One call per client per cron run (covering up to ~20 items) keeps API
//   usage roughly proportional to "number of clients with new activity",
//   not "number of comments".
// ─────────────────────────────────────────────

export interface CommentToAnalyze {
  id: string; // external_id (comment/review ID) — used to map results back
  text: string;
}

const batchResponseSchema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      id: { type: SchemaType.STRING },
      language: {
        type: SchemaType.STRING,
        enum: ["hindi", "english", "hinglish", "other"],
      },
      sentiment: {
        type: SchemaType.STRING,
        enum: ["positive", "neutral", "negative", "urgent", "spam"],
      },
      intent: {
        type: SchemaType.STRING,
        enum: ["praise", "question", "complaint", "appointment", "pricing", "spam", "other"],
      },
      shouldAutoReply: { type: SchemaType.BOOLEAN },
      reply: { type: SchemaType.STRING },
      reasoning: { type: SchemaType.STRING },
    },
    required: ["id", "language", "sentiment", "intent", "shouldAutoReply", "reply", "reasoning"],
  },
} as const;

const BATCH_SYSTEM_PROMPT_TEMPLATE = `You are an assistant that triages and replies to public social media
comments and reviews on behalf of a business.

CLIENT-SPECIFIC INSTRUCTIONS (follow these for tone, services, language, etc.):
"""
{{CLIENT_INSTRUCTIONS}}
"""

You will receive a JSON array of items, each with an "id" and "text". For
EACH item, independently do the following:

1. Detect the language/script used: "hindi" (Devanagari), "english", "hinglish"
   (Hindi written in Latin script, or a mix of Hindi+English), or "other".
2. Classify sentiment:
   - "positive": praise, thanks, happy customer
   - "neutral": general question, neutral statement
   - "negative": complaint, dissatisfaction, criticism
   - "urgent": safety issue, medical emergency mention, threat to escalate
     publicly/legally, very angry tone
   - "spam": promotional spam, irrelevant links, bot-like content
3. Classify intent: praise, question, complaint, appointment, pricing, spam, other.
4. Decide shouldAutoReply:
   - true ONLY for sentiment "positive" or "neutral" AND intent is not spam.
   - false for "negative", "urgent", or "spam" — these always go to a human
     for review, no exceptions.
5. Write "reply":
   - If shouldAutoReply is true: write a short reply (under 40 words) in the
     SAME language/script as the original item, following the client
     instructions above.
   - If shouldAutoReply is false: still write a SUGGESTED reply a human could
     review and post (or edit), in the same language/script as the item.
     For "spam", suggested reply can be an empty string.
6. "reasoning": one short sentence (in English) explaining your sentiment/intent
   call — for internal logs only, never shown to the public.

Respond with a JSON array only, matching the provided schema — exactly one
object per input item, each preserving its original "id", in the same order
as the input.`;

/**
 * Analyze multiple comments/reviews for a single client in one Gemini call.
 * Returns a Map from each input item's `id` to its AiAnalysis. If the model
 * fails to return a valid/complete array, every item is flagged for manual
 * review (fail-safe — never silently dropped or auto-posted).
 */
export async function analyzeCommentsBatch(
  comments: CommentToAnalyze[],
  clientInstructions: string
): Promise<Map<string, AiAnalysis>> {
  const results = new Map<string, AiAnalysis>();
  if (comments.length === 0) return results;

  const fallback = (reason: string): AiAnalysis => ({
    language: "other",
    sentiment: "negative",
    intent: "other",
    shouldAutoReply: false,
    reply: "",
    reasoning: reason,
  });

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: batchResponseSchema as any,
      temperature: 0.4,
    },
  });

  const systemPrompt = BATCH_SYSTEM_PROMPT_TEMPLATE.replace(
    "{{CLIENT_INSTRUCTIONS}}",
    clientInstructions || "No specific instructions provided. Be polite, professional, and concise."
  );

  let raw = "";
  try {
    const result = await model.generateContent([
      { text: systemPrompt },
      { text: `Items to analyze (JSON array):\n${JSON.stringify(comments)}` },
    ]);
    raw = result.response.text();

    const parsed = JSON.parse(raw) as Array<{ id: string } & AiAnalysis>;

    for (const item of parsed) {
      const { id, ...analysis } = item;
      if (
        analysis.sentiment === "negative" ||
        analysis.sentiment === "urgent" ||
        analysis.sentiment === "spam"
      ) {
        analysis.shouldAutoReply = false;
      }
      results.set(id, analysis as AiAnalysis);
    }
  } catch (err) {
    // Fail safe: if the call fails or returns malformed JSON, flag everything
    // for manual review rather than retrying per-item (which would defeat the
    // purpose of batching) or silently dropping items.
    for (const c of comments) {
      results.set(
        c.id,
        fallback(
          `AI batch call failed/unparsable, flagged for manual review. ${
            raw ? `Raw: ${raw.slice(0, 150)}` : String(err).slice(0, 150)
          }`
        )
      );
    }
    return results;
  }

  // Fail-safe: if the model dropped any ids from its response, flag those too.
  for (const c of comments) {
    if (!results.has(c.id)) {
      results.set(c.id, fallback("AI did not return analysis for this item, flagged for manual review."));
    }
  }

  return results;
}

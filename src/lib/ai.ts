import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { AiAnalysis } from "./types";

const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";

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

// Shared types used across the app.

export type Platform = "instagram" | "facebook" | "youtube" | "gbp";

export type Sentiment = "positive" | "neutral" | "negative" | "urgent" | "spam";

export type Intent =
  | "praise"
  | "question"
  | "complaint"
  | "appointment"
  | "pricing"
  | "spam"
  | "other";

// A lightweight pointer to the post/video/media a comment belongs to.
// null for platforms where comments aren't tied to a specific post
// (e.g. Google Business Profile reviews are location-level).
export interface PostRef {
  id: string;
  label: string; // human-readable label shown on the dashboard
  url: string | null; // deep link to the post/video, if we can construct one
}

export interface AiAnalysis {
  language: "hindi" | "english" | "hinglish" | "other";
  sentiment: Sentiment;
  intent: Intent;
  shouldAutoReply: boolean;
  reply: string; // empty string if shouldAutoReply is false
  reasoning: string; // short internal note, not shown to end users
}

// Row shape of the `clients` table in Supabase.
export interface ClientConfig {
  id: string;
  name: string;
  active: boolean;

  // Free-text instructions injected into the AI prompt for this client.
  // e.g. tone, services, languages, escalation rules.
  ai_instructions: string;

  // --- Instagram / Facebook (Meta Graph API) ---
  meta_page_id: string | null;
  meta_ig_account_id: string | null;
  meta_page_access_token: string | null; // long-lived page token

  // --- YouTube ---
  youtube_channel_id: string | null;
  youtube_refresh_token: string | null;

  // --- Google Business Profile ---
  gbp_account_id: string | null;
  gbp_location_id: string | null;
  gbp_refresh_token: string | null;

  created_at: string;
}

// Row shape of the `processed_items` table — used to avoid double-replying.
export interface ProcessedItem {
  id: string;
  client_id: string;
  platform: Platform;
  external_id: string; // comment ID / review ID from the platform
  status: "auto_replied" | "flagged" | "ignored";
  post_ref: PostRef | null;
  original_text: string | null; // the comment/review text, for dashboard display
  reply_text: string | null; // the reply that was actually posted (auto_replied rows only)
  created_at: string;
}

// Row shape of the `flagged_items` table — needs human review before posting.
export interface FlaggedItem {
  id: string;
  client_id: string;
  platform: Platform;
  external_id: string;
  author_name: string | null;
  original_text: string;
  ai_analysis: AiAnalysis;
  status: "pending" | "approved" | "rejected" | "posted";
  post_ref: PostRef | null;
  created_at: string;
  updated_at: string;
}

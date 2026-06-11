import { createClient } from "@supabase/supabase-js";

// This client uses the SERVICE ROLE key — it must only ever be used in
// server-side code (API routes / cron jobs), never sent to the browser.
// Next.js API routes are server-only, so this is safe here.

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  // Don't throw at import time during build — only when actually used,
  // so `next build` doesn't fail before env vars are configured on Vercel.
  console.warn(
    "[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. " +
      "Set these in your environment before calling any DB functions."
  );
}

export const supabase = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseServiceKey ?? "placeholder-key",
  {
    auth: { persistSession: false },
  }
);

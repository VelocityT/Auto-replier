-- Run this once in your Supabase project's SQL editor
-- (Project -> SQL Editor -> New query -> paste -> Run)

-- ─────────────────────────────────────────────
-- clients: one row per client/business you manage
-- ─────────────────────────────────────────────
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,

  -- Free-text instructions injected into the AI prompt for this client.
  -- Example: "You reply for Dr. Ashar Ali Clinic. Be warm and professional.
  -- Mention appointment booking when relevant. Reply in the same language
  -- (Hindi/English/Hinglish) the commenter used. Keep replies under 40 words."
  ai_instructions text not null default '',

  -- Instagram / Facebook (Meta Graph API)
  meta_page_id text,
  meta_ig_account_id text,
  meta_page_access_token text,

  -- YouTube
  youtube_channel_id text,
  youtube_refresh_token text,

  -- Google Business Profile
  gbp_account_id text,
  gbp_location_id text,
  gbp_refresh_token text,

  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- processed_items: every comment/review we've already handled,
-- so we never reply twice to the same item.
-- ─────────────────────────────────────────────
create table if not exists processed_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook', 'youtube', 'gbp')),
  external_id text not null,
  status text not null check (status in ('auto_replied', 'flagged', 'ignored')),
  created_at timestamptz not null default now(),

  unique (client_id, platform, external_id)
);

create index if not exists idx_processed_items_client on processed_items(client_id, platform);

-- ─────────────────────────────────────────────
-- flagged_items: negative/urgent/ambiguous items that need a human
-- to approve (or edit) the AI-drafted reply before it gets posted.
-- ─────────────────────────────────────────────
create table if not exists flagged_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook', 'youtube', 'gbp')),
  external_id text not null,
  author_name text,
  original_text text not null,
  ai_analysis jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'posted')),
  created_at timestamptz not null default now()
);

create index if not exists idx_flagged_items_status on flagged_items(client_id, status);

-- ─────────────────────────────────────────────
-- Example: insert your first client
-- (Replace the tokens once you've completed the README setup steps)
-- ─────────────────────────────────────────────
-- insert into clients (name, ai_instructions)
-- values (
--   'Dr Ashar Ali Clinic',
--   'You reply on behalf of Dr Ashar Ali Clinic, a multi-specialty clinic in Lucknow.
--    Tone: warm, professional, reassuring. Reply in the same language/script the
--    commenter used (Hindi, English, or Hinglish). Keep replies under 40 words.
--    Mention that appointments can be booked by calling the clinic or via the
--    booking link in bio when relevant. Never give medical advice in a reply.'
-- );

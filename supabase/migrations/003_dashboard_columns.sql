-- Migration: add the columns the app already writes but schema.sql never declared.
--
-- Context
-- -------
-- The cron routes (/api/cron/youtube, /api/cron/gbp) and the Meta webhook all
-- insert `post_ref`, `original_text` and `reply_text` into processed_items, and
-- `post_ref` into flagged_items. /api/flagged/[id] writes `updated_at` on
-- flagged_items when an item is approved or rejected. None of those columns
-- exist in supabase/schema.sql.
--
-- If the live database was patched by hand at some point these are no-ops
-- (every statement is `if not exists`). If it wasn't, those inserts have been
-- failing with PGRST204 "column not found" and the dashboard has been empty.
--
-- Safe to run more than once.

-- ─────────────────────────────────────────────
-- processed_items
-- ─────────────────────────────────────────────

-- Pointer to the post/video/media the comment belongs to. jsonb because it
-- carries { id, label, url }. NULL for GBP, whose reviews are location-level
-- and not attached to any post.
alter table processed_items
  add column if not exists post_ref jsonb;

-- The original comment/review text, denormalised so the dashboard can show
-- what was said without calling back out to each platform's API.
alter table processed_items
  add column if not exists original_text text;

-- The reply we actually posted. Only set on status = 'auto_replied' rows;
-- NULL for 'flagged' and 'ignored'.
alter table processed_items
  add column if not exists reply_text text;

-- ─────────────────────────────────────────────
-- flagged_items
-- ─────────────────────────────────────────────

alter table flagged_items
  add column if not exists post_ref jsonb;

-- Set whenever a human approves/rejects an item. Defaults to now() so existing
-- rows get a sensible value instead of NULL.
alter table flagged_items
  add column if not exists updated_at timestamptz not null default now();

-- ─────────────────────────────────────────────
-- Dashboard query support
--
-- src/app/dashboard/page.tsx scans processed_items by created_at for the
-- current IST day, and groups all-time rows by platform + status.
-- ─────────────────────────────────────────────

create index if not exists idx_processed_items_created_at
  on processed_items (created_at desc);

create index if not exists idx_processed_items_platform_status
  on processed_items (platform, status);

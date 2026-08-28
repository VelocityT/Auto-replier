-- Migration: queue table for the Instagram/Facebook webhook path, so it can
-- be batched like the YouTube/GBP cron paths already are.
--
-- Context
-- -------
-- The webhook path called analyzeComment() once per incoming comment. That's
-- fine at low volume, but Gemini's free tier is only 20 requests/day/model
-- (tightened further by Google in Dec 2025) -- a client with real engagement
-- (~100 comments/day) blows through that before lunch, and every comment
-- after that silently fails over to "flagged for manual review" (safe, but
-- not what anyone wants at that volume).
--
-- Fix: the webhook handler now just verifies + dedupes + enqueues into this
-- table (no AI call, returns fast, same as before). A new cron route
-- (/api/cron/flush-comments, pinged externally every few minutes -- see
-- CLAUDE.md) drains it per client in ONE analyzeCommentsBatch() call,
-- exactly like the existing YouTube/GBP cron routes. Comments that arrive
-- close together in time collapse into a single Gemini request instead of
-- one each, so daily request count tracks "how often the flush cron finds
-- something pending" rather than "how many comments came in" -- the same
-- trick that already keeps YouTube/GBP usage low.
--
-- Safe to run more than once.

create table if not exists pending_comments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook')),
  external_id text not null,
  author_name text,
  text text not null,
  post_ref jsonb,
  created_at timestamptz not null default now(),

  unique (client_id, platform, external_id)
);

create index if not exists idx_pending_comments_client
  on pending_comments (client_id, platform, created_at);

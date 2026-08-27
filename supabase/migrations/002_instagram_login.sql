-- Migration: switch Instagram connections to "Instagram API with Instagram Login"
--
-- Context
-- -------
-- The app originally used "Instagram API with Facebook Login": clients signed
-- in with Facebook, we listed their Pages, and read the Instagram Business
-- account linked to the chosen Page. That flow needs the pages_* /
-- instagram_basic permission set.
--
-- The Meta App Review submission is for the instagram_business_* permission
-- set, which is only issued through Instagram Login. Clients now authorize
-- their Instagram account directly — no Facebook Page required, which removes
-- a common onboarding failure for smaller clients who never set one up.
--
-- What changes
-- ------------
--   meta_ig_username      the @handle, so the admin UI can show which account
--                         is connected without an extra API call
--   meta_token_expires_at long-lived Instagram tokens last ~60 days and must
--                         be refreshed before expiry; store the deadline so
--                         the cron can refresh proactively
--
-- meta_page_id is intentionally left in place (nullable) — existing rows keep
-- their historical value, and new Instagram Login connections write NULL.

alter table clients
  add column if not exists meta_ig_username text;

alter table clients
  add column if not exists meta_token_expires_at timestamptz;

-- Find connections that need refreshing before they lapse.
create index if not exists clients_meta_token_expires_at_idx
  on clients (meta_token_expires_at)
  where meta_token_expires_at is not null;

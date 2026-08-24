# Auto Replier — working notes

AI auto-reply engine for client comments/reviews across Instagram, YouTube,
Google Business Profile (and legacy Facebook). Built by Velocity Tech to run
on Vercel Hobby + Supabase free tier at ~₹0/month.

## Stack

- Next.js 14 App Router, TypeScript strict, React 18 — **no Tailwind, no UI lib**.
  All styling is hand-written in `src/app/globals.css` (~950 lines, class-based).
- Supabase (Postgres) via `@supabase/supabase-js` with the **service role key** —
  server-side only, never expose to the browser.
- Gemini (`@google/generative-ai`), model from `GEMINI_MODEL`, default
  `gemini-2.5-flash`. 2.0-flash is dead (shut down June 1 2026).
- Deployed on Vercel. Cron via external pinger (cron-job.org), not Vercel Cron
  (Hobby only allows daily).

## Architecture

```
Instagram/Facebook  → webhook  → /api/webhooks/meta   → analyzeComment()      (1 call/comment)
YouTube             → polling  → /api/cron/youtube    → analyzeCommentsBatch() (1 call/client)
Google Business     → polling  → /api/cron/gbp        → analyzeCommentsBatch() (1 call/client)
                                        ↓
                     shouldAutoReply ? post reply + processed_items(auto_replied)
                                     : flagged_items(pending) + processed_items(flagged)
                                        ↓
                     /  (Review Queue) → POST /api/flagged/[id] {approve|reject}
```

**Batching matters.** Cron routes do two passes: pass 1 filters out
already-processed items with no AI calls, pass 2 sends all new items for one
client in a single Gemini call. This keeps free-tier usage proportional to
*clients with activity*, not *comment count*. Don't refactor back to
per-comment calls. The webhook path is per-comment because events arrive one
at a time.

### Safety guardrails — do not loosen without asking

1. `negative` / `urgent` / `spam` sentiment → never auto-posted, enforced twice
   (prompt + defensive override in `ai.ts` after parsing).
2. GBP reviews ≤ 3 stars → never auto-replied even if classified positive
   (`api/cron/gbp/route.ts`).
3. Malformed AI output → item is flagged, never dropped and never auto-posted.

### Auth

Single shared `ADMIN_PASSWORD`. `src/middleware.ts` gates everything except
`/login`, `/api/auth/*`, `/api/cron/*` (own `?secret=`), `/api/webhooks/*`
(own signature check). Session cookie = SHA-256 of the password — no expiry,
no per-user identity. `/api/oauth/*` is deliberately gated.

### Key files

| File | Role |
|---|---|
| `src/lib/ai.ts` | Gemini prompts + structured output schemas (single & batch) |
| `src/lib/types.ts` | `ClientConfig`, `ProcessedItem`, `FlaggedItem`, `AiAnalysis` — mirrors DB rows |
| `src/lib/clients.ts` | `toSafeClient()` — strips all tokens before anything reaches the browser |
| `src/lib/meta.ts` | Instagram Login OAuth + Graph calls + webhook signature verify |
| `src/lib/google-auth.ts` | Shared Google refresh-token → access-token exchange (YouTube + GBP) |
| `src/lib/gbp.ts` / `youtube.ts` | Platform read/reply |
| `supabase/schema.sql` | Base schema — run once in the Supabase SQL editor |

## Conventions

- Path alias `@/*` → `src/*`.
- API routes return `{ ok: boolean, ... }` JSON; OAuth routes redirect back to
  `/admin/clients/[id]?error=<code>` or `?connected=<platform>` instead.
  Error codes are rendered as human-readable copy in `ClientEditForm.tsx` —
  add new copy there when adding a code.
- `export const dynamic = "force-dynamic"` on every route/page touching Supabase.
- Cron routes: `export const maxDuration = 60`.
- Never `.order()` on a query that also selects a jsonb column + an embedded
  relation — PostgREST silently returns 0 rows on this project. Sort in JS
  (see `src/app/page.tsx`).
- "Today" is computed in IST (UTC+5:30) — clients are India-based
  (`getIstDayRange()` in `src/app/dashboard/page.tsx`).
- Never log or return `*_refresh_token` / `*_access_token` fields.

## Instagram: current vs legacy flow

The app migrated from **Instagram API with Facebook Login** (pages_* +
instagram_basic scopes, Page picker) to **Instagram API with Instagram Login**
(`instagram_business_*` scopes, one account per authorization, no Facebook
Page needed). Migration `002_instagram_login.sql` covers the DB side.

**Live path:** `/api/oauth/meta/start` → instagram.com/oauth/authorize →
`/api/oauth/meta/callback` → long-lived token → save.

**Dead code from the old flow, still present:**
`/api/oauth/meta/select`, `/admin/clients/[id]/meta-pages`, and
`listPages()` / `getInstagramAccountForPage()` / `META_PAGES_COOKIE` in
`meta.ts`. Nothing sets the cookie any more, so the picker is unreachable.
Safe to delete once the Facebook-Page path is confirmed retired.

Instagram replies go to `graph.instagram.com`, Facebook Page replies go to
`graph.facebook.com` — `replyToComment()` routes on the `platform` arg.

## Meta app identifiers (as of Aug 2026)

| Thing | Value |
|---|---|
| Facebook app | `VelocityTech Auto Replier` — App ID `27200354646311891` |
| Instagram app | `VelocityTech Auto Replier-IG` — App ID `2205878283534093` |
| Production URL | `https://auto-replier.vercel.app` |
| Vercel project | `auto-replier` (`prj_hjwHwr9pxA9YtYhfgJc6GOH23boU`) |

**Meta App Review for `instagram_business_*` is APPROVED.** Remaining
dashboard work before real client accounts can connect:

1. App is still **Unpublished / In development** → Dashboard → Publish.
2. **Business verification** is not green — usually gates publishing.
3. **Instagram business login is not set up** (API setup with Instagram login,
   step 4). Redirect URI must be
   `https://auto-replier.vercel.app/api/oauth/meta/callback`.
4. **Webhook callback URL is blank** (step 3). Set to
   `https://auto-replier.vercel.app/api/webhooks/meta` with the
   `META_VERIFY_TOKEN` value, subscribe to `comments`. Meta requires the app to
   be published before webhooks deliver.
5. `INSTAGRAM_APP_SECRET` must be added to Vercel env (never committed).

## Known issues / open work

Ordered by how badly they bite.

1. **GBP reviews host is likely wrong.** `gbp.ts` calls
   `https://mybusinessreviews.googleapis.com/v1` — Google never migrated
   reviews off the legacy My Business API. Reviews read/reply should be
   `https://mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/reviews`
   (`PUT .../{reviewId}/reply`). The README itself says review read/reply uses
   the legacy API, which contradicts the code. Verify before the GBP API
   access request (case 7-5896000040841) is exercised.
2. `node_modules` in this checkout is partial — `typescript`'s own `.d.ts`
   files are truncated, so `npm run type-check` reports syntax errors *inside
   node_modules*. Application code under `src/` type-checks clean. Run a full
   `npm install` before trusting any build output.
3. `/api/dev/test-ai` and `/test` are dev-only surfaces shipped to production
   (auth-gated, but still).
4. `.env.local` has `META_APP_ID`, `META_APP_SECRET`,
   `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET` empty. YouTube
   still works because `google-auth.ts` falls back to the GBP OAuth client.
5. Dead Facebook-Page-flow code still present (see the Instagram section
   above) — safe to delete once that path is confirmed retired.

## Recently fixed (Aug 2026)

- `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` added to `.env.example` and
  `.env.local`. App ID is filled in; the secret must be pasted by hand.
- Migration `003_dashboard_columns.sql` adds `processed_items.post_ref`,
  `.original_text`, `.reply_text` and `flagged_items.post_ref`, `.updated_at`
  plus dashboard indexes. `schema.sql` updated to match for fresh installs.
- `/api/cron/refresh-tokens` added — refreshes Instagram long-lived tokens
  expiring within 7 days. Point cron-job.org at it daily.
- Webhook signature now accepts either the Instagram or Facebook app secret
  (`verifyWebhookSignatureAny`).
- Disconnect now clears `meta_ig_username` and `meta_token_expires_at`.

## Pending external approvals

- **Meta App Review** — ✅ APPROVED. See the "Meta app identifiers" section for
  the remaining dashboard steps (publish, verification, login + webhook setup).
- **GBP API access** — case 7-5896000040841. Account/location listing may be
  granted before review read/reply. The cron skips clients without
  `gbp_account_id` + `gbp_location_id`.
- LinkedIn is intentionally out of scope (requires Marketing Developer Platform
  partnership).

## Local dev

```bash
npm install
cp .env.example .env.local   # fill keys
npm run dev                  # http://localhost:3000
npm run type-check
```

Webhooks need a public URL — use ngrok for local Meta testing.

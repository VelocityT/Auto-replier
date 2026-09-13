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
Instagram/Facebook  → webhook  → /api/webhooks/meta        → enqueue only, no AI call
                                        ↓
                                 pending_comments (queue table)
                                        ↓
                     /api/cron/flush-comments (external pinger, every 3-5 min)
                                        ↓                        analyzeCommentsBatch() (1 call/client)
YouTube             → polling  → /api/cron/youtube         → analyzeCommentsBatch() (1 call/client)
Google Business     → polling  → /api/cron/gbp             → analyzeCommentsBatch() (1 call/client)
                                        ↓
                     shouldAutoReply ? post reply + processed_items(auto_replied)
                                     : flagged_items(pending) + processed_items(flagged)
                                        ↓
                     /  (Review Queue) → POST /api/flagged/[id] {approve|reject}
```

**Batching matters.** All four paths (webhook included, as of Aug 2026) end up
batching: pass 1 filters out already-processed items with no AI calls, pass 2
sends all new items for one client in a single Gemini call. This keeps
free-tier usage proportional to *clients with activity in that window*, not
*comment count* — don't refactor back to a call per comment.

The webhook path used to call `analyzeComment()` once per incoming comment,
since webhook events arrive one at a time. That fell over in production: the
Gemini free tier is 20 requests/day/model, so a client with real engagement
(~100 comments/day) burned through it well before the day was over, and
every comment after that got silently flagged instead of replied. Fixed by
having the webhook only enqueue into `pending_comments`
(`src/app/api/webhooks/meta/route.ts`) and adding `/api/cron/flush-comments`
to drain it per client in one batched call, same as YouTube/GBP. Point a
cron-job.org job at it every 3-5 minutes — a run that finds nothing pending
makes zero Gemini calls, so idle clients cost nothing.

**If ~100 comments/day is still tight even with batching**, the free-tier
model itself is the bigger lever: `GEMINI_MODEL` defaults to
`gemini-2.5-flash` (20 requests/day/model on the free tier, confirmed by a
live 429 in production, Aug 2026). `gemini-2.5-flash-lite` reportedly has a
much higher free-tier daily cap (order of 1,000/day) for the same
sentiment/reply task, which is simple enough that the lighter model handles
it fine — the safety guardrails below don't depend on model quality, they're
enforced in code regardless of what the model returns. Switching is a Vercel
env var change, no code required; verify the current number on the Gemini
API pricing/rate-limit page before relying on it, since Google has changed
free-tier quotas more than once (a 50-80% cut in Dec 2025 is why the 20/day
number above is lower than older docs suggest).

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

**Dashboard checklist status as of Aug 28 2026 (verified directly in the Meta
Instagram API use case, not just from memory):** app Publish status =
**Published**, step 2 (generate access tokens), step 3 (configure webhooks —
callback URL + verify token + `comments`/`live_comments` subscribed) and step
4 (Instagram business login redirect URI) all show **green/complete**. Steps
1-4 of the old checklist below are DONE — do not re-do them. `INSTAGRAM_APP_SECRET`
is set in Vercel env.

**The actual, currently-confirmed blocker is step 5: "Complete app review" for
the Instagram API use case shows incomplete (blue, not green) — this is a
*different, narrower* review than the general "Meta App Review" badge
referenced elsewhere in this doc, and it gates Advanced Access specifically
for `instagram_business_basic` / `instagram_business_manage_comments` /
`instagram_business_manage_messages`.** Without Advanced Access, Instagram
only delivers webhook events (comments, etc.) for accounts that hold a role
on the app (Administrator / Developer / Tester) — confirmed via
Dashboard → App roles → Roles, which lists exactly two entries: `Ufaq Haider`
(Administrator) and `velocitytech.in` (**Instagram Tester**). That's why every
webhook-driven diagnosis so far (self-reply loop, ID mismatch) worked: the
connected account itself is a Tester, so its own actions (posting, replying)
generate real webhook events. A random public commenter (brajrajhospital,
brainyacademylko, connate1, ufaq.pvt, or any real hospital/school patient —
none of whom have a role on this app) generates **zero** webhook event, ever,
confirmed via Vercel `get_runtime_logs`: in a 24h window, `requestPath`
group-by shows **only** `/api/cron/flush-comments` hits (the scheduled cron)
— not one single request, successful or failed, ever reached
`/api/webhooks/meta`. This is not a code bug and none of this session's code
fixes (self-loop guard, ID-mismatch patch, batching, AI fail-safe) can work
around it, because the event never arrives at the server to begin with.

**Update, checked directly on the App Review submissions page (not just the
use-case checklist icon):** it was already submitted once — Aug 11, 2026 —
and **rejected**. All four permissions (`instagram_business_basic`,
`instagram_business_manage_messages`, `instagram_business_manage_insights`,
`instagram_business_manage_comments`) show a red "Not approved" badge. The
current submission tray is empty ("Not submitted — nothing has been added to
this submission yet") — nothing has been resubmitted since the Aug 11
rejection. So this isn't "pending Meta" — it's stalled on our side waiting
for a resubmission with fixes. Haven't yet pulled the specific rejection
feedback text (the "View request details" panel didn't render via automated
browsing) — do that manually in the dashboard (App Review → Previous
submissions → View request details) before resubmitting, since Meta usually
gives a specific reason (e.g. screencast/demo video not showing the exact
permission's use, privacy policy not addressing Instagram data use, use case
description too vague) and resubmitting blind risks a second rejection.

**Update — actual rejection feedback read (submitted Jul 31 2026, not Aug 11 as
first assumed; timestamps in the dashboard list multiple submission attempts):**

- `instagram_business_basic` — **Disallowed Use Case** (Developer Policy 1.6):
  Meta says the use case for this permission is invalid / not needed for core
  functionality.
- `instagram_business_manage_messages` — **Screencast Not Aligned**. Reviewer
  note: *"the screencast does not show a message being sent from your app UI
  and the same message appearing in the native client... re-record showing
  (1) asset selection, (2) a live send action from your app, (3) the
  delivered message in the native client."*
- `instagram_business_manage_insights` — **Screencast Not Aligned** (generic
  template reason, no specific reviewer note).
- `instagram_business_manage_comments` — **Screencast Not Aligned** (generic
  template reason, no specific reviewer note).

**Root cause of all four rejections, confirmed by reading the actual code:**
this app has never had a DM-sending feature or an insights/analytics feature.
Grepped the whole `src/` tree for `manage_messages`/`manage_insights` usage —
zero hits. The only things the app does are (1) look up the connected
account's own id/username via `instagram_business_basic` (`getInstagramAccount`
in `meta.ts`, used to detect and skip self-authored comments) and (2) read +
reply to comments via `instagram_business_manage_comments`
(`replyToComment`, the webhook `comments` field). `manage_messages` and
`manage_insights` were being requested anyway because
`META_OAUTH_SCOPES` in `meta.ts` listed all four — there was never a real
screen to record for the messaging/insights screencasts because the feature
doesn't exist, which is exactly why those two got rejected, and requesting
them likely diluted the `basic` justification enough to get it rejected too
("not needed to support its core functionality" — true, for those two).

**Fixed in code (this session):** `META_OAUTH_SCOPES` in `src/lib/meta.ts` now
only requests `instagram_business_basic` + `instagram_business_manage_comments`
— the two scopes the app actually uses. `instagram_business_manage_messages`
and `instagram_business_manage_insights` were removed. This needs a matching
change on the Meta side before resubmitting: Dashboard → Use cases →
Instagram API → Permissions and features → remove/don't include
`manage_messages` and `manage_insights` from the next App Review submission
(only submit `basic` + `manage_comments`).

**Resubmission checklist:**
1. On the Meta dashboard, submit only `instagram_business_basic` and
   `instagram_business_manage_comments`.
2. For `instagram_business_basic`'s use-case notes, explicitly tie it to
   `manage_comments` — it's a hard dependency (needed to fetch the connected
   account's own id/username so the app can tell its own auto-replies apart
   from real customer comments and avoid a reply-to-self loop), not a
   standalone feature. Don't describe messaging or insights anywhere in the
   notes.
3. Record ONE new screencast covering the real, only end-to-end flow: (a) the
   full Instagram Login OAuth consent screen showing exactly these two
   permissions being granted, (b) a real comment posted on the connected
   account's Instagram post, (c) the app's webhook → AI classification →
   auto-reply happening (dashboard or logs showing it, plus (d) switching to
   the native Instagram app/web to show the reply actually posted under the
   comment. English UI, narrate/caption what each screen is doing per Meta's
   screencast guide. This app uses standard per-user OAuth (Instagram Login),
   not a system user token — say so explicitly if the reviewer might mistake
   the cron-driven YouTube/GBP polling elsewhere in the app for a server-to-
   server flow.
4. Until this resubmission is approved, comments from accounts that aren't
   Admin/Developer/Tester on this app will never trigger a webhook, no matter
   what the code does — confirmed via Vercel logs (zero requests ever reached
   `/api/webhooks/meta` in a 24h window). As a controlled-testing-only
   stopgap (does NOT scale to real customers), additional specific test
   accounts can be added under App roles → Testers so their comments generate
   webhooks pre-approval.

## Recently fixed (Aug 2026, cont'd)

- **Self-reply infinite loop (confirmed live, caused real duplicate public
  replies).** Posting an auto-reply is *itself* a new Instagram comment, and
  the connected account is subscribed to its own `comments` field — so every
  reply the app posted generated a fresh webhook event indistinguishable from
  a real incoming comment. The app analyzed its own reply, decided it was a
  nice positive message, and replied to itself again, repeatedly. Live
  evidence on shree medicare / @velocitytech.in: ~10 near-duplicate "Thank you
  for your kind words..." replies stacked under one real customer comment.
  It only stopped because the Gemini free-tier daily quota (20
  requests/model/day) ran out. Fixed in `src/app/api/webhooks/meta/route.ts`:
  `handleCommentEvent` now skips any event whose `authorId`/`authorName`
  matches the client's own `meta_ig_account_id`/`meta_ig_username` before
  doing anything else. `parseWebhookEvents` in `meta.ts` now also captures
  `from.id` (previously only `from.username`/`from.name`) so the ID check is
  possible.
- **AI failures other than bad JSON were silently dropping comments.**
  `analyzeComment()` only caught `JSON.parse` errors; a thrown error from
  `generateContent()` itself (429 quota exceeded, network blip, Gemini 5xx)
  propagated out of the function entirely, past the webhook route's
  try/catch, and the comment was never flagged, never replied, never
  logged anywhere useful — a silent drop. Confirmed live: real negative
  reviews ("Very bad service") vanished this way during the quota exhaustion
  above, instead of reaching the Review Queue like CLAUDE.md's own
  guardrail #3 promises. Fixed by wrapping the whole Gemini call (not just
  the parse step) in one try/catch in `src/lib/ai.ts` — any failure now takes
  the same fail-safe path as malformed output.
- **Operational note:** the Gemini free tier is 20 requests/day/model. That's
  fine for the batched cron routes (YouTube/GBP — one call per client per
  run) but tight for the per-comment Instagram webhook path once a client has
  real engagement. Worth moving to a paid Gemini tier before onboarding more
  than a couple of active Instagram clients, independent of the loop bug
  above (which was the main thing eating quota this time).

## Known issues / open work

Ordered by how badly they bite.

1. **Instagram webhook account ID mismatch (confirmed live, Aug 2026).** The
   ID `graph.instagram.com/me` returns at connect time (saved as
   `meta_ig_account_id` by the OAuth callback) can differ from the ID Meta's
   webhook actually puts in `entry.id` for comments on that *same* account.
   Confirmed on shree medicare / @velocitytech.in: OAuth saved
   `37847832231497193`, but every real comment webhook arrived tagged
   `17841468309625304` — a totally different ID for the same physical
   account. This is a known, long-unresolved Meta bug (see the Meta developer
   community thread "Mismatch Between IDs in Instagram Business Webhooks and
   Graph API" — no official fix as of Aug 2026), not something introduced by
   this codebase.
   - **Symptom:** dashboard stays at 0 forever; Vercel logs show
     `[meta webhook] no active client found for meta_ig_account_id=<id>`
     on every comment, even though the client is connected and active.
   - **Fix per affected client:** take the `<id>` from that log line and
     `PATCH /api/clients/{id}` with `{ "meta_ig_account_id": "<id>" }`
     (added to the route specifically for this — see the field comment in
     `src/app/api/clients/[id]/route.ts`). Deliberately not exposed in the
     admin UI; this is a manual correction after the first failed webhook,
     not a normal connect-flow field.
   - **No general fix exists** — the correct ID isn't knowable until a real
     webhook event reveals it, so every new client connecting via Instagram
     Login should be treated as "unverified until the first comment shows up
     in the dashboard or the logs."

2. **GBP reviews host is likely wrong.** `gbp.ts` calls
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

- **Meta App Review for Instagram Advanced Access (`instagram_business_basic`,
  `instagram_business_manage_comments`, `instagram_business_manage_messages`)
  — NOT submitted/approved.** This is the actual current blocker for real
  customer comments reaching the app at all — see the "Meta app identifiers"
  section for the full diagnosis (confirmed Aug 28 2026 via the Meta dashboard
  + Vercel runtime logs). Everything else in that checklist (publish, webhook
  config, Instagram login setup) is done.
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

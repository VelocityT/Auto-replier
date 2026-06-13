# Auto Replier

AI auto-reply engine for client comments/reviews across **Instagram, Facebook,
YouTube, and Google Business Profile** — built to run on Vercel's free tier
at $0/month for moderate volume.

- New comment arrives → AI reads it (Hindi / English / Hinglish), detects
  sentiment + intent → auto-replies if it's positive/neutral, or flags it
  for human review if it's negative/urgent/spam.
- All flagged items land in a simple **Review Queue** dashboard
  (`/` on your deployed app) where you approve, edit, or reject before posting.
- Every client's tone/instructions live in one `ai_instructions` text field —
  no code changes needed to onboard a new client.

> **LinkedIn is intentionally not included.** LinkedIn's API for replying to
> comments requires a Marketing Developer Platform partnership that small
> agencies can't realistically get. Handle LinkedIn manually for now.

---

## Cost reality check

| Piece | Cost |
|---|---|
| Hosting (Vercel Hobby) | Free — 1M function calls/mo, way more than you'll use |
| Database (Supabase free tier) | Free — 500MB Postgres |
| AI (Gemini 2.0 Flash) | Free tier covers most agency volume; pennies if you exceed it |
| Polling trigger (cron-job.org) | Free |
| Domain | Optional — Vercel gives you a free `*.vercel.app` subdomain |

**Total: ₹0/month to start.** The only thing that costs real money is your
own time setting up API access (below) — none of it is fast, but none of it
is paid either.

---

## 1. Supabase (database) — 5 minutes

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor → New query**, paste the contents of
   [`supabase/schema.sql`](./supabase/schema.sql), and run it.
3. Go to **Project Settings → API** and copy:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key (NOT the `anon` key) → `SUPABASE_SERVICE_ROLE_KEY`

---

## 2. Gemini AI key — 2 minutes

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
2. Create a free API key → `GEMINI_API_KEY`.

---

## 3. Instagram + Facebook (Meta Graph API)

This is the platform with the most setup but the best payoff (real-time
webhooks, no polling).

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create App** → type "Business".
2. Add the **Webhooks** product. Subscribe your app to the **Page** and
   **Instagram** objects.
3. Add the **Facebook Login** product too — this is what the admin panel's
   "Connect Facebook/Instagram" button uses.
4. Note your **App ID** and **App Secret** (Settings → Basic) →
   `META_APP_ID`, `META_APP_SECRET`.
5. Pick any random string for `META_VERIFY_TOKEN` (e.g. generate one with
   `openssl rand -hex 16`) — you'll enter this in the Meta dashboard *and*
   your Vercel env vars; they must match.
6. **Per client**: in Meta Business Suite, connect their Instagram
   Business/Creator account to their Facebook Page (the admin panel's
   Connect button captures the Page token and Instagram account ID
   automatically — see "Admin panel" section below).
7. **App Review**: to use this on real client accounts (not just your own
   test account), submit for review with permissions:
   `pages_show_list`, `pages_read_engagement`, `pages_manage_engagement`,
   `pages_manage_posts`, `instagram_basic`, `instagram_manage_comments`,
   `business_management`. Provide a short screen recording of the flow —
   Meta's review for these is usually 1-2 weeks. Until approved, the Connect
   button will only work for Pages owned by the app's own
   developers/testers (Meta returns `meta_no_pages` for anyone else — this
   is expected and the connection can be retried once approved).
8. After deploying to Vercel (step 6 below), set the webhook URL in Meta to:
   `https://YOUR-APP.vercel.app/api/webhooks/meta`
   with the verify token from step 5. Subscribe to the `comments` field (IG)
   and `feed` field (FB Page).

---

## 4. YouTube Data API

1. In [console.cloud.google.com](https://console.cloud.google.com), create a
   project (you can reuse this same project for Google Business Profile in
   step 5).
2. Enable **YouTube Data API v3** (APIs & Services → Library).
3. Create an **OAuth 2.0 Client ID** (APIs & Services → Credentials → Create
   Credentials → OAuth client ID → Web application). Add these **Authorized
   redirect URIs** (both — the admin panel uses one client ID for both
   YouTube and GBP connects):
   - `https://YOUR-APP.vercel.app/api/oauth/youtube/callback`
   - `https://YOUR-APP.vercel.app/api/oauth/gbp/callback`
   - For local testing, also add the `http://localhost:3000/...` equivalents.
4. Copy the Client ID/Secret → `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`.
5. **Per client**: log in to the admin panel (`/admin/clients`), open the
   client, and click **Connect YouTube**. Sign in with **the client's**
   Google account (the one that owns the YouTube channel) and approve
   access — the channel ID and refresh token are captured and saved
   automatically. See "Admin panel" section below.

---

## 5. Google Business Profile API (the slow one — start this first!)

GBP review management requires a manually-approved API access request. This
takes **3-10 business days**, so kick this off on day one even if you set up
the other platforms first.

1. Requirements before applying: a verified Google Business Profile that's
   been active 60+ days, and a business website matching the profile.
2. Apply via the [GBP API access request form](https://support.google.com/business/contact/api_default).
   Describe your use case honestly: "marketing agency replying to client
   reviews on their behalf." (Velocity Tech's case: **7-5896000040841**.)
3. Once approved, in the **same Google Cloud project** as step 4, enable the
   Business Profile APIs (Account Management, Business Information) and the
   legacy My Business API (used for review read/reply).
4. Make sure `https://YOUR-APP.vercel.app/api/oauth/gbp/callback` is in the
   OAuth client's Authorized redirect URIs (added in step 4.3 above — same
   client ID is reused).
5. **Per client**: in the admin panel, open the client and click **Connect
   Google Business**. Sign in with **the client's** Google account that
   manages their Business Profile and approve `business.manage` access.
   - If the account has exactly one location, `gbp_account_id` and
     `gbp_location_id` are captured automatically.
   - If it has multiple accounts/locations, you'll land on a picker to
     choose the right one.
   - If GBP API access isn't approved yet for this Google Cloud project,
     you'll see a "no accounts found" message — the refresh token is still
     saved, so just click **Choose location** again once access is granted
     (no need to reconnect).

**While waiting for approval**, the cron job simply skips clients without
`gbp_account_id`/`gbp_location_id` set.

---

## 6. Deploy to Vercel

1. Push this folder to a GitHub repo.
2. Go to [vercel.com/new](https://vercel.com/new), import the repo.
3. Add all environment variables from `.env.example` in the Vercel project
   settings (Settings → Environment Variables), including `ADMIN_PASSWORD`
   (pick a strong password — this is the only login for `/admin`).
4. Deploy. Your app is now live at `https://YOUR-APP.vercel.app`.
5. Go back and register the OAuth redirect URIs from steps 3.7/4.3/5.4 in
   Google Cloud Console and Meta, now that you have a real domain. Register
   the Meta webhook URL too (step 3.8).

---

## 7. Set up polling (YouTube + Google Business Profile)

Vercel's free Hobby plan only allows cron jobs that run **once per day**,
which is too slow for comments. Instead, use a free external pinger:

1. Go to [cron-job.org](https://cron-job.org), create a free account.
2. Create two cron jobs:
   - `https://YOUR-APP.vercel.app/api/cron/youtube?secret=YOUR_CRON_SECRET` — every 5-10 minutes
   - `https://YOUR-APP.vercel.app/api/cron/gbp?secret=YOUR_CRON_SECRET` — every 15-30 minutes (reviews are less time-sensitive)
3. `YOUR_CRON_SECRET` is whatever you set as `CRON_SECRET` in Vercel env vars
   — this stops randoms from triggering your endpoints.

---

## 8. Add your first client

1. Go to `https://YOUR-APP.vercel.app/login` and sign in with `ADMIN_PASSWORD`.
2. Click **Clients → + Add client**. Fill in:
   - `name`: e.g. "Dr Ashar Ali Clinic"
   - `ai_instructions`: tone, services, languages, escalation rules — see the
     example in `supabase/schema.sql`
   - `active`: checked
3. Save, then on the client page click **Connect** for each platform this
   client uses (YouTube, Google Business, Instagram/Facebook) — see the
   "Admin panel" section below for what each button does.

That's it — no Supabase Table Editor or OAuth Playground needed. Comments
start flowing immediately for Instagram/Facebook (webhook), and within one
polling cycle for YouTube/GBP, once a platform shows "Connected".

---

## Admin panel — connecting client accounts

`/admin/clients` (behind the `ADMIN_PASSWORD` login at `/login`) replaces
manual Supabase Table Editor + OAuth Playground work for day-to-day client
management:

- **List / add / edit clients** — name, AI instructions, active toggle.
- **Connect buttons** per platform, each kicking off the real OAuth flow and
  saving tokens automatically:
  - **YouTube** — fully working today. Click Connect, sign in as the
    client, done.
  - **Google Business Profile** — works today for capturing the refresh
    token; account/location auto-fill (or the picker) depends on GBP API
    access being approved for this Google Cloud project (case
    7-5896000040841, ~7-10 business days). If you see a "no accounts found"
    message after connecting, the token is saved — click **Choose location**
    again once approval comes through.
  - **Instagram / Facebook** — share one Page Access Token. Click Connect on
    either, log in with the client's Facebook account, and pick the right
    Page if they manage more than one. Until Meta App Review is approved
    (1-2 weeks), this only works for Pages owned by the app's own
    developers/testers — real client accounts will see a "no pages found"
    message, which is expected.
- **Disconnect** — clears the stored tokens for that platform (Instagram and
  Facebook disconnect together, since they share one Page token).
- **Logout** — top-right of the nav, clears the admin session cookie.

If a Connect button shows an error banner, the messages are written to be
self-explanatory (e.g. "Meta App Review hasn't approved this app yet") — no
need to dig through logs for routine pending-approval cases.

---

## Built-in safety guardrails

- **Negative, urgent, or spam-classified comments are NEVER auto-posted** —
  they always land in the Review Queue, regardless of what the AI thinks the
  reply should be.
- **Google Business Profile reviews of 3 stars or below are never
  auto-replied**, even if classified as neutral/positive — these always need
  a human's eyes given the public/permanent nature of GBP reviews.
- If the AI ever returns malformed output, the item is flagged rather than
  silently dropped or auto-posted.

You can loosen these rules later in `src/lib/ai.ts` and
`src/app/api/cron/gbp/route.ts` once you trust the system — but start
conservative.

---

## Local development

```bash
npm install
cp .env.example .env.local   # fill in your keys
npm run dev
```

Visit `http://localhost:3000` for the review queue. Webhooks need a public
URL to receive Meta's callbacks — use a tool like
[ngrok](https://ngrok.com) for local webhook testing.

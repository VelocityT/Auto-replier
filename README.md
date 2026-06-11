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
3. Note your **App ID** and **App Secret** (Settings → Basic) →
   `META_APP_ID`, `META_APP_SECRET`.
4. Pick any random string for `META_VERIFY_TOKEN` (e.g. generate one with
   `openssl rand -hex 16`) — you'll enter this in the Meta dashboard *and*
   your Vercel env vars; they must match.
5. **Per client**, in Meta Business Suite:
   - Connect their Instagram Business/Creator account to their Facebook Page.
   - Generate a long-lived **Page Access Token** for that Page (Graph API
     Explorer → select the Page → "Generate Access Token", then exchange for
     a long-lived token via `/oauth/access_token?grant_type=fb_exchange_token`).
   - Note the **Page ID** (`meta_page_id`) and **Instagram Business Account
     ID** (`meta_ig_account_id`, found via `GET /{page-id}?fields=instagram_business_account`).
6. **App Review**: to use this on real client accounts (not just your own
   test account), submit for review with permissions:
   `pages_manage_engagement`, `pages_read_engagement`, `instagram_manage_comments`,
   `instagram_basic`. Provide a short screen recording of the flow — Meta's
   review for these is usually 1-2 weeks.
7. After deploying to Vercel (step 6 below), set the webhook URL in Meta to:
   `https://YOUR-APP.vercel.app/api/webhooks/meta`
   with the verify token from step 4. Subscribe to the `comments` field (IG)
   and `feed` field (FB Page).

---

## 4. YouTube Data API

1. In [console.cloud.google.com](https://console.cloud.google.com), create a
   project (you can reuse this same project for Google Business Profile in
   step 5).
2. Enable **YouTube Data API v3** (APIs & Services → Library).
3. Create an **OAuth 2.0 Client ID** (APIs & Services → Credentials → Create
   Credentials → OAuth client ID → Web application). Add
   `https://developers.google.com/oauthplayground` as an authorized redirect URI.
4. Copy the Client ID/Secret → `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`.
5. **Per client**, get a refresh token for their YouTube channel:
   - Go to [Google OAuth Playground](https://developers.google.com/oauthplayground).
   - Click the gear icon → check "Use your own OAuth credentials" → paste
     your Client ID/Secret.
   - In Step 1, select scope `https://www.googleapis.com/auth/youtube.force-ssl`.
   - Authorize using **the client's** Google account (the one that owns the
     YouTube channel).
   - In Step 2, click "Exchange authorization code for tokens" → copy the
     **Refresh token** → store as `youtube_refresh_token` for that client.
   - Find their Channel ID (YouTube Studio → Settings → Channel → Advanced) →
     `youtube_channel_id`.

---

## 5. Google Business Profile API (the slow one — start this first!)

GBP review management requires a manually-approved API access request. This
takes **3-10 business days**, so kick this off on day one even if you set up
the other platforms first.

1. Requirements before applying: a verified Google Business Profile that's
   been active 60+ days, and a business website matching the profile.
2. Apply via the [GBP API access request form](https://support.google.com/business/contact/api_default).
   Describe your use case honestly: "marketing agency replying to client
   reviews on their behalf."
3. Once approved, in the **same Google Cloud project** as step 4, enable the
   Business Profile APIs (Account Management, Business Information).
4. Reuse the same OAuth client. Get a refresh token via OAuth Playground
   again, this time with scope `https://www.googleapis.com/auth/business.manage`,
   authorized by **the client's** Google account that manages their Business
   Profile → `gbp_refresh_token`.
5. Find `gbp_account_id` and `gbp_location_id`:
   - `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts` (with the access token) → account ID.
   - `GET https://mybusinessbusinessinformation.googleapis.com/v1/accounts/{accountId}/locations` → location ID.

**While waiting for approval**, leave `gbp_*` fields empty for that client —
the cron job simply skips clients without GBP configured.

---

## 6. Deploy to Vercel

1. Push this folder to a GitHub repo.
2. Go to [vercel.com/new](https://vercel.com/new), import the repo.
3. Add all environment variables from `.env.example` in the Vercel project
   settings (Settings → Environment Variables).
4. Deploy. Your app is now live at `https://YOUR-APP.vercel.app`.
5. Go back to step 3.7 and register the webhook URL in Meta now that you
   have a real domain.

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

In Supabase → Table Editor → `clients`, insert a row with:

- `name`: e.g. "Dr Ashar Ali Clinic"
- `ai_instructions`: tone, services, languages, escalation rules — see the
  example in `supabase/schema.sql`
- The platform IDs/tokens you collected above for whichever platforms this
  client uses (leave others `null`)
- `active`: `true`

That's it — no redeploy needed. Comments start flowing immediately for
Instagram/Facebook (webhook), and within one polling cycle for YouTube/GBP.

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

import { NextRequest, NextResponse } from "next/server";

// Auth gate DISABLED (Sep 2026, at owner's request) — every route, including
// the dashboard, review queue, and admin client-management screens, is now
// open with no password. This was previously gated behind SESSION_COOKIE /
// isValidSessionToken (see src/lib/auth.ts and src/app/login/ — both still
// present, just unused) because those screens can approve/reject AI replies,
// disconnect a client's Instagram/YouTube/GBP connection, and start new
// OAuth connect flows for real client accounts.
//
// Risk this removes protection against: anyone with the production URL can
// now do all of that with no login. `toSafeClient()` in src/lib/clients.ts
// still strips access/refresh tokens before anything reaches the browser,
// so credentials themselves are not exposed — but the admin actions above
// are. If this ever needs to be re-enabled, restore the body of this file
// from git history (the auth check + redirect-to-/login logic) — nothing
// else needs to change, /login and /api/auth/* were left in place.
//
// /api/cron/* and /api/webhooks/* were always public regardless (own
// ?secret= / signature checks).

export async function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except framework internals and static files.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

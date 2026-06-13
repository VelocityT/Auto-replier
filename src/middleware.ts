import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSessionToken } from "@/lib/auth";

// Gate the entire app behind a simple password. This protects the review
// queue, dashboard, and admin client-management screens — all internal
// tools that should only be used by Velocity Tech staff.
//
// NOT gated (must stay open for external callers):
//   /login                — the login page itself
//   /api/auth/*           — login/logout endpoints
//   /api/cron/*           — polled by cron-job.org with its own ?secret=
//   /api/webhooks/*        — called by Meta with its own signature check
//   _next/static, favicon  — framework assets
//
// /api/oauth/* is intentionally NOT public — the admin must be logged in
// (with the session cookie) to start a connect flow, and the browser keeps
// that cookie through the Google/Meta redirect dance.

const PUBLIC_PATHS = ["/login", "/api/auth", "/api/cron", "/api/webhooks"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = await isValidSessionToken(token);

  if (!valid) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

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

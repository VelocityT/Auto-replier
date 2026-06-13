// Lightweight password-gate auth shared between middleware (Edge runtime)
// and API routes (Node runtime). Uses Web Crypto's SHA-256, which is
// available in both environments — no extra dependencies.

export const SESSION_COOKIE = "ar_session";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The value we store in the session cookie when the admin logs in.
 * It's a hash of the admin password — anyone who knows the password could
 * compute it too, but that's fine: knowing the password is exactly the bar
 * for being logged in to this internal tool.
 */
export async function getSessionToken(): Promise<string> {
  const password = process.env.ADMIN_PASSWORD ?? "";
  return sha256Hex(`auto-replier-session:${password}`);
}

export async function isValidPassword(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  // Both empty means auth is unconfigured — fail closed rather than
  // letting everyone in.
  if (!expected) return false;
  return password === expected;
}

export async function isValidSessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  if (!process.env.ADMIN_PASSWORD) return false;
  const expected = await getSessionToken();
  return token === expected;
}

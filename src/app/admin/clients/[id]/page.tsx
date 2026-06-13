import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { ClientConfig } from "@/lib/types";
import { toSafeClient } from "@/lib/clients";
import { PLATFORM_LABELS } from "@/lib/platforms";
import TopNav from "@/app/components/TopNav";
import ClientEditForm from "./ClientEditForm";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  youtube_not_configured: "YouTube/Google OAuth isn't configured yet (missing GBP_OAUTH_CLIENT_ID/SECRET).",
  youtube_no_refresh_token:
    "Google didn't return a refresh token. Try disconnecting the app's access at myaccount.google.com/permissions, then connect again.",
  youtube_token_exchange_failed: "Failed to exchange the Google authorization code. Please try again.",
  youtube_save_failed: "Connected to Google, but failed to save the result. Please try again.",
  youtube_missing_code: "Google didn't return an authorization code. Please try again.",
  youtube_access_denied: "Access was denied on Google's consent screen.",
  gbp_not_configured: "Google OAuth isn't configured yet (missing GBP_OAUTH_CLIENT_ID/SECRET).",
  gbp_no_refresh_token:
    "Google didn't return a refresh token. Try disconnecting the app's access at myaccount.google.com/permissions, then connect again.",
  gbp_token_exchange_failed: "Failed to exchange the Google authorization code. Please try again.",
  gbp_save_failed: "Connected to Google, but failed to save the result. Please try again.",
  gbp_missing_code: "Google didn't return an authorization code. Please try again.",
  gbp_access_denied: "Access was denied on Google's consent screen.",
  gbp_no_accounts:
    "Connected to Google, but no Business Profile accounts were found (or GBP API access isn't approved yet for this Google Cloud project). The connection is saved — locations can be picked once access is approved.",
  gbp_no_locations: "Connected to Google, but no locations were found for this Business Profile account.",
  meta_not_configured: "Instagram/Facebook isn't configured yet (missing META_APP_ID/META_APP_SECRET).",
  meta_token_exchange_failed: "Failed to exchange the Meta authorization code. Please try again.",
  meta_no_pages:
    "Connected to Meta, but no Facebook Pages were found for this account (or Meta App Review hasn't approved this app for client accounts yet).",
  meta_access_denied: "Access was denied on Meta's login dialog.",
  meta_save_failed: "Connected to Meta, but failed to save the result. Please try again.",
};

export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { connected?: string; error?: string };
}) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", params.id)
    .maybeSingle<ClientConfig>();

  if (error || !data) {
    notFound();
  }

  return (
    <div className="container admin">
      <TopNav active="clients" />

      {searchParams.connected && (
        <div className="admin-status-ok admin-banner">
          Connected {PLATFORM_LABELS[searchParams.connected as keyof typeof PLATFORM_LABELS] ?? searchParams.connected}.
        </div>
      )}
      {searchParams.error && (
        <div className="login-error admin-banner">
          {ERROR_MESSAGES[searchParams.error] ?? `Something went wrong (${searchParams.error}).`}
        </div>
      )}

      <ClientEditForm client={toSafeClient(data)} />
    </div>
  );
}

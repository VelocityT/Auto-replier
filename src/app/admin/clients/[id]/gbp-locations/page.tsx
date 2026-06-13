import { notFound, redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { ClientConfig } from "@/lib/types";
import { listAccounts, listLocations } from "@/lib/gbp";
import TopNav from "@/app/components/TopNav";

export const dynamic = "force-dynamic";

// Picker shown after a GBP OAuth connect when the account/location can't be
// auto-resolved (multiple accounts, or multiple locations under one
// account). Queries live using the refresh token already saved on the
// client row — never renders the token itself.
export default async function GbpLocationsPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { account?: string };
}) {
  const { data: client, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", params.id)
    .maybeSingle<ClientConfig>();

  if (error || !client) {
    notFound();
  }

  if (!client.gbp_refresh_token) {
    redirect(`/admin/clients/${params.id}?error=gbp_no_accounts`);
  }

  const selectedAccount = searchParams.account ?? null;

  return (
    <div className="container admin">
      <TopNav active="clients" />
      <h1 className="admin-section-title">Choose Google Business Profile location</h1>
      <p style={{ marginBottom: 16, color: "var(--muted, #888)" }}>
        Client: <strong>{client.name}</strong>
      </p>

      {selectedAccount ? (
        <LocationPicker clientId={client.id} refreshToken={client.gbp_refresh_token} accountName={selectedAccount} />
      ) : (
        <AccountPicker clientId={client.id} refreshToken={client.gbp_refresh_token} />
      )}

      <p style={{ marginTop: 24 }}>
        <a href={`/admin/clients/${client.id}`} className="nav-link">
          ← Back to client
        </a>
      </p>
    </div>
  );
}

async function AccountPicker({ clientId, refreshToken }: { clientId: string; refreshToken: string }) {
  let accounts;
  try {
    accounts = await listAccounts(refreshToken);
  } catch {
    return (
      <div className="login-error admin-banner">
        Couldn&apos;t load Business Profile accounts. The GBP API may not be approved yet for this Google Cloud
        project (case 7-5896000040841), or the connection may have expired — try reconnecting from the client page.
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="login-error admin-banner">
        No Business Profile accounts were found for this Google account.
      </div>
    );
  }

  return (
    <div className="admin-client-list">
      {accounts.map((a) => (
        <a key={a.name} className="admin-client-row" href={`/admin/clients/${clientId}/gbp-locations?account=${encodeURIComponent(a.name)}`}>
          <span>{a.accountName}</span>
          <span style={{ opacity: 0.6, fontSize: "0.85em" }}>{a.name}</span>
        </a>
      ))}
    </div>
  );
}

async function LocationPicker({
  clientId,
  refreshToken,
  accountName,
}: {
  clientId: string;
  refreshToken: string;
  accountName: string;
}) {
  let locations;
  try {
    locations = await listLocations(refreshToken, accountName);
  } catch {
    return (
      <div className="login-error admin-banner">
        Couldn&apos;t load locations for this account. The GBP API may not be approved yet for this Google Cloud
        project (case 7-5896000040841), or access to this account may be restricted.
      </div>
    );
  }

  if (locations.length === 0) {
    return <div className="login-error admin-banner">No locations were found for this account.</div>;
  }

  return (
    <div className="admin-client-list">
      {locations.map((l) => (
        <form key={l.name} action="/api/oauth/gbp/select" method="POST" className="admin-client-row">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="accountName" value={accountName} />
          <input type="hidden" name="locationName" value={l.name} />
          <span>
            {l.title}
            {l.address ? <span style={{ opacity: 0.6, fontSize: "0.85em" }}> — {l.address}</span> : null}
          </span>
          <button type="submit" className="btn-approve admin-add-btn">
            Select
          </button>
        </form>
      ))}
    </div>
  );
}

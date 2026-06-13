import { supabase } from "@/lib/supabase";
import type { ClientConfig } from "@/lib/types";
import { toSafeClient } from "@/lib/clients";
import { PLATFORM_LABELS, PLATFORM_ORDER } from "@/lib/platforms";
import TopNav from "@/app/components/TopNav";
import PlatformIcon from "@/app/components/PlatformIcon";

export const dynamic = "force-dynamic";

export default async function AdminClientsPage() {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<ClientConfig[]>();

  const clients = (data ?? []).map(toSafeClient);

  return (
    <div className="container admin">
      <TopNav active="clients" />

      <div className="admin-header">
        <div>
          <h1>Clients</h1>
          <p className="subtitle">Manage clients and connect their social platforms.</p>
        </div>
        <a href="/admin/clients/new" className="btn-approve admin-add-btn">
          + Add client
        </a>
      </div>

      {error ? (
        <div className="card">Error loading clients: {error.message}</div>
      ) : clients.length === 0 ? (
        <div className="empty-state">No clients yet. Add your first one to get started.</div>
      ) : (
        <div className="admin-client-list">
          {clients.map((client) => (
            <a key={client.id} href={`/admin/clients/${client.id}`} className="admin-client-row">
              <div className="admin-client-row-main">
                <span className="admin-client-name">{client.name}</span>
                <span className={`badge ${client.active ? "badge-positive" : "badge-spam"}`}>
                  {client.active ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="admin-client-row-platforms">
                {PLATFORM_ORDER.map((p) => {
                  const conn = client.connections[p];
                  return (
                    <span
                      key={p}
                      className={`platform-pill platform-${p} ${conn.connected ? "" : "platform-pill-off"}`}
                    >
                      <PlatformIcon platform={p} size={14} /> {PLATFORM_LABELS[p]}{" "}
                      {conn.connected ? "✓" : "—"}
                    </span>
                  );
                })}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

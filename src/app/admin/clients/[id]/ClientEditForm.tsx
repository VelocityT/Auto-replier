"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SafeClient } from "@/lib/clients";
import { PLATFORM_ICONS, PLATFORM_LABELS } from "@/lib/platforms";

interface ConnectionMeta {
  platform: "gbp" | "youtube" | "facebook" | "instagram";
  title: string;
  detailLines: (client: SafeClient) => string[];
  note?: string;
}

const CONNECTIONS: ConnectionMeta[] = [
  {
    platform: "gbp",
    title: "Google Business Profile",
    detailLines: (c) => {
      const lines: string[] = [];
      if (c.connections.gbp.account_id) lines.push(`Account: ${c.connections.gbp.account_id}`);
      if (c.connections.gbp.location_id) lines.push(`Location: ${c.connections.gbp.location_id}`);
      return lines;
    },
    note: "Requires Google's GBP API access approval (in progress) before reviews sync.",
  },
  {
    platform: "youtube",
    title: "YouTube",
    detailLines: (c) => {
      const lines: string[] = [];
      if (c.connections.youtube.channel_id) lines.push(`Channel: ${c.connections.youtube.channel_id}`);
      return lines;
    },
  },
  {
    platform: "instagram",
    title: "Instagram",
    detailLines: (c) => {
      const lines: string[] = [];
      if (c.connections.instagram.ig_account_id) lines.push(`Account: ${c.connections.instagram.ig_account_id}`);
      return lines;
    },
    note: "Requires Meta App Review before going live on real client accounts.",
  },
  {
    platform: "facebook",
    title: "Facebook",
    detailLines: (c) => {
      const lines: string[] = [];
      if (c.connections.facebook.page_id) lines.push(`Page: ${c.connections.facebook.page_id}`);
      return lines;
    },
    note: "Requires Meta App Review before going live on real client accounts.",
  },
];

export default function ClientEditForm({ client }: { client: SafeClient }) {
  const router = useRouter();
  const [name, setName] = useState(client.name);
  const [aiInstructions, setAiInstructions] = useState(client.ai_instructions);
  const [active, setActive] = useState(client.active);
  const [connections, setConnections] = useState(client.connections);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setSaving(true);

    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ai_instructions: aiInstructions, active }),
      });
      const data = await res.json();

      if (data.ok) {
        setStatus({ type: "ok", text: "Saved." });
      } else {
        setStatus({ type: "error", text: data.error || "Failed to save" });
      }
    } catch {
      setStatus({ type: "error", text: "Something went wrong. Try again." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect(platform: string) {
    setDisconnecting(platform);
    setStatus(null);

    try {
      const res = await fetch(`/api/clients/${client.id}/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const data = await res.json();

      if (data.ok) {
        setConnections(data.client.connections);
      } else {
        setStatus({ type: "error", text: data.error || "Failed to disconnect" });
      }
    } catch {
      setStatus({ type: "error", text: "Something went wrong. Try again." });
    } finally {
      setDisconnecting(null);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${client.name}"? This cannot be undone.`)) return;

    setDeleting(true);
    setStatus(null);

    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: "DELETE" });
      const data = await res.json();

      if (data.ok) {
        router.push("/admin/clients");
        router.refresh();
      } else {
        setStatus({ type: "error", text: data.error || "Failed to delete client" });
        setDeleting(false);
      }
    } catch {
      setStatus({ type: "error", text: "Something went wrong. Try again." });
      setDeleting(false);
    }
  }

  return (
    <>
      <h1>{client.name}</h1>
      <p className="subtitle">Edit details and connect this client's social platforms.</p>

      <form className="card admin-form" onSubmit={handleSave}>
        <label className="admin-field">
          <span>Client name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>

        <label className="admin-field">
          <span>AI instructions</span>
          <textarea
            value={aiInstructions}
            onChange={(e) => setAiInstructions(e.target.value)}
            placeholder="Tone, services, languages, escalation rules..."
            rows={8}
          />
        </label>

        <label className="admin-field admin-field-checkbox">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Active (auto-reply enabled)</span>
        </label>

        {status && (
          <div className={status.type === "ok" ? "admin-status-ok" : "login-error"}>{status.text}</div>
        )}

        <div className="admin-form-actions">
          <button type="button" className="btn-reject" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete client"}
          </button>
          <button type="submit" className="btn-approve" disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      <h2 className="admin-section-title">Connected platforms</h2>
      <div className="connection-grid">
        {CONNECTIONS.map((meta) => {
          const conn = connections[meta.platform];
          const details = meta.detailLines(client);

          return (
            <div key={meta.platform} className="connection-card">
              <div className="connection-card-header">
                <span className="connection-card-icon">{PLATFORM_ICONS[meta.platform]}</span>
                <span className="connection-card-title">{PLATFORM_LABELS[meta.platform]}</span>
                <span className={conn.connected ? "connection-status connection-status-on" : "connection-status connection-status-off"}>
                  {conn.connected ? "Connected" : "Not connected"}
                </span>
              </div>

              {details.length > 0 && (
                <div className="connection-card-details">
                  {details.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              )}

              {meta.note && <p className="connection-card-note">{meta.note}</p>}

              <div className="connection-card-actions">
                {conn.connected ? (
                  <>
                    {meta.platform === "gbp" && !connections.gbp.location_id && (
                      <a href={`/admin/clients/${client.id}/gbp-locations`} className="btn-approve">
                        Choose location
                      </a>
                    )}
                    <button
                      type="button"
                      className="btn-reject"
                      onClick={() => handleDisconnect(meta.platform)}
                      disabled={disconnecting === meta.platform}
                    >
                      {disconnecting === meta.platform ? "Disconnecting…" : "Disconnect"}
                    </button>
                  </>
                ) : (
                  <a href={`/api/oauth/${meta.platform}/start?clientId=${client.id}`} className="btn-approve">
                    Connect {PLATFORM_LABELS[meta.platform]}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/app/components/TopNav";

export default function NewClientPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [aiInstructions, setAiInstructions] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ai_instructions: aiInstructions, active }),
      });
      const data = await res.json();

      if (data.ok) {
        router.push(`/admin/clients/${data.client.id}`);
      } else {
        setError(data.error || "Failed to create client");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container admin">
      <TopNav active="clients" />

      <h1>Add client</h1>
      <p className="subtitle">You can connect their social platforms after saving.</p>

      <form className="card admin-form" onSubmit={handleSubmit}>
        <label className="admin-field">
          <span>Client name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Shree Medicare"
            required
          />
        </label>

        <label className="admin-field">
          <span>AI instructions</span>
          <textarea
            value={aiInstructions}
            onChange={(e) => setAiInstructions(e.target.value)}
            placeholder="Tone, services, languages, escalation rules..."
            rows={6}
          />
        </label>

        <label className="admin-field admin-field-checkbox">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Active (auto-reply enabled)</span>
        </label>

        {error && <div className="login-error">{error}</div>}

        <div className="admin-form-actions">
          <a href="/admin/clients" className="btn-reject">
            Cancel
          </a>
          <button type="submit" className="btn-approve" disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save client"}
          </button>
        </div>
      </form>
    </div>
  );
}

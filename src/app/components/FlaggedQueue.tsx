"use client";

import { useState } from "react";
import type { AiAnalysis, Platform } from "@/lib/types";

export interface FlaggedItemWithClient {
  id: string;
  platform: Platform;
  author_name: string | null;
  original_text: string;
  ai_analysis: AiAnalysis;
  created_at: string;
  clients: { name: string } | null;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  gbp: "Google Business Profile",
};

export default function FlaggedQueue({ initialItems }: { initialItems: FlaggedItemWithClient[] }) {
  const [items, setItems] = useState(initialItems);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initialItems.map((i) => [i.id, i.ai_analysis.reply ?? ""]))
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject") {
    setLoadingId(id);
    setErrorId(null);
    try {
      const res = await fetch(`/api/flagged/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, replyText: drafts[id] }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Request failed");

      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err: any) {
      setErrorId(`${id}:${err.message}`);
    } finally {
      setLoadingId(null);
    }
  }

  if (items.length === 0) {
    return <div className="empty-state">Nothing waiting for review. 🎉</div>;
  }

  return (
    <div>
      {items.map((item) => {
        const a = item.ai_analysis;
        const error = errorId?.startsWith(`${item.id}:`) ? errorId.split(":")[1] : null;

        return (
          <div className="card" key={item.id}>
            <div className="card-header">
              <span>
                {item.clients?.name ?? "Unknown client"} · {PLATFORM_LABELS[item.platform]}
                {item.author_name ? ` · ${item.author_name}` : ""}
              </span>
              <span>
                <span className={`badge badge-${a.sentiment}`}>{a.sentiment}</span>
              </span>
            </div>

            <div className="original-text">{item.original_text}</div>

            <textarea
              value={drafts[item.id]}
              onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
              placeholder={a.reply ? "" : "No suggested reply (e.g. spam) — leave blank to reject only"}
            />

            <div className="reasoning">AI note: {a.reasoning} ({a.intent}, {a.language})</div>

            {error && <div className="reasoning" style={{ color: "#b3261e" }}>Error: {error}</div>}

            <div className="actions">
              <button
                className="btn-approve"
                disabled={loadingId === item.id || !drafts[item.id]?.trim()}
                onClick={() => act(item.id, "approve")}
              >
                {loadingId === item.id ? "Posting…" : "Approve & Post"}
              </button>
              <button
                className="btn-reject"
                disabled={loadingId === item.id}
                onClick={() => act(item.id, "reject")}
              >
                Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

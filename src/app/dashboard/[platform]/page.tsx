import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { ClientConfig, FlaggedItem, Platform, ProcessedItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  gbp: "Google Business",
};

const PLATFORM_ICONS: Record<Platform, string> = {
  instagram: "\u{1F4F8}",
  facebook: "\u{1F44D}",
  youtube: "\u{25B6}\u{FE0F}",
  gbp: "\u{2B50}",
};

const VALID_PLATFORMS: Platform[] = ["gbp", "youtube", "instagram", "facebook"];

interface LatestReply {
  original: string | null;
  reply: string | null;
  status: "auto_replied" | "posted";
}

interface PostRow {
  key: string;
  label: string;
  url: string | null;
  total: number;
  pending: number;
  replied: number;
  latest: LatestReply | null;
}

interface ClientRows {
  client: ClientConfig;
  posts: PostRow[];
  totals: { total: number; pending: number; replied: number };
}

export default async function PlatformPage({ params }: { params: { platform: string } }) {
  const platform = params.platform as Platform;
  if (!VALID_PLATFORMS.includes(platform)) {
    notFound();
  }

  const [clientsRes, processedRes, flaggedRes] = await Promise.all([
    supabase.from("clients").select("*").returns<ClientConfig[]>(),
    supabase
      .from("processed_items")
      .select("*")
      .eq("platform", platform)
      .order("created_at", { ascending: false })
      .returns<ProcessedItem[]>(),
    supabase.from("flagged_items").select("*").eq("platform", platform).returns<FlaggedItem[]>(),
  ]);

  const error = clientsRes.error || processedRes.error || flaggedRes.error;
  const clients = clientsRes.data ?? [];
  const processed = processedRes.data ?? [];
  const flagged = flaggedRes.data ?? [];

  // Only show clients that actually have this platform configured.
  const configuredClients = clients.filter((c) => {
    if (platform === "instagram") return !!c.meta_ig_account_id && !!c.meta_page_access_token;
    if (platform === "facebook") return !!c.meta_page_id && !!c.meta_page_access_token;
    if (platform === "youtube") return !!c.youtube_refresh_token;
    return !!c.gbp_refresh_token;
  });

  // Lookup for flagged items, so we can tell whether a "flagged" processed item
  // was later approved + posted by a human (and what was sent).
  const flaggedMap = new Map<string, FlaggedItem>();
  for (const f of flagged) {
    flaggedMap.set(`${f.client_id}:${f.platform}:${f.external_id}`, f);
  }

  const clientRows: ClientRows[] = [];

  for (const client of configuredClients) {
    const clientItems = processed.filter((p) => p.client_id === client.id);
    if (clientItems.length === 0) {
      clientRows.push({ client, posts: [], totals: { total: 0, pending: 0, replied: 0 } });
      continue;
    }

    const postMap = new Map<string, PostRow>();

    // processed is ordered newest-first, so the first item we see for a post
    // is the most recent one.
    for (const item of clientItems) {
      const postRef = item.post_ref;
      const postKey = postRef ? `${platform}:${postRef.id}` : `${platform}:none`;

      let row = postMap.get(postKey);
      if (!row) {
        row = {
          key: postKey,
          label:
            postRef?.label ??
            (platform === "gbp" ? "Google reviews" : `${PLATFORM_LABELS[platform]} (general)`),
          url: postRef?.url ?? null,
          total: 0,
          pending: 0,
          replied: 0,
          latest: null,
        };
        postMap.set(postKey, row);
      }

      row.total++;

      if (item.status === "auto_replied") {
        row.replied++;
        if (!row.latest) {
          row.latest = { original: item.original_text, reply: item.reply_text, status: "auto_replied" };
        }
      } else if (item.status === "flagged") {
        const f = flaggedMap.get(`${item.client_id}:${item.platform}:${item.external_id}`);
        if (f?.status === "posted") {
          row.replied++;
          if (!row.latest) {
            row.latest = {
              original: item.original_text,
              reply: f.ai_analysis?.reply ?? null,
              status: "posted",
            };
          }
        } else if (f?.status === "pending") {
          row.pending++;
        }
      }
    }

    const posts = Array.from(postMap.values()).sort((a, b) => b.total - a.total);
    const totals = posts.reduce(
      (acc, p) => {
        acc.total += p.total;
        acc.pending += p.pending;
        acc.replied += p.replied;
        return acc;
      },
      { total: 0, pending: 0, replied: 0 }
    );

    clientRows.push({ client, posts, totals });
  }

  // Active clients with activity first, then active clients with none, then inactive.
  clientRows.sort((a, b) => {
    if (a.client.active !== b.client.active) return a.client.active ? -1 : 1;
    if (a.posts.length !== b.posts.length) return b.posts.length - a.posts.length;
    return a.client.name.localeCompare(b.client.name);
  });

  return (
    <div className="container dashboard">
      <nav className="top-nav">
        <a href="/" className="nav-link">
          Review Queue
        </a>
        <a href="/dashboard" className="nav-link active">
          Dashboard
        </a>
      </nav>

      <h1>
        {PLATFORM_ICONS[platform]} {PLATFORM_LABELS[platform]}
      </h1>
      <p className="subtitle">
        <a href="/dashboard" style={{ color: "#4f46e5", fontWeight: 600, textDecoration: "none" }}>
          ← Back to dashboard
        </a>
      </p>

      {error ? (
        <div className="card">Error loading data: {error.message}</div>
      ) : clientRows.length === 0 ? (
        <div className="empty-state">No clients have {PLATFORM_LABELS[platform]} connected yet.</div>
      ) : (
        clientRows.map(({ client, posts, totals }) => (
          <div className="platform-table-wrap" key={client.id}>
            <div className="platform-client-header">
              <h2>
                {client.name}{" "}
                <span className={`badge ${client.active ? "badge-positive" : "badge-spam"}`}>
                  {client.active ? "Active" : "Inactive"}
                </span>
              </h2>
              <div>
                <span className="count-pill count-pill-replied" style={{ marginRight: 6 }}>
                  {totals.replied} replied
                </span>
                <span className="count-pill count-pill-pending">{totals.pending} pending</span>
              </div>
            </div>

            {posts.length === 0 ? (
              <div className="empty-state-small" style={{ padding: "16px 20px" }}>
                No comments/reviews recorded yet for this client.
              </div>
            ) : (
              <table className="platform-table">
                <thead>
                  <tr>
                    <th>{platform === "gbp" ? "Source" : "Post"}</th>
                    <th>Comments</th>
                    <th>Pending</th>
                    <th>Replied</th>
                    <th>Latest AI reply</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((post) => (
                    <tr key={post.key}>
                      <td>
                        {post.url ? (
                          <a href={post.url} target="_blank" rel="noopener noreferrer" className="post-link">
                            {post.label}
                          </a>
                        ) : (
                          <span className="post-link">{post.label}</span>
                        )}
                      </td>
                      <td>
                        <span className="count-pill">{post.total}</span>
                      </td>
                      <td>
                        {post.pending > 0 ? (
                          <span className="count-pill count-pill-pending">{post.pending}</span>
                        ) : (
                          <span className="count-pill">0</span>
                        )}
                      </td>
                      <td>
                        {post.replied > 0 ? (
                          <span className="count-pill count-pill-replied">{post.replied}</span>
                        ) : (
                          <span className="count-pill">0</span>
                        )}
                      </td>
                      <td>
                        {post.latest?.reply ? (
                          <>
                            <span className="reply-preview">{post.latest.reply}</span>
                            {post.latest.original && (
                              <span className="original-comment">
                                On: &ldquo;{post.latest.original}&rdquo;
                                {post.latest.status === "posted" ? " (sent via review queue)" : ""}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="reply-preview reply-preview-empty">No reply sent yet</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))
      )}
    </div>
  );
}

import { supabase } from "@/lib/supabase";
import TopNav from "@/app/components/TopNav";
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

const PLATFORM_ORDER: Platform[] = ["gbp", "youtube", "instagram", "facebook"];

const PLATFORM_DISPLAY_ORDER: Platform[] = ["youtube", "instagram", "facebook", "gbp"];

interface PostStat {
  key: string;
  label: string;
  url: string | null;
  platform: Platform;
  total: number;
  replied: number;
}

interface ClientStats {
  client: ClientConfig;
  commentsToday: number;
  autoRepliedToday: number;
  manualRepliedToday: number;
  pendingReview: number;
  posts: PostStat[];
}

interface PlatformStats {
  pending: number; // currently awaiting review, right now
  replied: number; // all-time replies sent (auto + via review queue)
  total: number; // all-time comments/reviews seen
}

// "Today" is computed in IST (UTC+5:30) since this app is run for India-based
// clients — a comment that came in at 11pm IST shouldn't roll into "yesterday".
function getIstDayRange() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const istMidnightUtcMs = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
  const startUTC = new Date(istMidnightUtcMs - IST_OFFSET_MS);
  const endUTC = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000);
  return { startUTC, endUTC };
}

export default async function DashboardPage() {
  const { startUTC, endUTC } = getIstDayRange();

  const [clientsRes, processedRes, flaggedRes, allProcessedRes] = await Promise.all([
    supabase.from("clients").select("*").returns<ClientConfig[]>(),
    supabase
      .from("processed_items")
      .select("*")
      .gte("created_at", startUTC.toISOString())
      .lt("created_at", endUTC.toISOString())
      .returns<ProcessedItem[]>(),
    supabase.from("flagged_items").select("*").returns<FlaggedItem[]>(),
    supabase.from("processed_items").select("platform, status").returns<{ platform: Platform; status: string }[]>(),
  ]);

  const error = clientsRes.error || processedRes.error || flaggedRes.error || allProcessedRes.error;
  const clients = clientsRes.data ?? [];
  const processedToday = processedRes.data ?? [];
  const flaggedAll = flaggedRes.data ?? [];
  const allProcessed = allProcessedRes.data ?? [];

  // Platform-level snapshot: pending = needs attention right now, replied =
  // all-time total of comments/reviews we've actually responded to.
  const platformStats: Record<Platform, PlatformStats> = {
    instagram: { pending: 0, replied: 0, total: 0 },
    facebook: { pending: 0, replied: 0, total: 0 },
    youtube: { pending: 0, replied: 0, total: 0 },
    gbp: { pending: 0, replied: 0, total: 0 },
  };

  for (const f of flaggedAll) {
    if (f.status === "pending") platformStats[f.platform].pending++;
    if (f.status === "posted") platformStats[f.platform].replied++;
  }

  for (const p of allProcessed) {
    platformStats[p.platform].total++;
    if (p.status === "auto_replied") platformStats[p.platform].replied++;
  }

  // Lookup so we can tell, for an item that was flagged, whether a human
  // approved + posted it (and whether that happened today).
  const flaggedMap = new Map<string, FlaggedItem>();
  for (const f of flaggedAll) {
    flaggedMap.set(`${f.client_id}:${f.platform}:${f.external_id}`, f);
  }

  const statsByClient = new Map<string, ClientStats>();
  for (const client of clients) {
    statsByClient.set(client.id, {
      client,
      commentsToday: 0,
      autoRepliedToday: 0,
      manualRepliedToday: 0,
      pendingReview: 0,
      posts: [],
    });
  }

  // Pending review = needs attention right now, regardless of when it arrived.
  for (const f of flaggedAll) {
    if (f.status !== "pending") continue;
    const stats = statsByClient.get(f.client_id);
    if (stats) stats.pendingReview++;
  }

  const postMaps = new Map<string, Map<string, PostStat>>();

  for (const item of processedToday) {
    const stats = statsByClient.get(item.client_id);
    if (!stats) continue;

    stats.commentsToday++;

    let replied = false;
    if (item.status === "auto_replied") {
      stats.autoRepliedToday++;
      replied = true;
    } else if (item.status === "flagged") {
      const flagged = flaggedMap.get(`${item.client_id}:${item.platform}:${item.external_id}`);
      if (flagged?.status === "posted") {
        const updatedAt = new Date(flagged.updated_at);
        if (updatedAt >= startUTC && updatedAt < endUTC) {
          stats.manualRepliedToday++;
          replied = true;
        }
      }
    }

    let clientPosts = postMaps.get(item.client_id);
    if (!clientPosts) {
      clientPosts = new Map();
      postMaps.set(item.client_id, clientPosts);
    }

    const postRef = item.post_ref;
    const postKey = postRef ? `${item.platform}:${postRef.id}` : `${item.platform}:none`;

    let postStat = clientPosts.get(postKey);
    if (!postStat) {
      postStat = {
        key: postKey,
        label: postRef?.label ?? (item.platform === "gbp" ? "Google reviews" : `${PLATFORM_LABELS[item.platform]} (general)`),
        url: postRef?.url ?? null,
        platform: item.platform,
        total: 0,
        replied: 0,
      };
      clientPosts.set(postKey, postStat);
    }
    postStat.total++;
    if (replied) postStat.replied++;
  }

  for (const [clientId, clientPosts] of postMaps) {
    const stats = statsByClient.get(clientId);
    if (stats) stats.posts = Array.from(clientPosts.values()).sort((a, b) => b.total - a.total);
  }

  const allStats = Array.from(statsByClient.values()).sort((a, b) => {
    if (a.client.active !== b.client.active) return a.client.active ? -1 : 1;
    return a.client.name.localeCompare(b.client.name);
  });

  const totals = allStats.reduce(
    (acc, s) => {
      acc.comments += s.commentsToday;
      acc.replied += s.autoRepliedToday + s.manualRepliedToday;
      acc.pending += s.pendingReview;
      return acc;
    },
    { comments: 0, replied: 0, pending: 0 }
  );

  const todayLabel = new Date(startUTC.getTime() + 5.5 * 60 * 60 * 1000).toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Greeting + a few headline numbers for the pastel stat cards.
  const istHour = new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours();
  const greeting = istHour < 12 ? "Good morning" : istHour < 17 ? "Good afternoon" : "Good evening";

  const activeClients = clients.filter((c) => c.active).length;

  const connectedCount = clients.reduce((sum, c) => {
    let n = 0;
    if (c.youtube_refresh_token) n++;
    if (c.gbp_refresh_token) n++;
    if (c.meta_page_id && c.meta_page_access_token) n++;
    if (c.meta_ig_account_id && c.meta_page_access_token) n++;
    return sum + n;
  }, 0);
  const totalPossible = clients.length * 4;

  return (
    <div className="container dashboard">
      <TopNav active="dashboard" />

      <div className="dash-header">
        <div>
          <h1>{greeting}, Velocity Tech</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>
            Here&apos;s what&apos;s happening across your clients — {todayLabel}
          </p>
        </div>
        <div className="dash-avatar">VT</div>
      </div>

      {error ? (
        <div className="card">Error loading dashboard: {error.message}</div>
      ) : (
        <>
          <div className="dash-stat-grid">
            <div className="dash-stat-card dash-stat-purple">
              <div className="dash-stat-icon">👥</div>
              <p className="dash-stat-value">{activeClients}</p>
              <p className="dash-stat-label">Active clients</p>
            </div>
            <div className="dash-stat-card dash-stat-teal">
              <div className="dash-stat-icon">✅</div>
              <p className="dash-stat-value">{totals.replied}</p>
              <p className="dash-stat-label">Auto-replied today</p>
            </div>
            <div className="dash-stat-card dash-stat-coral">
              <div className="dash-stat-icon">🚩</div>
              <p className="dash-stat-value">{totals.pending}</p>
              <p className="dash-stat-label">Awaiting review</p>
            </div>
            <div className="dash-stat-card dash-stat-amber">
              <div className="dash-stat-icon">🔌</div>
              <p className="dash-stat-value">
                {connectedCount}/{totalPossible}
              </p>
              <p className="dash-stat-label">Platforms connected</p>
            </div>
          </div>

          <h3 className="section-title">Your clients</h3>
          {allStats.length === 0 ? (
            <div className="empty-state">No clients yet. Add one from the Clients tab to get started.</div>
          ) : (
            <div className="client-grid">
              {allStats.map((stats) => (
                <ClientCard key={stats.client.id} stats={stats} />
              ))}
            </div>
          )}

          <h3 className="section-title" style={{ marginTop: 28 }}>
            Reports
          </h3>
          <div className="platform-grid">
            {PLATFORM_ORDER.map((p) => (
              <a key={p} href={`/dashboard/${p}`} className={`platform-box platform-box-${p}`}>
                <div className="platform-box-top">
                  <span className="platform-box-icon">{PLATFORM_ICONS[p]}</span>
                  <span className="platform-box-name">{PLATFORM_LABELS[p]}</span>
                </div>
                <div className="platform-box-stats">
                  <div className="platform-box-stat">
                    <span className="platform-box-stat-value platform-box-stat-pending">
                      {platformStats[p].pending}
                    </span>
                    <span className="platform-box-stat-label">Pending</span>
                  </div>
                  <div className="platform-box-stat">
                    <span className="platform-box-stat-value platform-box-stat-replied">
                      {platformStats[p].replied}
                    </span>
                    <span className="platform-box-stat-label">Replied</span>
                  </div>
                </div>
                <div className="platform-box-footer">View clients &amp; posts →</div>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ClientCard({ stats }: { stats: ClientStats }) {
  const { client, commentsToday, autoRepliedToday, manualRepliedToday, pendingReview, posts } = stats;
  const totalReplied = autoRepliedToday + manualRepliedToday;

  const configuredPlatforms = (["instagram", "facebook", "youtube", "gbp"] as Platform[]).filter((p) => {
    if (p === "instagram") return !!client.meta_ig_account_id && !!client.meta_page_access_token;
    if (p === "facebook") return !!client.meta_page_id && !!client.meta_page_access_token;
    if (p === "youtube") return !!client.youtube_refresh_token;
    return !!client.gbp_refresh_token;
  });

  return (
    <div className="client-card">
      <div className="client-card-header">
        <div className="client-name-row">
          <h2>{client.name}</h2>
          <span className={`badge ${client.active ? "badge-positive" : "badge-spam"}`}>
            {client.active ? "Active" : "Inactive"}
          </span>
        </div>
        <div className="platform-circle-row">
          {PLATFORM_DISPLAY_ORDER.map((p) => {
            const on = configuredPlatforms.includes(p);
            return (
              <span
                key={p}
                className={`platform-circle ${on ? `platform-circle-on platform-circle-${p}` : "platform-circle-off"}`}
                title={`${PLATFORM_LABELS[p]} — ${on ? "connected" : "not connected"}`}
              >
                {PLATFORM_ICONS[p]}
              </span>
            );
          })}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-value">{commentsToday}</div>
          <div className="stat-label">Comments today</div>
        </div>
        <div className="stat-tile stat-tile-good">
          <div className="stat-value">{totalReplied}</div>
          <div className="stat-label">Replied today</div>
        </div>
        <div className="stat-tile stat-tile-warn">
          <div className="stat-value">{pendingReview}</div>
          <div className="stat-label">Pending review</div>
        </div>
      </div>

      {(autoRepliedToday > 0 || manualRepliedToday > 0) && (
        <p className="reasoning">
          {autoRepliedToday} auto-replied · {manualRepliedToday} replied via review queue
        </p>
      )}

      {posts.length > 0 ? (
        <div className="post-list">
          <div className="post-list-title">Today, by post</div>
          {posts.map((post) => (
            <div className="post-row" key={post.key}>
              <span className="post-platform-icon">{PLATFORM_ICONS[post.platform]}</span>
              <div className="post-info">
                {post.url ? (
                  <a href={post.url} target="_blank" rel="noopener noreferrer" className="post-label">
                    {post.label}
                  </a>
                ) : (
                  <span className="post-label">{post.label}</span>
                )}
              </div>
              <div className="post-counts">
                <span className="post-count-total">
                  {post.total} comment{post.total === 1 ? "" : "s"}
                </span>
                <span className="post-count-replied">{post.replied} replied</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state-small">No activity today yet.</p>
      )}
    </div>
  );
}

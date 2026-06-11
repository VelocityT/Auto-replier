import { getGoogleAccessToken } from "./google-auth";

const API_BASE = "https://www.googleapis.com/youtube/v3";

export interface YoutubeComment {
  commentId: string; // top-level comment ID (used as parentId for replies)
  text: string;
  authorName: string;
  videoId: string;
  publishedAt: string;
}

/**
 * Fetch the most recent top-level comments across the channel's videos,
 * newest first. Call this on a schedule (cron) — YouTube has no webhooks
 * for comments.
 */
export async function listRecentComments(
  channelId: string,
  refreshToken: string,
  maxResults = 20
): Promise<YoutubeComment[]> {
  const accessToken = await getGoogleAccessToken(refreshToken);

  const url = new URL(`${API_BASE}/commentThreads`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("allThreadsRelatedToChannelId", channelId);
  url.searchParams.set("order", "time");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("textFormat", "plainText");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`YouTube commentThreads.list failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();

  return (data.items ?? []).map((item: any) => {
    const snippet = item.snippet.topLevelComment.snippet;
    return {
      commentId: item.snippet.topLevelComment.id,
      text: snippet.textDisplay,
      authorName: snippet.authorDisplayName,
      videoId: snippet.videoId,
      publishedAt: snippet.publishedAt,
    } as YoutubeComment;
  });
}

/**
 * Reply to a top-level comment. YouTube only allows replies via
 * comments.insert with a parentId.
 */
export async function replyToComment(
  parentId: string,
  text: string,
  refreshToken: string
): Promise<void> {
  const accessToken = await getGoogleAccessToken(refreshToken);

  const res = await fetch(`${API_BASE}/comments?part=snippet`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      snippet: {
        parentId,
        textOriginal: text,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`YouTube comments.insert failed: ${res.status} ${await res.text()}`);
  }
}

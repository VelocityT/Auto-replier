import type { ClientConfig } from "@/lib/types";

// The shape of a client we're willing to send to the browser. Notably
// excludes every *_refresh_token / *_access_token field — those never
// leave the server. Instead each platform reports a simple "connected"
// boolean plus whatever non-secret IDs are useful to display.
export interface SafeClient {
  id: string;
  name: string;
  active: boolean;
  ai_instructions: string;
  created_at: string;
  connections: {
    youtube: { connected: boolean; channel_id: string | null };
    gbp: { connected: boolean; account_id: string | null; location_id: string | null };
    facebook: { connected: boolean; page_id: string | null };
    instagram: { connected: boolean; ig_account_id: string | null };
  };
}

export function toSafeClient(client: ClientConfig): SafeClient {
  return {
    id: client.id,
    name: client.name,
    active: client.active,
    ai_instructions: client.ai_instructions ?? "",
    created_at: client.created_at,
    connections: {
      youtube: {
        connected: !!client.youtube_refresh_token,
        channel_id: client.youtube_channel_id,
      },
      gbp: {
        connected: !!client.gbp_refresh_token,
        account_id: client.gbp_account_id,
        location_id: client.gbp_location_id,
      },
      facebook: {
        connected: !!client.meta_page_access_token,
        page_id: client.meta_page_id,
      },
      instagram: {
        connected: !!client.meta_page_access_token && !!client.meta_ig_account_id,
        ig_account_id: client.meta_ig_account_id,
      },
    },
  };
}

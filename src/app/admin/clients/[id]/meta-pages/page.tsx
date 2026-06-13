import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { ClientConfig } from "@/lib/types";
import { META_PAGES_COOKIE, type MetaPage } from "@/lib/meta";
import TopNav from "@/app/components/TopNav";

export const dynamic = "force-dynamic";

// Picker shown after a Meta OAuth connect when the admin's Facebook account
// manages more than one Page. Reads the short-lived candidate-pages cookie
// set by the callback — never stores page access tokens in the URL or in
// this page's HTML beyond what's needed to submit the selection.
export default async function MetaPagesPage({ params }: { params: { id: string } }) {
  const { data: client, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", params.id)
    .maybeSingle<ClientConfig>();

  if (error || !client) {
    notFound();
  }

  const cookieStore = cookies();
  const raw = cookieStore.get(META_PAGES_COOKIE)?.value;

  if (!raw) {
    redirect(`/admin/clients/${params.id}?error=meta_no_pages`);
  }

  let pages: MetaPage[] = [];
  try {
    const parsed = JSON.parse(raw) as { clientId: string; pages: MetaPage[] };
    if (parsed.clientId !== params.id) {
      redirect(`/admin/clients/${params.id}?error=meta_no_pages`);
    }
    pages = parsed.pages ?? [];
  } catch {
    redirect(`/admin/clients/${params.id}?error=meta_no_pages`);
  }

  if (pages.length === 0) {
    redirect(`/admin/clients/${params.id}?error=meta_no_pages`);
  }

  return (
    <div className="container admin">
      <TopNav active="clients" />
      <h1 className="admin-section-title">Choose Facebook Page</h1>
      <p style={{ marginBottom: 16, color: "var(--muted, #888)" }}>
        Client: <strong>{client.name}</strong> — pick the Page (and its linked Instagram account, if any) that
        belongs to this client.
      </p>

      <div className="admin-client-list">
        {pages.map((p) => (
          <form key={p.id} action="/api/oauth/meta/select" method="POST" className="admin-client-row">
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="pageId" value={p.id} />
            <span>
              {p.name}
              <span style={{ opacity: 0.6, fontSize: "0.85em" }}> — {p.id}</span>
            </span>
            <button type="submit" className="btn-approve admin-add-btn">
              Select
            </button>
          </form>
        ))}
      </div>

      <p style={{ marginTop: 24 }}>
        <a href={`/admin/clients/${client.id}`} className="nav-link">
          ← Back to client
        </a>
      </p>
    </div>
  );
}

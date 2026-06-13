const NAV_ITEMS = [
  { href: "/", label: "Review Queue", key: "queue" },
  { href: "/dashboard", label: "Dashboard", key: "dashboard" },
  { href: "/admin/clients", label: "Clients", key: "clients" },
] as const;

export default function TopNav({ active }: { active: "queue" | "dashboard" | "clients" }) {
  return (
    <nav className="top-nav">
      {NAV_ITEMS.map((item) => (
        <a key={item.key} href={item.href} className={`nav-link ${active === item.key ? "active" : ""}`}>
          {item.label}
        </a>
      ))}
      <a href="/api/auth/logout" className="nav-link nav-link-logout">
        Logout
      </a>
    </nav>
  );
}

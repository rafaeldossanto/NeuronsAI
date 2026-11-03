import { NavLink, Outlet } from "react-router";
import { cn } from "@/lib/utils";

const links = [
  { to: "/graphs", label: "Grafos" },
  { to: "/runs", label: "Execuções" },
];

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-8 px-6">
          <NavLink
            to="/graphs"
            className="flex items-center gap-2 text-lg font-extrabold tracking-tight"
          >
            <span aria-hidden className="size-2.5 rounded-full bg-accent" />
            NeuronsAI
          </NavLink>
          <nav aria-label="Principal" className="flex gap-1">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground",
                    isActive && "bg-muted text-foreground",
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}

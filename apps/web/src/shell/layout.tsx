import { NavLink, Outlet, useMatch } from "react-router";
import { cn } from "@/shared/utils";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/accounts/auth/session-context";
import { unwrap, useApi } from "@/shared/api";
import { AccountMenu } from "./account-menu";
import "./shell.css";

const links = [
  { to: "/graphs", label: "Meus projetos" },
  { to: "/runs", label: "Execuções" },
];

export function Layout() {
  const { account } = useSession();
  const api = useApi();
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: ({ signal }) => unwrap(api.GET("/auth/organizations", { signal })),
    enabled: !!account,
  });
  const organization = organizations.data?.items.find(
    (item) => item.id === account?.organizationId,
  );
  // The editor needs room for the canvas and the inspector.
  const wide = useMatch("/graphs/:id") !== null;
  return (
    <div className={cn("min-h-screen", wide && "modeler-layout")}>
      <a
        href="#conteudo"
        className="sr-only rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50"
      >
        Pular para o conteúdo
      </a>
      <header className="app-header border-b">
        <div className={cn("app-header-content mx-auto max-w-5xl", wide && "max-w-none")}>
          <NavLink
            to="/graphs"
            className="app-brand flex items-center gap-2 text-lg font-bold tracking-tight"
          >
            <img src="/neurons-icon.png" alt="" className="size-8 object-contain" />
            <span className="app-brand-name">NeuronsAI</span>
          </NavLink>
          <nav aria-label="Principal" className="flex items-center gap-1">
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
          <AccountMenu organizationName={organization?.name} />
        </div>
      </header>
      <main
        id="conteudo"
        tabIndex={-1}
        className={cn(
          "outline-none",
          "mx-auto max-w-5xl px-6 py-10",
          wide && "modeler-main max-w-none",
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}

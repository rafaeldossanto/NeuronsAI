import { NavLink, Outlet, useMatch } from "react-router";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Plug } from "lucide-react";
import { useWorkspace } from "@/workspace/resources";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/auth/session-context";
import { unwrap, useApi } from "@/lib/api";

const links = [
  { to: "/graphs", label: "Meus projetos" },
  { to: "/runs", label: "Execuções" },
];

export function Layout() {
  const workspace = useWorkspace();
  const { account } = useSession();
  const api = useApi();
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: () => unwrap(api.GET("/auth/organizations")),
    enabled: !!account,
  });
  const organization = organizations.data?.items.find(
    (item) => item.id === account?.organizationId,
  );
  const navigation = account
    ? [
        ...links,
        { to: "/organizations", label: "Organizações" },
        { to: "/runners", label: "Runners" },
      ]
    : links;
  // The editor needs room for the canvas and the inspector.
  const wide = useMatch("/graphs/:id") !== null;
  return (
    <div className={cn("min-h-screen", wide && "modeler-layout")}>
      <header className="border-b">
        <div
          className={cn(
            "mx-auto flex min-h-16 max-w-5xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-4",
            wide && "max-w-none",
          )}
        >
          <NavLink
            to="/graphs"
            className="flex items-center gap-2 text-lg font-extrabold tracking-tight"
          >
            <span aria-hidden className="size-2.5 rounded-full bg-accent" />
            NeuronsAI
          </NavLink>
          <nav
            aria-label="Principal"
            className="order-last flex w-full flex-wrap gap-1 sm:order-none sm:w-auto"
          >
            {navigation.map((link) => (
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
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => workspace?.openConnections()}
          >
            <Plug className="size-4" /> Conexões de IA
          </Button>
        </div>
        {organization && (
          <div className="caption-4 mx-auto max-w-5xl break-words px-6 pb-4 text-muted-foreground">
            Espaço atual: {organization.name}
          </div>
        )}
      </header>
      <main className={cn("mx-auto max-w-5xl px-6 py-10", wide && "modeler-main max-w-none")}>
        <Outlet />
      </main>
    </div>
  );
}

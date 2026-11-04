import { NavLink, Outlet, useMatch } from "react-router";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Plug } from "lucide-react";
import { useWorkspace } from "@/workspace/resources";

const links = [
  { to: "/graphs", label: "Meus projetos" },
  { to: "/runs", label: "Execuções" },
];

export function Layout() {
  const workspace = useWorkspace();
  // The editor needs room for the canvas and the inspector.
  const wide = useMatch("/graphs/:id") !== null;
  return (
    <div className={cn("min-h-screen", wide && "modeler-layout")}>
      <header className="border-b">
        <div
          className={cn(
            "mx-auto flex h-16 max-w-5xl items-center gap-8 px-6",
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
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => workspace?.openConnections()}
          >
            <Plug className="size-4" /> Conexões de IA
          </Button>
        </div>
      </header>
      <main className={cn("mx-auto max-w-5xl px-6 py-10", wide && "modeler-main max-w-none")}>
        <Outlet />
      </main>
    </div>
  );
}

import { NavLink, Outlet, useMatch, useSearchParams } from "react-router";
import { cn } from "@/shared/utils";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/accounts/auth/session-context";
import { unwrap, useApi } from "@/shared/api";
import { ProjectNavigation } from "@/graphs/project-navigation";
import { useGraph } from "@/graphs/queries";
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
  const projectId = useMatch("/graphs/:id")?.params.id;
  const [params] = useSearchParams();
  const wide = projectId !== undefined;
  const chats = wide && params.get("view") === "chats";
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
          {chats && projectId ? (
            <ChatNavigation graphId={projectId} agentId={params.get("agent") ?? undefined} />
          ) : (
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
          )}
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
          chats && "project-chat-main",
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}

function ChatNavigation({ graphId, agentId }: { graphId: string; agentId?: string | undefined }) {
  const graph = useGraph(graphId);
  return (
    <div className="project-chat-navbar">
      <h1 className="project-chat-project-name text-base font-semibold" title={graph.data?.name}>
        {graph.data?.name}
      </h1>
      <ProjectNavigation graphId={graphId} chats agentId={agentId} />
    </div>
  );
}

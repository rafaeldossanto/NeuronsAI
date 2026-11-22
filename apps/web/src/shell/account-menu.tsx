import { useEffect, useId, useRef, useState } from "react";
import { NavLink } from "react-router";
import {
  ChevronDown,
  KeyRound,
  LogOut,
  Pencil,
  Plug,
  Server,
  Settings,
  Users,
  UserRound,
} from "lucide-react";
import { useDesktopConnection } from "@/accounts/desktop-account";
import { useSession } from "@/accounts/auth/session-context";
import { useAvatar } from "@/accounts/use-avatar";
import { desktopSettings } from "@/settings/desktop-settings";
import { useWorkspace } from "@/workspace/resources";
import "./account-avatar.css";

export function AccountMenu({ organizationName }: { organizationName?: string }) {
  const session = useSession();
  const desktop = useDesktopConnection();
  const workspace = useWorkspace();
  const avatar = useAvatar(session.account?.userId);
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const label = session.account ? "Minha conta" : "Conta local";
  const error = session.error || desktop?.error;
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("nav button, nav a")?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function connections() {
    close();
    workspace?.openConnections();
  }

  return (
    <div
      className="account-menu"
      ref={root}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="account-trigger"
        aria-label="Abrir menu da conta"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="account-avatar">
          {avatar.image ? (
            <img src={avatar.image} alt="Imagem do perfil" />
          ) : (
            <UserRound aria-hidden className="size-4" />
          )}
        </span>
        <ChevronDown aria-hidden className="account-chevron size-4" />
        {error && <span className="account-error-dot" aria-label="A conta precisa de atenção" />}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label="Conta e conexões"
          className="account-panel"
        >
          <div className="account-identity">
            <button
              type="button"
              className="account-avatar account-avatar-edit"
              aria-label="Alterar imagem do perfil"
              title="Alterar imagem do perfil"
              disabled={avatar.busy}
              aria-busy={avatar.busy}
              onClick={() => avatarInput.current?.click()}
            >
              {avatar.image ? (
                <img src={avatar.image} alt="Imagem do perfil" />
              ) : (
                <UserRound aria-hidden className="size-4" />
              )}
              <span className="account-avatar-pencil" aria-hidden>
                <Pencil className="size-4" />
              </span>
            </button>
            <input
              ref={avatarInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              aria-label="Selecionar imagem do perfil"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void avatar.change(file);
              }}
            />
            <div className="min-w-0">
              <p className="title-4">{label}</p>
              <p className="caption-4 break-words text-muted-foreground">
                {organizationName ??
                  (desktop?.state?.mode === "remote" ? desktop.state.serverOrigin : "Espaço local")}
              </p>
            </div>
          </div>
          {avatar.error && (
            <p role="alert" className="caption-4 px-2 pb-3 text-destructive">
              {avatar.error}
            </p>
          )}
          <nav aria-label="Conta">
            <button
              type="button"
              className="account-item"
              onClick={connections}
              disabled={!workspace}
            >
              <Plug aria-hidden />
              Conexões de IA
            </button>
            <button
              type="button"
              className="account-item"
              onClick={connections}
              disabled={!workspace}
            >
              <KeyRound aria-hidden />
              Chaves de API
            </button>
            {desktop && (
              <button
                type="button"
                className="account-item"
                disabled={desktop.busy}
                onClick={() => {
                  close();
                  desktop.openConnection();
                }}
              >
                <Server aria-hidden />
                Conectar servidor
              </button>
            )}
            {desktop?.state?.mode === "remote" && (
              <button
                type="button"
                className="account-item"
                disabled={desktop.busy}
                onClick={desktop.openLocal}
              >
                <Server aria-hidden />
                Voltar ao local
              </button>
            )}
            {session.account && (
              <>
                <NavLink to="/organizations" className="account-item" onClick={close}>
                  <Users aria-hidden />
                  Organizações
                </NavLink>
                <NavLink to="/runners" className="account-item" onClick={close}>
                  <Server aria-hidden />
                  Runners
                </NavLink>
              </>
            )}
            {desktopSettings() && (
              <>
                <hr className="account-divider" />
                <NavLink to="/settings" className="account-item" onClick={close}>
                  <Settings aria-hidden />
                  Configurações
                </NavLink>
              </>
            )}
            {session.account && session.signOut && (
              <>
                <hr className="account-divider" />
                <button
                  type="button"
                  className="account-item"
                  disabled={session.signingOut}
                  onClick={() => void session.signOut?.()}
                >
                  <LogOut aria-hidden />
                  {session.signingOut ? "Saindo…" : "Sair da conta"}
                </button>
              </>
            )}
          </nav>
          {error && (
            <p role="alert" className="body-6 p-3 text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

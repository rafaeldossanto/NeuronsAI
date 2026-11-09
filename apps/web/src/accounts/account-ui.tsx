import { useState } from "react";
import { EmptyState } from "@/shared/states";
import { Button } from "@/shared/ui/button";
import { Select } from "@/shared/ui/select";
import { roleLabel, type OrganizationRole } from "@/accounts/auth/session-context";

export function AccountRequired() {
  return (
    <EmptyState
      title="Seu espaço local está pronto"
      hint="Organizações e runners são administrados ao acessar um servidor com conta."
    />
  );
}

export function RoleSelect({
  value,
  onChange,
  owner,
  label,
  disabled,
}: {
  value: OrganizationRole;
  onChange: (value: OrganizationRole) => void;
  owner: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as OrganizationRole)}
      disabled={disabled}
    >
      {(owner
        ? (["owner", "admin", "member", "viewer"] as const)
        : (["member", "viewer"] as const)
      ).map((role) => (
        <option key={role} value={role}>
          {roleLabel[role]}
        </option>
      ))}
    </Select>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          if (!navigator.clipboard) {
            setStatus("Selecione e copie o texto acima.");
            return;
          }
          void navigator.clipboard.writeText(value).then(
            () => setStatus("Copiado."),
            () => setStatus("Não foi possível copiar. Selecione o texto acima."),
          );
        }}
      >
        {label}
      </Button>
      <span role="status" className="caption-4 text-muted-foreground">
        {status}
      </span>
    </div>
  );
}

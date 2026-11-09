import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      if (dialog.showModal) dialog.showModal();
      else dialog.setAttribute("open", "");
    }
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="workspace-modal"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold">{title}</h2>
        <Button variant="ghost" size="sm" aria-label="Fechar painel" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      {children}
    </dialog>
  );
}

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./ui/button";

/**
 * Confirmation before a destructive action (an alert dialog on the native `<dialog>`).
 * Cancel gets the initial focus; Esc and Cancel close without confirming. The caller owns
 * `pending`/`error` and decides when to unmount it (on success).
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancelar",
  pending = false,
  confirmDisabled = false,
  tone = "destructive",
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  /** Keeps Confirm off while something the text depends on is still loading. */
  confirmDisabled?: boolean;
  /** Destructive paints Confirm red; use default for a request that deletes nothing yet. */
  tone?: "destructive" | "default";
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      if (dialog.showModal) dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    cancelRef.current?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="m-auto w-[min(420px,calc(100vw-32px))] rounded-2xl border border-border bg-card p-6 text-foreground shadow-2xl backdrop:bg-black/30 backdrop:backdrop-blur-[2px]"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <h2 id={titleId} className="text-base font-bold">
        {title}
      </h2>
      <div id={descriptionId} className="mt-2 text-sm text-muted-foreground">
        {description}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button ref={cancelRef} variant="outline" disabled={pending} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={tone === "destructive" ? "outline" : "default"}
          className={
            tone === "destructive"
              ? "border-destructive bg-destructive text-white hover:bg-destructive/90"
              : undefined
          }
          disabled={pending || confirmDisabled}
          onClick={onConfirm}
        >
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

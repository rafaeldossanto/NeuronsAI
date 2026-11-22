import { ConfirmDialog } from "@/shared/confirm-dialog";
import { useDeleteGraph, useGraph } from "@/graphs/queries";

/** What goes with the project, from the number of its latest version (versions count from 1). */
function consequences(versions: number | null | undefined, known: boolean): string {
  if (!known) return ", com as versões publicadas e o histórico de execuções, se houver";
  if (!versions) return "";
  const published =
    versions === 1 ? "1 versão publicada" : `as ${String(versions)} versões publicadas`;
  return `, com ${published} e o histórico de execuções`;
}

/**
 * Asks before deleting a project. The text says what else goes with it (its published versions and
 * run history), which comes from the project itself: the list does not carry it.
 */
export function DeleteProjectDialog({
  project,
  onClose,
}: {
  project: { id: string; name: string };
  onClose: () => void;
}) {
  const details = useGraph(project.id);
  const remove = useDeleteGraph();
  const known = details.isSuccess || details.isError;
  const effects = consequences(details.data?.latestVersion, details.isSuccess);
  return (
    <ConfirmDialog
      title="Excluir projeto?"
      description={`“${project.name}” será excluído deste computador${known ? effects : ""}. Essa ação não pode ser desfeita.`}
      confirmLabel="Excluir"
      pendingLabel="Excluindo…"
      confirmDisabled={!known}
      pending={remove.isPending}
      error={remove.isError ? remove.error.message : null}
      onCancel={onClose}
      onConfirm={() => remove.mutate(project.id, { onSuccess: onClose })}
    />
  );
}

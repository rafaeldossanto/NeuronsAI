import type { Annotation } from "@neurons/graph-schema";
import { cn } from "@/lib/utils";
import { Field, parseOptionalNumber, TextArea, TextInput } from "./fields";
import { DEFAULT_FONT_SIZE, INK, SOFT_FILL } from "./annotations";
import type { EditorAction } from "./model";

const KIND_LABELS: Record<Annotation["kind"], string> = {
  rect: "Retângulo",
  ellipse: "Elipse",
  arrow: "Seta livre",
  text: "Texto",
  note: "Nota",
  group: "Grupo",
};

const INKS = [
  { label: "Grafite", value: INK.grafite },
  { label: "Âmbar", value: INK.ambar },
  { label: "Cinza", value: INK.cinza },
];

export function AnnotationInspector({
  annotation,
  dispatch,
}: {
  annotation: Annotation;
  dispatch: (action: EditorAction) => void;
}) {
  const set = (path: (string | number)[], value: unknown) =>
    dispatch({ type: "setAnnotationField", id: annotation.id, path, value });
  const hasText = annotation.kind !== "arrow";
  const fillable = annotation.kind === "rect" || annotation.kind === "ellipse";
  const fill = annotation.style?.["fill"];
  const stroke = annotation.style?.["stroke"];
  const members = annotation.memberIds?.length ?? 0;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-extrabold uppercase tracking-wide">
        {KIND_LABELS[annotation.kind]}
      </h2>
      {hasText && (
        <Field label={annotation.kind === "group" ? "Nome do grupo" : "Texto"}>
          <TextArea
            value={annotation.text ?? ""}
            onChange={(event) => set(["text"], event.target.value)}
          />
        </Field>
      )}
      {annotation.kind === "group" && (
        <p className="text-xs text-muted-foreground">
          {members === 0
            ? "Grupo vazio."
            : `${members} ${members === 1 ? "item" : "itens"}: mover o grupo move todos.`}
        </p>
      )}
      {annotation.kind !== "group" && (
        <div role="group" aria-label="Cor do traço" className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Cor do traço
          </span>
          <div className="flex gap-2">
            {INKS.map((ink) => (
              <button
                key={ink.value}
                type="button"
                aria-label={ink.label}
                aria-pressed={stroke === ink.value}
                onClick={() => set(["style", "stroke"], ink.value)}
                className={cn(
                  "size-7 rounded-full border-2 border-transparent",
                  stroke === ink.value && "border-accent ring-2 ring-accent/60",
                )}
                style={{ backgroundColor: ink.value }}
              />
            ))}
          </div>
        </div>
      )}
      {fillable && (
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={typeof fill === "string"}
            onChange={(event) =>
              set(["style", "fill"], event.target.checked ? SOFT_FILL : undefined)
            }
          />
          Preencher
        </label>
      )}
      {hasText && annotation.kind !== "group" && (
        <Field label="Tamanho da fonte">
          <TextInput
            type="number"
            min={8}
            max={96}
            value={String(annotation.style?.["fontSize"] ?? DEFAULT_FONT_SIZE)}
            onChange={(event) => {
              const size = parseOptionalNumber(event.target.value);
              set(["style", "fontSize"], size === undefined ? undefined : size);
            }}
          />
        </Field>
      )}
    </section>
  );
}

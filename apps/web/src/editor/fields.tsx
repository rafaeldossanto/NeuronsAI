import { useState } from "react";
import type * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const controlClass =
  "w-full rounded-md border border-input bg-card px-3 text-sm placeholder:text-muted-foreground disabled:opacity-50";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {children}
      </label>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function TextInput(props: React.ComponentProps<"input">) {
  return <Input {...props} />;
}

export function TextArea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(controlClass, "min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(controlClass, "h-10", className)} {...props} />;
}

/** An optional number: empty clears the field (the key is removed from the JSON). */
export function parseOptionalNumber(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** One entry per line; blank lines are dropped. */
export const splitLines = (text: string) => text.split("\n").filter((line) => line.trim() !== "");

/** A list edited one entry per line; keeps its own text so blank lines can be typed. */
export function ListField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: readonly string[];
  onChange: (value: string[]) => void;
}) {
  const [text, setText] = useState(value.join("\n"));
  // An outside change (undo/redo) replaces the text; our own edits already match `value`.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (JSON.stringify(splitLines(text)) !== JSON.stringify(value)) setText(value.join("\n"));
  }
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      <TextArea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(splitLines(event.target.value));
        }}
      />
    </Field>
  );
}

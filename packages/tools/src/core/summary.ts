const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|cookie|credential/i;
const MAX_SUMMARY_CHARS = 300;
/** A single text of the input is cut well before the whole summary is: one long text must not hide the rest. */
const MAX_TEXT_CHARS = 100;
const MAX_ITEMS = 10;
const MAX_DEPTH = 4;

const cut = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return cut(value, MAX_TEXT_CHARS);
  if (value === null || typeof value !== "object") return value;
  if (depth > MAX_DEPTH) return "…";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => redact(item, depth + 1));
    return value.length > MAX_ITEMS ? [...items, `… +${value.length - MAX_ITEMS}`] : items;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[oculto]" : redact(item, depth + 1),
    ]),
  );
}

/**
 * Short, secret-free rendering of a tool input, safe to put in an event. It is built from what the
 * agent sent, which names a secret as `{{secret:NAME}}` and never holds its value: the placeholder
 * stays as it is, so the name shows and the value cannot. Values under keys that look like
 * credentials are hidden, texts are cut, and so is the whole summary.
 */
export function summarizeInput(input: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(redact(input)) ?? String(input);
  } catch {
    text = "[entrada não serializável]";
  }
  return cut(text, MAX_SUMMARY_CHARS);
}

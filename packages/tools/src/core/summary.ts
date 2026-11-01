const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|cookie|credential/i;
const MAX_SUMMARY_CHARS = 200;

function redact(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value === null || typeof value !== "object") return value;
  if (depth > 4) return "…";
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[oculto]" : redact(item, depth + 1),
    ]),
  );
}

/** Short, secret-free rendering of a tool input, safe to put in an event. */
export function summarizeInput(input: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(redact(input)) ?? String(input);
  } catch {
    text = "[entrada não serializável]";
  }
  return text.length <= MAX_SUMMARY_CHARS ? text : `${text.slice(0, MAX_SUMMARY_CHARS - 1)}…`;
}

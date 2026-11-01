export type LinkKind = "wikilink" | "embed" | "markdown";

export interface NoteLink {
  kind: LinkKind;
  target: string;
  alias?: string;
  section?: string;
}

const FENCED_CODE = /^(```|~~~)[\s\S]*?^\1/gm;
const INLINE_CODE = /`[^`\n]*`/g;
const WIKILINK = /(!?)\[\[([^\]\n]+?)\]\]/g;
const MARKDOWN_LINK = /(?<!!)\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g;
const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const UNESCAPED_PIPE = /(?<!\\)\|/;

function withoutCode(markdown: string): string {
  return markdown.replace(FENCED_CODE, "").replace(INLINE_CODE, "");
}

function splitSection(raw: string): { target: string; section?: string } {
  const hash = raw.indexOf("#");
  if (hash === -1) return { target: raw.trim() };
  const section = raw.slice(hash + 1).trim();
  return { target: raw.slice(0, hash).trim(), ...(section ? { section } : {}) };
}

function parseWikilink(embed: boolean, inner: string): NoteLink {
  const pipe = inner.search(UNESCAPED_PIPE);
  const reference = (pipe === -1 ? inner : inner.slice(0, pipe)).replaceAll("\\|", "|");
  const alias =
    pipe === -1
      ? ""
      : inner
          .slice(pipe + 1)
          .replaceAll("\\|", "|")
          .trim();
  return {
    kind: embed ? "embed" : "wikilink",
    ...splitSection(reference),
    ...(alias ? { alias } : {}),
  };
}

function parseMarkdownTarget(raw: string): NoteLink | undefined {
  const unwrapped = raw.startsWith("<") ? raw.slice(1, -1) : raw;
  if (EXTERNAL_SCHEME.test(unwrapped)) return undefined;
  let decoded = unwrapped;
  try {
    decoded = decodeURIComponent(unwrapped);
  } catch {
    // keep the raw target when it is not valid percent-encoding
  }
  return { kind: "markdown", ...splitSection(decoded) };
}

/** Internal links of a note: wikilinks (with alias and #section), embeds and Markdown links. */
export function extractLinks(markdown: string): NoteLink[] {
  const text = withoutCode(markdown);
  const wikilinks = [...text.matchAll(WIKILINK)].map((match) =>
    parseWikilink(match[1] === "!", match[2] ?? ""),
  );
  const markdownLinks = [...text.matchAll(MARKDOWN_LINK)].flatMap((match) => {
    const link = parseMarkdownTarget(match[1] ?? "");
    return link ? [link] : [];
  });
  return [...wikilinks, ...markdownLinks];
}

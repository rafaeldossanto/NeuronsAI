import { readdir } from "node:fs/promises";
import path from "node:path";
import { isForbiddenDir, type Vault } from "./vault.js";

export interface SearchHit {
  path: string;
  score: number;
  snippet: string;
}

const SNIPPET_RADIUS = 80;
const READ_CONCURRENCY = 16;

export function tokenize(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  ) {
    count++;
  }
  return count;
}

/** Simple relevance: file name weighs most, then body frequency (capped per term). */
export function scoreNote(relativePath: string, content: string, tokens: string[]): number {
  const name = path.posix.basename(relativePath, path.posix.extname(relativePath)).toLowerCase();
  const body = content.toLowerCase();
  const phrase = tokens.join(" ");
  let score = 0;
  if (name === phrase) score += 20;
  else if (name.includes(phrase)) score += 10;
  if (tokens.length > 1 && body.includes(phrase)) score += 3;
  for (const token of tokens) {
    if (name.includes(token)) score += 5;
    score += Math.min(countOccurrences(body, token), 5);
  }
  return score;
}

export function snippetAround(content: string, tokens: string[]): string {
  const lower = content.toLowerCase();
  const first = tokens
    .map((token) => lower.indexOf(token))
    .filter((at) => at !== -1)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (first ?? 0) - SNIPPET_RADIUS);
  const text = content
    .slice(start, start + SNIPPET_RADIUS * 2)
    .replace(/\s+/g, " ")
    .trim();
  return `${start > 0 ? "…" : ""}${text}`;
}

async function listNotes(vault: Vault, maxFiles: number): Promise<string[]> {
  const found: string[] = [];
  const pending = [vault.root];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    if (found.length >= maxFiles) break;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      // Symlinks (and junctions) are never followed while walking: no loops, no escapes.
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isForbiddenDir(entry.name)) pending.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        found.push(full);
      }
    }
  }
  return found.slice(0, maxFiles);
}

async function inBatches<T, R>(
  items: T[],
  size: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let at = 0; at < items.length; at += size) {
    results.push(...(await Promise.all(items.slice(at, at + size).map(task))));
  }
  return results;
}

export async function searchVault(
  vault: Vault,
  query: string,
  limit: number,
  maxFiles: number,
  signal: AbortSignal,
): Promise<SearchHit[]> {
  const tokens = tokenize(query);
  const files = await listNotes(vault, maxFiles);
  const hits = await inBatches(
    files,
    READ_CONCURRENCY,
    async (file): Promise<SearchHit | undefined> => {
      signal.throwIfAborted();
      const relativePath = vault.relative(file);
      // A note too large to read can still be found by its name.
      const content = await vault.readResolved(file).catch(() => "");
      const score = scoreNote(relativePath, content, tokens);
      return score > 0
        ? { path: relativePath, score, snippet: snippetAround(content, tokens) }
        : undefined;
    },
  );
  return hits
    .filter((hit): hit is SearchHit => hit !== undefined)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

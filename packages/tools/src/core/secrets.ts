/** Port: the server implements it on top of its encrypted secret store. */
export interface SecretResolver {
  resolve(name: string): Promise<string>;
}

export class SecretNotFoundError extends Error {
  constructor(readonly secretName: string) {
    super(`O segredo "${secretName}" não está cadastrado.`);
    this.name = "SecretNotFoundError";
  }
}

export class InMemorySecretResolver implements SecretResolver {
  private readonly values: Map<string, string>;

  constructor(values: Record<string, string> = {}) {
    this.values = new Map(Object.entries(values));
  }

  resolve(name: string): Promise<string> {
    const value = this.values.get(name);
    return value === undefined
      ? Promise.reject(new SecretNotFoundError(name))
      : Promise.resolve(value);
  }
}

const PLACEHOLDER = /\{\{secret:([A-Za-z0-9_.-]+)\}\}/g;

export function secretNamesIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].flatMap((match) => (match[1] ? [match[1]] : []));
}

export interface Substitution {
  text: string;
  /** Resolved values, so callers can scrub them from anything they emit. */
  values: string[];
}

/** Replaces every `{{secret:NAME}}` in `text`. `allowed` restricts which names may be used. */
export async function substituteSecrets(
  text: string,
  resolver: SecretResolver,
  allowed?: ReadonlySet<string>,
): Promise<Substitution> {
  const names = [...new Set(secretNamesIn(text))];
  const resolved = new Map<string, string>();
  for (const name of names) {
    if (allowed && !allowed.has(name)) throw new SecretNotFoundError(name);
    resolved.set(name, await resolver.resolve(name));
  }
  return {
    text: text.replace(PLACEHOLDER, (_match, name: string) => resolved.get(name) ?? ""),
    values: [...resolved.values()],
  };
}

/** Removes every known secret value from `text`. */
export function scrubSecrets(text: string, values: readonly string[]): string {
  return values
    .filter((value) => value.length > 0)
    .reduce((scrubbed, value) => scrubbed.replaceAll(value, "[segredo]"), text);
}

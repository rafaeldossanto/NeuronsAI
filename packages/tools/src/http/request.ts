import { type SecretResolver, secretNamesIn, substituteSecrets } from "../core/secrets.js";

export interface RequestTemplate {
  url: string;
  headers: Record<string, string>;
}

export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body?: string;
  /** Resolved secret values, kept only so they can be scrubbed from anything emitted. */
  secretValues: string[];
}

export class InvalidUrlError extends Error {
  constructor() {
    super("A URL da ferramenta é inválida depois de substituir os segredos.");
    this.name = "InvalidUrlError";
  }
}

/** Names the block author referenced in the URL or headers: the only ones an agent body may use. */
function configuredSecretNames(template: RequestTemplate): Set<string> {
  return new Set(
    [template.url, ...Object.values(template.headers)].flatMap((text) => secretNamesIn(text)),
  );
}

async function substituteDeep(
  value: unknown,
  resolver: SecretResolver,
  allowed: ReadonlySet<string>,
  collected: string[],
): Promise<unknown> {
  if (typeof value === "string") {
    const { text, values } = await substituteSecrets(value, resolver, allowed);
    collected.push(...values);
    return text;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => substituteDeep(item, resolver, allowed, collected)));
  }
  if (value !== null && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [
        key,
        await substituteDeep(item, resolver, allowed, collected),
      ]),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

/**
 * Resolves `{{secret:NAME}}` in URL, headers and body. URL and headers come from the block, so
 * any secret is allowed; the body comes from the agent, so it can only use secrets the block
 * already references (otherwise a prompt-injected agent could read any secret back).
 */
export async function buildRequest(
  template: RequestTemplate,
  body: unknown,
  resolver: SecretResolver,
): Promise<BuiltRequest> {
  const secretValues: string[] = [];
  const resolveText = async (text: string): Promise<string> => {
    const { text: resolved, values } = await substituteSecrets(text, resolver);
    secretValues.push(...values);
    return resolved;
  };

  const url = await resolveText(template.url);
  if (!URL.canParse(url)) throw new InvalidUrlError();
  const headers = Object.fromEntries(
    await Promise.all(
      Object.entries(template.headers).map(async ([name, value]) => [
        name,
        await resolveText(value),
      ]),
    ),
  ) as Record<string, string>;

  if (body === undefined) return { url, headers, secretValues };
  const resolvedBody = await substituteDeep(
    body,
    resolver,
    configuredSecretNames(template),
    secretValues,
  );
  if (!hasHeader(headers, "content-type")) headers["Content-Type"] = "application/json";
  return { url, headers, body: JSON.stringify(resolvedBody), secretValues };
}

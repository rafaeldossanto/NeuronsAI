import type { z } from "zod";
import { createIssue, type GraphIssue } from "./issue.js";

type ZodIssue = z.core.$ZodIssue;

const FALLBACK_MESSAGE = "Valor inválido.";

function describe(issue: ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined
        ? "Campo obrigatório ausente."
        : `Tipo de valor inválido (esperado: ${issue.expected}).`;
    case "invalid_value":
      return `Valor não permitido (opções: ${issue.values.map(String).join(", ")}).`;
    case "invalid_format":
      return issue.format === "uuid" ? "Identificador (uuid) inválido." : "Formato inválido.";
    case "too_small":
      return "Valor pequeno demais.";
    case "too_big":
      return "Valor grande demais.";
    case "invalid_union":
      return "O bloco não corresponde a nenhum tipo conhecido.";
    case "unrecognized_keys":
      return `Campos desconhecidos: ${issue.keys.join(", ")}.`;
    default:
      return FALLBACK_MESSAGE;
  }
}

function codeOf(issue: ZodIssue): string {
  const custom: unknown = issue.code === "custom" ? issue.params?.["code"] : undefined;
  return typeof custom === "string" ? custom : issue.code;
}

function messageOf(issue: ZodIssue): string {
  // Custom messages written in the schemas are already in pt-BR.
  return issue.code === "custom" || (issue.code === "invalid_format" && issue.format === "regex")
    ? issue.message
    : describe(issue);
}

export function fromZodError(error: z.ZodError): GraphIssue[] {
  return error.issues.map((issue) =>
    createIssue(codeOf(issue), messageOf(issue), { path: issue.path.map(pathSegment) }),
  );
}

function pathSegment(segment: PropertyKey): string | number {
  return typeof segment === "number" ? segment : String(segment);
}

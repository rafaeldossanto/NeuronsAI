import {
  CURRENT_SCHEMA_VERSION,
  graphDefinitionSchema,
  type GraphDefinition,
} from "./schemas/graph.js";

export type GraphMigrationErrorCode = "missing_schema_version" | "unsupported_schema_version";

export class GraphMigrationError extends Error {
  readonly code: GraphMigrationErrorCode;

  constructor(code: GraphMigrationErrorCode, message: string) {
    super(message);
    this.name = "GraphMigrationError";
    this.code = code;
  }
}

type Migration = (input: unknown) => GraphDefinition;

/** One entry per supported `schemaVersion`. To evolve the contract, add a migration and bump CURRENT_SCHEMA_VERSION. */
const migrations: Readonly<Record<number, Migration>> = {
  [CURRENT_SCHEMA_VERSION]: (input) => graphDefinitionSchema.parse(input),
};

function readSchemaVersion(input: unknown): unknown {
  return typeof input === "object" && input !== null && "schemaVersion" in input
    ? input.schemaVersion
    : undefined;
}

/** Brings a stored graph of any supported version to the current `GraphDefinition`. */
export function migrateGraph(input: unknown): GraphDefinition {
  const version = readSchemaVersion(input);
  if (version === undefined) {
    throw new GraphMigrationError("missing_schema_version", "O grafo não informa o schemaVersion.");
  }
  const migrate = typeof version === "number" ? migrations[version] : undefined;
  if (!migrate) {
    throw new GraphMigrationError(
      "unsupported_schema_version",
      `Versão de grafo não suportada: ${JSON.stringify(version)}.`,
    );
  }
  return migrate(input);
}

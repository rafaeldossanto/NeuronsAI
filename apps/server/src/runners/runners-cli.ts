import { DatabaseService } from "../database/database.service.js";
import { openDatabaseProvider } from "../database/open-database-provider.js";
import { ConfigError, loadConfig } from "../shared/config/app-config.js";
import { DrizzleRunnerRepository } from "./drizzle-runner.repository.js";
import { RunnerTokens } from "./runner-tokens.service.js";

const USAGE = `Uso: pnpm --filter @neurons/server runner:token <comando>

  create <nome>   emite o token de um runner novo (mostrado uma única vez)
  list            lista os runners, com o último momento em que se conectaram
  revoke <nome>   revoga o token: o runner é recusado e, se estiver conectado, é desconectado`;

async function main(): Promise<void> {
  const [command, name] = process.argv.slice(2);
  if (
    !command ||
    !["create", "list", "revoke"].includes(command) ||
    (command !== "list" && !name)
  ) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const config = loadConfig();
  const provider = await openDatabaseProvider(config);
  if (!provider) {
    throw new ConfigError([
      "banco não configurado: defina NEURONS_DB_URL ou NEURONS_DB_HOST/USER/NAME/PASSWORD",
    ]);
  }
  try {
    // The embedded database is migrated by the server on start; this process may be the first.
    if (provider.kind === "embedded") await provider.migrate();
    const tokens = new RunnerTokens(
      new DrizzleRunnerRepository(new DatabaseService(config.database.kind, provider)),
    );

    if (command === "create" && name) {
      const issued = await tokens.issue(name);
      console.log(
        `Runner "${issued.name}" criado. Guarde o token: ele não será mostrado de novo.\n`,
      );
      console.log(`NEURONS_RUNNER_TOKEN=${issued.token}`);
    } else if (command === "revoke" && name) {
      console.log(
        (await tokens.revoke(name))
          ? `Token do runner "${name}" revogado.`
          : `Nenhum runner ativo chamado "${name}".`,
      );
    } else {
      const runners = await tokens.list();
      if (runners.length === 0) console.log("Nenhum runner cadastrado.");
      for (const runner of runners) {
        const seen = runner.lastSeenAt ? runner.lastSeenAt.toISOString() : "nunca conectou";
        console.log(`${runner.name}\t${runner.revokedAt ? "revogado" : "ativo"}\t${seen}`);
      }
    }
  } finally {
    await provider.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { AgentRuntimeFactory } from "@neurons/agent-runtimes";
import { AGENT_RUNTIME_FACTORY } from "../../agents/agent-runtime-factory.js";
import { AppModule } from "../../app.module.js";
import { configureApp } from "../../configure-app.js";
import { DatabaseService } from "../../database/database.service.js";
import type { TestDatabase } from "../../database/testing/test-database.js";
import type { AppConfig } from "../../shared/config/app-config.js";
import { testConfig } from "../../shared/config/testing/test-config.js";
import { AccountAuth } from "../../accounts/account-auth.service.js";

export interface TestApiOptions {
  auth?: AccountAuth;
  /** Builds the agents' runtimes; without it the real ones stay (and no test should start a run). */
  runtimes?: AgentRuntimeFactory;
  config?: Partial<AppConfig>;
}

/**
 * The whole application (every module, every controller) over a throwaway database, as the server
 * runs it, with the agents' runtimes swapped for the given factory. Talk to it with `app.inject`.
 */
export async function startTestApi(
  testDb: TestDatabase,
  options: TestApiOptions = {},
): Promise<NestFastifyApplication> {
  // The suite owns the database: the app must not close it when it shuts down.
  const sharedDatabase = Object.create(testDb.database, {
    onApplicationShutdown: { value: () => Promise.resolve() },
  }) as DatabaseService;

  let builder = Test.createTestingModule({
    imports: [AppModule.register(testConfig(options.config))],
  })
    .overrideProvider(DatabaseService)
    .useValue(sharedDatabase);
  if (options.runtimes) {
    builder = builder.overrideProvider(AGENT_RUNTIME_FACTORY).useValue(options.runtimes);
  }
  if (options.auth) builder = builder.overrideProvider(AccountAuth).useValue(options.auth);

  const app = (await builder.compile()).createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  configureApp(app, options.auth?.config ?? testConfig(options.config));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

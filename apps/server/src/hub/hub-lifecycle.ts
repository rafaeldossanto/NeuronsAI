import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { Hub } from "./hub.js";
import { Supervisor } from "./supervisor.js";

/** A close step slower than this is said in the log. */
const SLOW_CLOSE_MS = 1_000;

/** Ties the Hub to the server's life: recover on boot, stop the sessions on shutdown. */
@Injectable()
export class HubLifecycle implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(HubLifecycle.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(Hub) private readonly hub: Hub,
    @Inject(Supervisor) private readonly supervisor: Supervisor,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Without a database there is nothing to recover; /health already reports it.
    if (!this.database.isConfigured) return;
    try {
      await this.supervisor.recover();
    } catch (error) {
      // An unreachable database must not keep the server from starting.
      this.logger.error(
        `Não foi possível retomar as execuções em andamento: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.hub.cancelAllAsks();
    const startedAt = Date.now();
    await this.supervisor.stopAll();
    const tookMs = Date.now() - startedAt;
    // Said when slow, so a slow quit shows who was slow (the desktop app logs its own steps too).
    if (tookMs >= SLOW_CLOSE_MS) {
      this.logger.warn(`Encerramento: parar os agentes levou ${String(tookMs)} ms.`);
    }
  }
}

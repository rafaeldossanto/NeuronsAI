import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { DrizzleSecretRepository } from "./drizzle-secret.repository.js";
import { AesGcmSecretCipher, SECRET_CIPHER, UnavailableSecretCipher } from "./secret-cipher.js";
import { SECRET_REPOSITORY } from "./secret-repository.js";
import { SecretsController } from "./secrets.controller.js";
import { SecretsService } from "./secrets.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [SecretsController],
  providers: [
    SecretsService,
    { provide: SECRET_REPOSITORY, useClass: DrizzleSecretRepository },
    {
      provide: SECRET_CIPHER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.masterKey ? new AesGcmSecretCipher(config.masterKey) : new UnavailableSecretCipher(),
    },
  ],
  exports: [SecretsService],
})
export class SecretsModule {}

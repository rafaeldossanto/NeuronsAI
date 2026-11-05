import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { DatabaseService } from "../database/database.service.js";
import { AccountsService } from "./accounts.service.js";
import { AccountSessionsService } from "./account-sessions.service.js";

/** Foundation, deliberately not imported by AppModule before T25b/c are complete. */
@Module({
  imports: [DatabaseModule],
  providers: [
    AccountsService,
    {
      provide: AccountSessionsService,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new AccountSessionsService(database),
    },
  ],
  exports: [AccountsService, AccountSessionsService],
})
export class AccountsModule {}

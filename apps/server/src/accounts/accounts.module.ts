import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { DatabaseService } from "../database/database.service.js";
import { AccountsService } from "./accounts.service.js";
import { AccountSessionsService } from "./account-sessions.service.js";
import { AccountAuth } from "./account-auth.service.js";
import { AuthController } from "./auth.controller.js";
import { RequestScopeInterceptor } from "./request-scope.interceptor.js";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { SocketAuthorization } from "./socket-authorization.js";
import { DesktopLoginService } from "./desktop-login.service.js";

/** Local remains account-free; configured servers authenticate every resource request. */
@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    AccountsService,
    AccountAuth,
    DesktopLoginService,
    SocketAuthorization,
    { provide: APP_INTERCEPTOR, useClass: RequestScopeInterceptor },
    {
      provide: AccountSessionsService,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new AccountSessionsService(database),
    },
  ],
  exports: [AccountsService, AccountSessionsService, AccountAuth, SocketAuthorization],
})
export class AccountsModule {}

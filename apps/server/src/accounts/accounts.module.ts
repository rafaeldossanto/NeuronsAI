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
import { SIGNUP_POLICY, SignupPolicy } from "./signup-policy.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import type { AppConfig } from "../shared/config/app-config.js";

/** Local remains account-free; configured servers authenticate every resource request. */
@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    {
      provide: SIGNUP_POLICY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.auth ? new SignupPolicy(config.auth.signup) : SignupPolicy.closed(),
    },
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

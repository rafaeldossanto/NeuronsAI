import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { AesGcmSecretCipher } from "../secrets/secret-cipher.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { DomainError } from "../shared/errors/domain-error.js";
import { AccountsService } from "./accounts.service.js";
import { AccountSessionsService } from "./account-sessions.service.js";
import { BrowserSession } from "./browser-session.js";
import { GoogleIdentityProvider } from "./google-identity-provider.js";
import { OidcLoginService } from "./oidc-login.service.js";

export class AccountsUnavailableError extends DomainError {
  readonly kind = "unavailable" as const;
  constructor() {
    super("accounts_unavailable", "O login ainda não está configurado neste servidor.");
  }
}

@Injectable()
export class AccountAuth {
  readonly browser?: BrowserSession;
  readonly login?: OidcLoginService;
  constructor(
    @Inject(APP_CONFIG) readonly config: AppConfig,
    @Inject(DatabaseService) database: DatabaseService,
    @Inject(AccountsService) accounts: AccountsService,
    @Inject(AccountSessionsService) readonly sessions: AccountSessionsService,
  ) {
    if (!config.auth) return;
    if (!config.masterKey) throw new AccountsUnavailableError();
    this.browser = new BrowserSession(sessions, config.auth.publicOrigin);
    this.login = new OidcLoginService(
      database,
      accounts,
      sessions,
      new GoogleIdentityProvider(config.auth.google),
      new AesGcmSecretCipher(config.masterKey),
      config.auth.google.redirectUri,
    );
  }

  require() {
    if (!this.browser || !this.login) throw new AccountsUnavailableError();
    return { browser: this.browser, login: this.login };
  }
}

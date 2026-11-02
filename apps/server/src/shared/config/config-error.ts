export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuração inválida:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

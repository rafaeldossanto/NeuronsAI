/** The `error` codes the server answers `terminal.input` with (apps/server/README.md, "Digitar no terminal"). */
const TERMINAL_MESSAGES: Record<string, string> = {
  rate_limited: "Você está digitando rápido demais. Espere um instante e tente de novo.",
  input_too_large: "Esse trecho é grande demais para enviar de uma vez.",
  run_not_running: "A execução não está mais em andamento, então o terminal não aceita texto.",
  agent_not_in_run: "Esse agente não faz parte desta execução.",
  not_a_terminal: "Este agente não tem uma tela de terminal para digitar.",
  terminal_not_ready:
    "O terminal ainda não subiu. Ele abre quando o agente recebe a primeira mensagem.",
  terminal_unavailable:
    "O terminal não está aceitando texto agora. O que você digitou foi perdido.",
};

export interface TerminalInputError {
  code: string;
  /** pt-BR text for the panel. */
  message: string;
}

/** The pt-BR explanation of a refused `terminal.input`, or null when the code is not one of its own. */
export function terminalInputError(code: string | undefined): TerminalInputError | null {
  if (!code) return null;
  const message = TERMINAL_MESSAGES[code];
  return message ? { code, message } : null;
}

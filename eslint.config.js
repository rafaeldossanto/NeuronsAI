import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/.turbo/**", "Docs/**", "spikes/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            "N�o acesse process.env diretamente: leia vari�veis s� pelo m�dulo de config (apps/server/src/shared/config), que valida e tipa os valores.",
        },
      ],
    },
  },
  {
    // Config modules are the only readers of the environment: the server's, the one of mcp-neurons
    // (a separate program, started by the agent's CLI) and the snapshot of the host's environment
    // in agent-runtimes (which hands the CLI only an allowlist of it). The tools fixtures are child
    // processes spawned by tests that must read their own env (pendente: T09 pode migrar e remover
    // esta linha).
    files: [
      "apps/server/src/shared/config/**",
      "packages/mcp-neurons/src/config.ts",
      "packages/agent-runtimes/src/platform/host-environment.ts",
      "packages/tools/test/fixtures/**",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
  prettier,
);

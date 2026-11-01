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
    // Config module is the only reader of the environment. The tools fixtures are child processes
    // spawned by tests that must read their own env (pendente: T09 pode migrar e remover esta linha).
    files: ["apps/server/src/shared/config/**", "packages/tools/test/fixtures/**"],
    rules: { "no-restricted-syntax": "off" },
  },
  prettier,
);

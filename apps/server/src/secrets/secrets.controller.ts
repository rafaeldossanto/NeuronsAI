import { Controller, Inject } from "@nestjs/common";
import { Endpoint, ValidBody, ValidParams } from "../api/endpoint.js";
import {
  type SecretParams,
  type WriteSecretBody,
  secretNamesSchema,
  secretParams,
  writeSecretBody,
} from "./secrets.contract.js";
import { SecretsService } from "./secrets.service.js";

/** Secrets can be written and listed by name. Reading a value is for the server's own tools only. */
@Controller("secrets")
export class SecretsController {
  constructor(@Inject(SecretsService) private readonly secrets: SecretsService) {}

  @Endpoint({
    method: "get",
    path: "",
    summary: "Lista os nomes dos segredos (nunca os valores).",
    response: secretNamesSchema,
  })
  async listNames() {
    return { names: await this.secrets.listNames() };
  }

  @Endpoint({
    method: "put",
    path: ":name",
    summary: "Grava ou substitui um segredo. O valor não volta em nenhuma resposta.",
    params: secretParams,
    body: writeSecretBody,
    status: 204,
    errors: [503],
  })
  async write(@ValidParams() { name }: SecretParams, @ValidBody() { value }: WriteSecretBody) {
    await this.secrets.set(name, value);
  }
}

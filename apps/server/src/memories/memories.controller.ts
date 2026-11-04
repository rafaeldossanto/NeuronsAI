import { Controller, Inject } from "@nestjs/common";
import { Endpoint, ValidBody, ValidParams } from "../api/endpoint.js";
import {
  createMemoryBody,
  memoryListSchema,
  memoryParams,
  memorySchema,
  type CreateMemory,
} from "./memories.contract.js";
import { MemoriesService } from "./memories.service.js";

@Controller("memories")
export class MemoriesController {
  constructor(@Inject(MemoriesService) private readonly memories: MemoriesService) {}

  @Endpoint({
    method: "get",
    path: "",
    summary: "Lista as memórias cadastradas.",
    response: memoryListSchema,
  })
  async list() {
    return { items: await this.memories.list() };
  }

  @Endpoint({
    method: "get",
    path: ":id",
    summary: "Detalha uma memória.",
    params: memoryParams,
    response: memorySchema,
    errors: [404],
  })
  get(@ValidParams() { id }: { id: string }) {
    return this.memories.get(id);
  }

  @Endpoint({
    method: "post",
    path: "",
    summary: "Conecta um cofre local ou cria/importa uma memória no servidor.",
    body: createMemoryBody,
    response: memorySchema,
    status: 201,
  })
  create(@ValidBody() body: CreateMemory) {
    return this.memories.create(body);
  }
}

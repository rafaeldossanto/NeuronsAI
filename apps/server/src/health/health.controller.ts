import { Controller, Get, HttpStatus, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { HealthService, type HealthReport } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.status === "degraded") void reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}

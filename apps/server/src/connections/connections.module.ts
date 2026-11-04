import { Module } from "@nestjs/common";
import { ConnectionsController, ConnectionsService } from "./connections.controller.js";

@Module({ controllers: [ConnectionsController], providers: [ConnectionsService] })
export class ConnectionsModule {}

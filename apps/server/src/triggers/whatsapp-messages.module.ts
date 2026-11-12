import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { DrizzleWhatsAppMessageRepository } from "./drizzle-whatsapp-message.repository.js";
import { WHATSAPP_MESSAGE_REPOSITORY } from "./whatsapp-messages.js";

/** The memory of WhatsApp messages, shared by the webhook (writes) and the hub's tools (reads who to answer). */
@Module({
  imports: [DatabaseModule],
  providers: [{ provide: WHATSAPP_MESSAGE_REPOSITORY, useClass: DrizzleWhatsAppMessageRepository }],
  exports: [WHATSAPP_MESSAGE_REPOSITORY],
})
export class WhatsAppMessagesModule {}

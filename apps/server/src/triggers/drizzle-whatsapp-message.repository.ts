import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { whatsappMessages } from "../database/schema/index.js";
import {
  WHATSAPP_CONTACT_MEMORY_MS,
  WHATSAPP_RESEND_MEMORY_MS,
  type WhatsAppContact,
  type WhatsAppMessageClaim,
  type WhatsAppMessageRepository,
} from "./whatsapp-messages.js";

@Injectable()
export class DrizzleWhatsAppMessageRepository implements WhatsAppMessageRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async claim(claim: WhatsAppMessageClaim): Promise<boolean> {
    const inserted = await this.database.db
      .insert(whatsappMessages)
      .values(claim)
      .onConflictDoNothing()
      .returning({ hookId: whatsappMessages.hookId });
    return inserted.length > 0;
  }

  async attachRun(hookId: string, messageId: string, runId: string): Promise<void> {
    await this.database.db
      .update(whatsappMessages)
      .set({ runId })
      .where(and(eq(whatsappMessages.hookId, hookId), eq(whatsappMessages.messageId, messageId)));
  }

  async release(hookId: string, messageId: string): Promise<void> {
    await this.database.db
      .delete(whatsappMessages)
      .where(and(eq(whatsappMessages.hookId, hookId), eq(whatsappMessages.messageId, messageId)));
  }

  async contactOfRun(runId: string): Promise<WhatsAppContact | undefined> {
    const [row] = await this.database.db
      .select({
        contact: whatsappMessages.contact,
        phoneNumberId: whatsappMessages.phoneNumberId,
        sentAt: whatsappMessages.sentAt,
      })
      .from(whatsappMessages)
      .where(eq(whatsappMessages.runId, runId))
      .limit(1);
    return row?.contact
      ? { to: row.contact, phoneNumberId: row.phoneNumberId, sentAt: row.sentAt }
      : undefined;
  }

  async purge(now: Date): Promise<void> {
    await this.database.db
      .update(whatsappMessages)
      .set({ contact: null })
      .where(
        and(
          isNotNull(whatsappMessages.contact),
          lt(whatsappMessages.receivedAt, new Date(now.getTime() - WHATSAPP_CONTACT_MEMORY_MS)),
        ),
      );
    await this.database.db
      .delete(whatsappMessages)
      .where(lt(whatsappMessages.receivedAt, new Date(now.getTime() - WHATSAPP_RESEND_MEMORY_MS)));
  }
}

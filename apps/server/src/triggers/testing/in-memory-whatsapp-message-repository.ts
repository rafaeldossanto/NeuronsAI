import {
  WHATSAPP_CONTACT_MEMORY_MS,
  WHATSAPP_RESEND_MEMORY_MS,
  type WhatsAppContact,
  type WhatsAppMessageClaim,
  type WhatsAppMessageRepository,
} from "../whatsapp-messages.js";

interface Row extends Omit<WhatsAppMessageClaim, "contact"> {
  contact: string | null;
  runId: string | null;
}

export class InMemoryWhatsAppMessageRepository implements WhatsAppMessageRepository {
  readonly rows = new Map<string, Row>();

  claim(claim: WhatsAppMessageClaim): Promise<boolean> {
    const key = `${claim.hookId}/${claim.messageId}`;
    if (this.rows.has(key)) return Promise.resolve(false);
    this.rows.set(key, { ...claim, runId: null });
    return Promise.resolve(true);
  }

  attachRun(hookId: string, messageId: string, runId: string): Promise<void> {
    const row = this.rows.get(`${hookId}/${messageId}`);
    if (row) row.runId = runId;
    return Promise.resolve();
  }

  release(hookId: string, messageId: string): Promise<void> {
    this.rows.delete(`${hookId}/${messageId}`);
    return Promise.resolve();
  }

  contactOfRun(runId: string): Promise<WhatsAppContact | undefined> {
    const row = [...this.rows.values()].find((candidate) => candidate.runId === runId);
    return Promise.resolve(
      row?.contact
        ? { to: row.contact, phoneNumberId: row.phoneNumberId, sentAt: row.sentAt }
        : undefined,
    );
  }

  purge(now: Date): Promise<void> {
    for (const [key, row] of this.rows) {
      const age = now.getTime() - row.receivedAt.getTime();
      if (age > WHATSAPP_RESEND_MEMORY_MS) this.rows.delete(key);
      else if (age > WHATSAPP_CONTACT_MEMORY_MS) row.contact = null;
    }
    return Promise.resolve();
  }
}

/** Meta resends a message for up to 7 days when it does not get a 200: the memory outlives that. */
export const WHATSAPP_RESEND_MEMORY_MS = 8 * 24 * 60 * 60 * 1000;
/** Meta resends for up to 7 days: a message dated older than this is never news. */
export const WHATSAPP_MAX_MESSAGE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The customer's number is needed only while a free-form reply is possible (24 h), plus a margin. */
export const WHATSAPP_CONTACT_MEMORY_MS = 25 * 60 * 60 * 1000;

export interface WhatsAppMessageClaim {
  hookId: string;
  /** Meta's `wamid`. */
  messageId: string;
  phoneNumberId: string;
  /** The customer's number: personal data, never logged and never shown to the agent. */
  contact: string;
  /** When the customer sent the message. */
  sentAt: Date;
  receivedAt: Date;
}

/** The customer a run answers to. */
export interface WhatsAppContact {
  to: string;
  phoneNumberId: string;
  sentAt: Date;
}

export interface WhatsAppMessageRepository {
  /**
   * Remembers the message before anything runs. False when it was already there: Meta is resending
   * it. Atomic, so two copies arriving together cannot both pass.
   */
  claim(claim: WhatsAppMessageClaim): Promise<boolean>;
  attachRun(hookId: string, messageId: string, runId: string): Promise<void>;
  /** Forgets a claim whose run could not be started, so that Meta's next attempt can try again. */
  release(hookId: string, messageId: string): Promise<void>;
  /** Who the run answers to; undefined for a run that did not come from WhatsApp or whose window is over. */
  contactOfRun(runId: string): Promise<WhatsAppContact | undefined>;
  /** Clears the numbers of old messages and forgets the messages Meta can no longer resend. */
  purge(now: Date): Promise<void>;
}

export const WHATSAPP_MESSAGE_REPOSITORY = Symbol("WHATSAPP_MESSAGE_REPOSITORY");

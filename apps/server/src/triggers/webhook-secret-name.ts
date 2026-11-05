/** The name a webhook's HMAC secret has in the secrets store, from the opaque id of its URL. */
export const webhookSecretName = (hookId: string) => `webhook.${hookId}`;

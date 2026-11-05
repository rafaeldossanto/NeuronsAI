/**
 * Trusted output of a server-side OIDC adapter after validating signature, issuer, audience,
 * expiry and nonce. Never build this object from request claims or an unverified JWT.
 */
export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  displayName: string;
  /** Present only if the adapter verified the email claim. It is not an account identifier. */
  email?: string;
}

/** No real or fake provider is registered by the foundation. Google is the first adapter (T25b). */
export interface IdentityProvider {
  authorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): URL;
  exchange(input: {
    code: string;
    codeVerifier: string;
    nonce: string;
    redirectUri: string;
  }): Promise<VerifiedIdentity>;
}

export const SESSION_COOKIE_NAME = "shopsmart_session";
export const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1_000;
const RECENT_SIGN_IN_SECONDS = 5 * 60;

export type FirebaseIdentityClaims = Readonly<{
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  authTime: number;
  signInProvider: string;
}>;

export type LocalAuthUser = Readonly<{
  id: string;
  firebaseUid: string;
  email: string;
  name: string;
  tenantId: string;
  role: "user" | "operator";
}>;

export interface FirebaseIdentityGateway {
  verifyIdToken(idToken: string): Promise<FirebaseIdentityClaims>;
  createSessionCookie(idToken: string, expiresIn: number): Promise<string>;
  verifySessionCookie(sessionCookie: string): Promise<FirebaseIdentityClaims>;
  revokeRefreshTokens(firebaseUid: string): Promise<void>;
}

export interface LocalIdentityStore {
  provision(identity: FirebaseIdentityClaims): Promise<LocalAuthUser>;
  findByFirebaseUid(firebaseUid: string): Promise<LocalAuthUser | undefined>;
}

export class AuthBoundaryError extends Error {
  constructor(
    readonly code:
      | "GOOGLE_SIGN_IN_REQUIRED"
      | "RECENT_SIGN_IN_REQUIRED"
      | "VERIFIED_EMAIL_REQUIRED",
  ) {
    super(code);
    this.name = "AuthBoundaryError";
  }
}

export class FirebaseSessionAuth {
  private readonly now: () => Date;

  constructor(
    private readonly options: Readonly<{
      gateway: FirebaseIdentityGateway;
      identityStore: LocalIdentityStore;
      now?: () => Date;
    }>,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async createSession(idToken: string) {
    const identity = await this.options.gateway.verifyIdToken(idToken);
    assertGoogleIdentity(identity);
    const ageSeconds = this.now().getTime() / 1_000 - identity.authTime;
    if (ageSeconds < 0 || ageSeconds > RECENT_SIGN_IN_SECONDS) {
      throw new AuthBoundaryError("RECENT_SIGN_IN_REQUIRED");
    }

    const user = await this.options.identityStore.provision(identity);
    const sessionCookie = await this.options.gateway.createSessionCookie(
      idToken,
      SESSION_DURATION_MS,
    );
    return { user, sessionCookie };
  }

  async getSession(cookieHeader: string | undefined) {
    const sessionCookie = readCookie(cookieHeader, SESSION_COOKIE_NAME);
    if (!sessionCookie) return null;
    try {
      const identity =
        await this.options.gateway.verifySessionCookie(sessionCookie);
      assertGoogleIdentity(identity);
      const user = await this.options.identityStore.findByFirebaseUid(
        identity.uid,
      );
      return user ? { user } : null;
    } catch {
      return null;
    }
  }

  async revokeSession(cookieHeader: string | undefined) {
    const sessionCookie = readCookie(cookieHeader, SESSION_COOKIE_NAME);
    if (!sessionCookie) return;
    try {
      const identity =
        await this.options.gateway.verifySessionCookie(sessionCookie);
      await this.options.gateway.revokeRefreshTokens(identity.uid);
    } catch {
      // Clearing an invalid local cookie is still a successful sign-out.
    }
  }
}

export type ShopSmartAuth = FirebaseSessionAuth;

export function sessionCookieHeader(
  value: string,
  options: Readonly<{ secure: boolean; clear?: boolean }>,
) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    options.clear
      ? "Max-Age=0"
      : `Max-Age=${Math.floor(SESSION_DURATION_MS / 1_000)}`,
  ];
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}

function assertGoogleIdentity(identity: FirebaseIdentityClaims) {
  if (identity.signInProvider !== "google.com") {
    throw new AuthBoundaryError("GOOGLE_SIGN_IN_REQUIRED");
  }
  if (!identity.email || !identity.emailVerified) {
    throw new AuthBoundaryError("VERIFIED_EMAIL_REQUIRED");
  }
}

function readCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return undefined;
  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

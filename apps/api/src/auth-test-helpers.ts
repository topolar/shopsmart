import {
  TypeOrmFirebaseIdentityStore,
  type createAppDataSource,
} from "@shopsmart/database";

import {
  FirebaseSessionAuth,
  type FirebaseIdentityClaims,
  type FirebaseIdentityGateway,
} from "./auth.js";

export function createSyntheticFirebaseAuth(
  dataSource: ReturnType<typeof createAppDataSource>,
) {
  const gateway = new SyntheticFirebaseGateway();
  return {
    auth: new FirebaseSessionAuth({
      gateway,
      identityStore: new TypeOrmFirebaseIdentityStore(dataSource),
    }),
    idToken(email: string) {
      return gateway.idToken(email);
    },
  };
}

class SyntheticFirebaseGateway implements FirebaseIdentityGateway {
  private readonly claimsByToken = new Map<string, FirebaseIdentityClaims>();
  private readonly claimsBySession = new Map<string, FirebaseIdentityClaims>();

  idToken(email: string) {
    const token = `synthetic-google-id-token:${email}`;
    this.claimsByToken.set(token, {
      uid: `synthetic-google:${email}`,
      email,
      emailVerified: true,
      name: "Synthetic User",
      authTime: Math.floor(Date.now() / 1_000),
      signInProvider: "google.com",
    });
    return token;
  }

  async verifyIdToken(idToken: string) {
    const claims = this.claimsByToken.get(idToken);
    if (!claims) throw new Error("INVALID_SYNTHETIC_ID_TOKEN");
    return claims;
  }

  async createSessionCookie(idToken: string) {
    const claims = await this.verifyIdToken(idToken);
    const cookie = `synthetic-firebase-session:${claims.uid}`;
    this.claimsBySession.set(cookie, claims);
    return cookie;
  }

  async verifySessionCookie(sessionCookie: string) {
    const claims = this.claimsBySession.get(sessionCookie);
    if (!claims) throw new Error("INVALID_SYNTHETIC_SESSION");
    return claims;
  }

  async revokeRefreshTokens() {}
}

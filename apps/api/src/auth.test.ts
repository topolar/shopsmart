import { describe, expect, it } from "vitest";

import {
  FirebaseSessionAuth,
  type FirebaseIdentityClaims,
  type FirebaseIdentityGateway,
  type LocalAuthUser,
  type LocalIdentityStore,
} from "./auth.js";

const googleClaims: FirebaseIdentityClaims = {
  uid: "firebase-google-user",
  email: "synthetic@example.invalid",
  emailVerified: true,
  name: "Synthetic User",
  picture: "https://images.example.invalid/synthetic-user.png",
  authTime: 1_785_664_740,
  signInProvider: "google.com",
};

const localUser: LocalAuthUser = {
  id: "018f5f70-7b5d-7a21-9f49-01b7f63a9001",
  firebaseUid: googleClaims.uid,
  email: googleClaims.email,
  name: "Synthetic User",
  tenantId: "018f5f70-7b5d-7a21-9f49-01b7f63a9002",
  role: "user",
};

describe("FirebaseSessionAuth", () => {
  it("accepts a recent Google identity and creates a server session", async () => {
    const gateway = new FakeFirebaseGateway(googleClaims);
    const store = new FakeIdentityStore(localUser);
    const auth = createAuth(gateway, store);

    const result = await auth.createSession("synthetic-id-token");

    expect(result.user).toEqual(localUser);
    expect(result.sessionCookie).toBe("synthetic-session-cookie");
    expect(store.provisioned).toEqual([googleClaims]);
    expect(gateway.sessionDurations).toEqual([5 * 24 * 60 * 60 * 1_000]);
  });

  it("rejects identities that did not use the Google provider", async () => {
    const auth = createAuth(
      new FakeFirebaseGateway({
        ...googleClaims,
        signInProvider: "password",
      }),
      new FakeIdentityStore(localUser),
    );

    await expect(
      auth.createSession("synthetic-id-token"),
    ).rejects.toMatchObject({ code: "GOOGLE_SIGN_IN_REQUIRED" });
  });

  it("rejects an old ID token instead of minting a session", async () => {
    const auth = createAuth(
      new FakeFirebaseGateway({ ...googleClaims, authTime: 1_785_664_000 }),
      new FakeIdentityStore(localUser),
    );

    await expect(
      auth.createSession("synthetic-id-token"),
    ).rejects.toMatchObject({ code: "RECENT_SIGN_IN_REQUIRED" });
  });

  it("derives the local tenant from a verified session cookie", async () => {
    const store = new FakeIdentityStore(localUser);
    const auth = createAuth(new FakeFirebaseGateway(googleClaims), store);

    await expect(
      auth.getSession(
        "unrelated=x; shopsmart_session=synthetic-session-cookie",
      ),
    ).resolves.toEqual({ user: localUser });
    expect(store.lookedUpUids).toEqual([googleClaims.uid]);
  });

  it("fails closed when the session is missing or no local identity exists", async () => {
    const store = new FakeIdentityStore(undefined);
    const auth = createAuth(new FakeFirebaseGateway(googleClaims), store);

    await expect(auth.getSession(undefined)).resolves.toBeNull();
    await expect(
      auth.getSession("shopsmart_session=synthetic-session-cookie"),
    ).resolves.toBeNull();
  });
});

function createAuth(
  gateway: FirebaseIdentityGateway,
  store: LocalIdentityStore,
) {
  return new FirebaseSessionAuth({
    gateway,
    identityStore: store,
    now: () => new Date("2026-08-02T10:00:00.000Z"),
  });
}

class FakeFirebaseGateway implements FirebaseIdentityGateway {
  readonly sessionDurations: number[] = [];

  constructor(private readonly claims: FirebaseIdentityClaims) {}

  async verifyIdToken() {
    return this.claims;
  }

  async createSessionCookie(_idToken: string, expiresIn: number) {
    this.sessionDurations.push(expiresIn);
    return "synthetic-session-cookie";
  }

  async verifySessionCookie() {
    return this.claims;
  }

  async revokeRefreshTokens() {}
}

class FakeIdentityStore implements LocalIdentityStore {
  readonly provisioned: FirebaseIdentityClaims[] = [];
  readonly lookedUpUids: string[] = [];

  constructor(private readonly user: LocalAuthUser | undefined) {}

  async provision(claims: FirebaseIdentityClaims) {
    this.provisioned.push(claims);
    if (!this.user) throw new Error("Synthetic user is unavailable.");
    return this.user;
  }

  async findByFirebaseUid(firebaseUid: string) {
    this.lookedUpUids.push(firebaseUid);
    return this.user;
  }
}

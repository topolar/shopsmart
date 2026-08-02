import type { NormalizationStore } from "@shopsmart/database";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import type { ShopSmartAuth } from "./auth.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const user = {
  id: "local-user",
  firebaseUid: "firebase-google-user",
  email: "synthetic@example.invalid",
  name: "Synthetic User",
  tenantId: "018f5f70-7b5d-7a21-9f49-01b7f63a9002",
  role: "user" as const,
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Firebase auth HTTP boundary", () => {
  it("exchanges a token only from the trusted origin and sets an HTTP-only cookie", async () => {
    const app = await authApp(fakeAuth());

    const rejected = await app.inject({
      method: "POST",
      url: "/api/auth/session",
      headers: { origin: "https://attacker.example.invalid" },
      payload: { idToken: "synthetic-id-token" },
    });
    expect(rejected.statusCode).toBe(403);

    const accepted = await app.inject({
      method: "POST",
      url: "/api/auth/session",
      headers: { origin: "http://localhost:3000" },
      payload: { idToken: "synthetic-id-token" },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toEqual({ user });
    expect(accepted.headers["set-cookie"]).toContain(
      "shopsmart_session=synthetic-session-cookie",
    );
    expect(accepted.headers["set-cookie"]).toContain("HttpOnly");
    expect(accepted.headers["set-cookie"]).toContain("SameSite=Lax");
  });

  it("returns the server-derived session and clears it on sign-out", async () => {
    let revokedCookie: string | undefined;
    const app = await authApp(
      fakeAuth({
        revokeSession: async (cookie) => {
          revokedCookie = cookie;
        },
      }),
    );

    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: "shopsmart_session=synthetic-session-cookie" },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ user });

    const signOut = await app.inject({
      method: "DELETE",
      url: "/api/auth/session",
      headers: {
        cookie: "shopsmart_session=synthetic-session-cookie",
        origin: "http://localhost:3000",
      },
    });
    expect(signOut.statusCode).toBe(204);
    expect(revokedCookie).toBe("shopsmart_session=synthetic-session-cookie");
    expect(signOut.headers["set-cookie"]).toContain("Max-Age=0");
  });

  it("rate-limits repeated session exchanges", async () => {
    const app = await authApp(fakeAuth());

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await exchange(app);
      expect(response.statusCode).toBe(200);
    }

    const limited = await exchange(app);
    expect(limited.statusCode).toBe(429);
  });
});

async function authApp(auth: ShopSmartAuth) {
  const app = await buildApp(unusedNormalizationStore, {
    auth,
    publicUrl: "http://localhost:3000",
    onboardingStore: {} as never,
  });
  apps.push(app);
  return app;
}

function fakeAuth(overrides: Partial<ShopSmartAuth> = {}) {
  return {
    createSession: async () => ({
      user,
      sessionCookie: "synthetic-session-cookie",
    }),
    getSession: async () => ({ user }),
    revokeSession: async () => undefined,
    ...overrides,
  } as unknown as ShopSmartAuth;
}

const unusedNormalizationStore: NormalizationStore = {
  save: async () => {
    throw new Error("Normalization is not used by this test.");
  },
};

function exchange(app: Awaited<ReturnType<typeof buildApp>>) {
  return app.inject({
    method: "POST",
    url: "/api/auth/session",
    headers: { origin: "http://localhost:3000" },
    payload: { idToken: "synthetic-id-token" },
  });
}

import {
  applicationDefault,
  getApp,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";

import type {
  FirebaseIdentityClaims,
  FirebaseIdentityGateway,
} from "./auth.js";

export function createFirebaseAdminGateway(
  projectId: string,
): FirebaseIdentityGateway {
  const appName = `shopsmart-${projectId}`;
  const app = getApps().some((candidate) => candidate.name === appName)
    ? getApp(appName)
    : initializeApp({ credential: applicationDefault(), projectId }, appName);
  const auth = getAuth(app);

  return {
    async verifyIdToken(idToken) {
      return toIdentity(await auth.verifyIdToken(idToken, true));
    },
    createSessionCookie(idToken, expiresIn) {
      return auth.createSessionCookie(idToken, { expiresIn });
    },
    async verifySessionCookie(sessionCookie) {
      return toIdentity(await auth.verifySessionCookie(sessionCookie, true));
    },
    async revokeRefreshTokens(firebaseUid) {
      await auth.revokeRefreshTokens(firebaseUid);
    },
  };
}

function toIdentity(token: DecodedIdToken): FirebaseIdentityClaims {
  return {
    uid: token.uid,
    email: token.email ?? "",
    emailVerified: token.email_verified === true,
    ...(token.name ? { name: token.name } : {}),
    ...(token.picture ? { picture: token.picture } : {}),
    authTime: token.auth_time,
    signInProvider: token.firebase.sign_in_provider,
  };
}

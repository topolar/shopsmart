# ADR 0007: Google-only Firebase Authentication with local tenant mapping

- Status: accepted
- Date: 2026-08-02
- Supersedes: [ADR 0002](0002-authentication-and-sessions.md)
- Scope: browser sign-in, server sessions, local identity provisioning, and tenant authorization

## Decision

ShopSmart uses Firebase Authentication with Google as its only application sign-in provider. The Next.js client uses the modular Firebase Web SDK with in-memory persistence, opens the Google provider flow, obtains a short-lived Firebase ID token, and sends it once to the same-origin Fastify session endpoint. Email/password registration, password login, anonymous auth, and additional providers are disabled.

Fastify verifies the ID token through the Firebase Admin SDK, requires a verified e-mail, requires `firebase.sign_in_provider` to equal `google.com`, and accepts the exchange only within five minutes of `auth_time`. It then creates a five-day Firebase session cookie with `HttpOnly`, `SameSite=Lax`, host-only scope, and `Secure` whenever the public URL is HTTPS. The browser clears its temporary Firebase client state after the exchange.

Firebase owns external identity only. PostgreSQL remains authoritative for the local user ID, tenant ID, role, onboarding, watch rules, locations, memberships, notification settings, and all authorization. A reviewed TypeORM migration adds a unique nullable `firebaseUid` to the existing local user row. First verified login creates or links one local user and one personal tenant transactionally; repeated login is idempotent. Protected routes compare the requested tenant with the tenant loaded server-side from the verified Firebase UID and never trust a UID, role, or tenant supplied by the browser.

References:

- [Firebase Google sign-in for web](https://firebase.google.com/docs/auth/web/google-signin)
- [Firebase session cookies](https://firebase.google.com/docs/auth/admin/manage-cookies)
- [Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Firebase Admin SDK setup](https://firebase.google.com/docs/admin/setup)
- [Firebase CLI auth provider configuration](https://firebase.google.com/docs/auth/configure-providers-cli)

## Security contract

- Session creation and deletion require an exact configured public `Origin`; missing or foreign origins fail closed.
- Session exchange is rate-limited independently from the rest of the API; production edge limits remain an additional gate.
- Only a recent, non-revoked Firebase token from the Google provider with a verified e-mail can create a session.
- Session cookies are verified by Firebase Admin before every protected operation; cookie presence alone is never authorization.
- Sign-out clears the host cookie and revokes Firebase refresh tokens for the verified UID.
- Firebase Web App config is supplied through environment variables. Service-account JSON stays outside the repository and is referenced through `GOOGLE_APPLICATION_CREDENTIALS`.
- Local users are keyed to a unique Firebase UID. Tenant and operator role remain server-owned PostgreSQL fields.
- The committed Firebase auth template contains only synthetic placeholders. The real support e-mail stays in ignored local configuration.
- A Cloudflare hostname must be added to Firebase authorized domains and to `SHOPSMART_PUBLIC_URL` before use; only HTTPS receives a `Secure` session cookie.

## Migration and rollback

The old Better Auth runtime dependency and email/password UI are removed. Its legacy `session`, `account`, and `verification` tables are retained temporarily so the schema migration is reversible and no historic row is silently destroyed. They are no longer read or written. A later cleanup migration may remove them after the Firebase cutover is proven and any needed data migration is explicitly reviewed.

An existing local user with the same verified Google e-mail and no Firebase UID is linked in the provisioning transaction. A conflicting existing Firebase UID fails closed. New users receive a generated local user ID and tenant ID; Firebase UID is not reused as an application primary key.

## Rejected alternatives

- Keeping Better Auth email/password alongside Google would preserve account-creation paths the product does not want and create ambiguous identity linking.
- Storing user settings in Firestore would split the existing transactional and tenant authorization model without product value.
- Trusting a client-supplied Firebase UID or tenant ID would allow tenant-scope escalation.
- Persisting long-lived Firebase client credentials in browser storage is unnecessary because the application uses a server session cookie.

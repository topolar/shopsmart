# ADR 0002: Better Auth with database-backed sessions

- Status: accepted for the local MVP baseline
- Date: 2026-08-01
- Scope: registration, email/password sign-in, session validation, and tenant authorization

## Decision

ShopSmart uses Better Auth 1.6.25 for the authentication boundary. The Fastify API mounts the official Fetch-compatible handler and validates every protected operation with `auth.api.getSession`; a cookie-presence check is never an authorization decision. The public Next.js application proxies same-origin auth and onboarding requests to the private API.

Better Auth uses its official PostgreSQL adapter through `pg`. All auth and application schema changes are nevertheless represented by reviewed TypeORM migrations, with `synchronize: false`; Better Auth CLI migrations are not run ad hoc in persistent environments. Application persistence and tenant-scoped business operations remain TypeORM-based.

References:

- [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)
- [Better Auth Fastify integration](https://better-auth.com/docs/integrations/fastify)
- [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next)
- [Better Auth security model](https://better-auth.com/docs/reference/security)
- [Better Auth core database schema](https://better-auth.com/docs/concepts/database)

## Security contract

- Auth cookies are host-only, HTTP-only and `SameSite=Lax`; HTTPS production will use secure cookies.
- State-changing browser requests remain subject to Better Auth origin and CSRF validation. These checks must not be disabled.
- Only the configured public application origin is trusted. Localhost must not remain in a production allowlist.
- Passwords are handled by Better Auth and only their hashes are stored in the auth account table.
- Better Auth's default diagnostic logger is disabled because database errors may contain account fields; API responses expose bounded error codes and never log request bodies, credentials or locality fields.
- Sessions are validated against PostgreSQL for every protected API operation.
- Tenant identity comes from the validated session's server-owned `tenantId`, never from a client claim.
- Built-in auth rate limiting is enabled. A production deployment behind Cloudflare must trust only a proxy-overwritten IP header such as `CF-Connecting-IP`, never arbitrary client-supplied forwarding headers.
- E-mail verification, password recovery delivery, secure-cookie enforcement, secret rotation and production abuse controls are release gates before public beta; the local MVP does not send e-mail.

## Privacy and onboarding

The auth store contains the login e-mail and display name. Onboarding stores only city, region and an optional three-digit postal prefix; it has no street or full-address field. Store selections use public store IDs, loyalty selections contain program keys rather than account numbers, and sensitive request bodies are not logged.

## Rejected alternatives

- A custom password/session implementation would duplicate security-sensitive code without product value.
- Cookie-presence-only authorization is explicitly insecure and is used neither in the API nor in protected BFF operations.
- Better Auth's own imperative migration command is not the project schema authority because the repository requires reviewed, reversible TypeORM migrations.
- Social login is deferred until a concrete user need and provider/privacy review exist.

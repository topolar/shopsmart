# Firebase Google authentication

ShopSmart uses Firebase only for Google identity. Per-user settings and tenant authorization stay in PostgreSQL. The repository's configured development project is `shopsmart-cz-topolar`; `.firebaserc` contains only this public project ID.

## One-time Firebase setup

Use the current CLI without a global installation:

```powershell
pnpm dlx firebase-tools login
pnpm dlx firebase-tools projects:list
pnpm dlx firebase-tools apps:list WEB --project shopsmart-cz-topolar
pnpm dlx firebase-tools apps:sdkconfig WEB --project shopsmart-cz-topolar
```

Copy `firebase.json.example` to the ignored `firebase.json`, replace the synthetic support e-mail with an address owned by the Firebase project, and keep only Google Sign-In enabled. Firebase currently accepts local authorization as `http://127.0.0.1` without a port. Apply the provider configuration with:

```powershell
pnpm dlx firebase-tools deploy --only auth --project shopsmart-cz-topolar
```

The committed example intentionally contains no personal e-mail. The actual `firebase.json`, Firebase debug log, `.env`, Web App config, and service-account credentials must remain untracked.

## Local Admin credential

Firebase session cookies can only be created by an authorized service account. In Firebase Console open **Project settings → Service accounts → Firebase Admin SDK**, generate one development private key, and store the downloaded JSON outside the repository. Set its absolute path only in the ignored `.env`:

```dotenv
FIREBASE_PROJECT_ID=shopsmart-cz-topolar
GOOGLE_APPLICATION_CREDENTIALS=C:\path\outside\shopsmart\firebase-admin-service-account.json
```

If a key is ever committed, logged, or shared, revoke it immediately in Google Cloud IAM and generate a replacement. Production hosting should use the platform's workload identity or managed service account instead of a downloaded key.

## Web App environment

Copy the values returned by `apps:sdkconfig` into the ignored `.env`. Although Firebase Web API keys are client configuration rather than server secrets, ShopSmart's public-repository policy keeps all project-specific keys out of commits.

```dotenv
NEXT_PUBLIC_FIREBASE_PROJECT_ID=replace-with-project-id
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=replace-with-project-id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_APP_ID=replace-with-web-app-id
NEXT_PUBLIC_FIREBASE_API_KEY=replace-with-web-api-key
```

Run the migration and restart both processes after changing environment values:

```powershell
pnpm db:migrate
pnpm dev:api
pnpm dev:web
```

Open `http://127.0.0.1:3310` and use **Přihlásit přes Google**. A successful exchange sets `shopsmart_session`; no password or Firebase token is persisted by the application UI.

## Cloudflare Tunnel later

Before exposing the local web through Cloudflare Tunnel:

1. add the exact HTTPS hostname to `authorizedRedirectUris` in the ignored `firebase.json` and deploy `--only auth`;
2. set `SHOPSMART_PUBLIC_URL=https://your-hostname.example` and restart the API;
3. keep the Fastify API private and tunnel only the Next.js origin unless a separate API hostname is deliberately configured;
4. verify the session cookie has `Secure`, `HttpOnly`, and `SameSite=Lax`.

Do not add wildcard or temporary tunnel domains to a production allowlist. When the final hosting domain changes, update the Firebase authorized domain and `SHOPSMART_PUBLIC_URL` together.

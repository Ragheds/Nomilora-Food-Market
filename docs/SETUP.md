# Private setup

## Supabase Auth — Free only

The Nomilora project `xxzpgwlhfwqjmrhkzbok` exists in the Free organization. Public Auth settings responded HTTP 200 on November 16, 2026; email sign-in is enabled, anonymous sign-in is disabled and email confirmation is required. The dashboard has authenticator TOTP enabled. Local callbacks were saved for `http://localhost:15173/account` and `http://localhost:5173/account`; the local Site URL is port 15173. A 12-character minimum was saved in the email provider settings. No secret/service-role key is needed by this app.

1. Put the Project URL and **publishable** key in the server and `VITE_` variables in `.env.example`. The local ignored `.env` already contains this public configuration. Restart Vite/API after changing values. Configure Replit Secrets separately if running there.
2. Use the same browser host throughout sign-in/recovery. Add only exact authorized private-preview `/account` callbacks if required; avoid broad wildcards. Do not publicly deploy to test this.
3. The default Supabase sender is restricted and rate-limited. Verify founder/team email before testing registration. Arbitrary customer email delivery needs a configured sender/custom SMTP and verified domain; no paid sender was provisioned. Never disable email confirmation to hide a mail problem.
4. Register through `/account`, follow the verification email, sign in, reload and confirm the session persists; sign out; request recovery and set a new password yourself. Test expired links, second-account isolation and sign-out across tabs. The agent must hand off new-password entry to the user.
5. For staff, enroll an authenticator in Account, save recovery arrangements privately, and verify a code after login. The backend rejects staff operations without Supabase AAL2. The free TOTP feature is used; paid SMS MFA was not enabled.

Passwords go to Supabase, never the Express API, application database, source control or chat. Do not send database URLs, service keys, passwords or Stripe secrets in chat.

## Existing application PostgreSQL

On November 16 a read-only query in the existing Replit shell confirmed eight public account tables and no Drizzle migration-journal table: `app_users`, `customer_addresses`, `customer_preferences`, `customer_profiles`, `saved_meals`, `shopping_cart_items`, `shopping_carts`, `user_roles`. The subsequent read-only full comparison matched migration 0000 exactly, including columns/constraints/indexes/enum labels/row security/triggers; all eight tables were empty. A private backup was then saved, and guarded adoption of the exact empty baseline plus migrations 0001–0005 completed successfully. The database now has six migration records, 29 tables and 16 fictional meals. Original tables were preserved.

For a **new disposable empty database**, set `DATABASE_URL`, run `pnpm --filter @workspace/db migrate`, then `NOMILORA_SEED_TEST_DATA=yes pnpm seed:test`. Migrations 0000–0005 create the account and operations tables. The seed creates a fictional test kitchen, illustrative meals and one test window tomorrow; it does not list Olia Greens, reset used stock or create an administrator.

For the existing Replit database: run `pnpm db:inspect` for a read-only exact schema comparison against migration 0000 (columns, enum labels, constraints, indexes, row-security flags and triggers). It writes no migration records. A mismatch means stop for review. Keep its connection string server-side; export a restorable backup privately first. Inspect columns, enum labels, indexes, constraints and any migration journal against migration 0000. Establish a baseline only after exact comparison, then run subsequent migrations. Never use `push-force`, drop existing tables or insert a guessed migration record. Keep backups outside Git and test restore on a disposable database. The initial hosted migration is complete. Future migrations still require a current backup and review; do not rerun the empty-baseline adoption after a journal exists.

## First founder and staff

After the chosen founder verifies email and signs in once, independently confirm their exact Supabase subject UUID. Set `NOMILORA_FOUNDER_SUBJECT` privately, then run:

```sh
CONFIRM_FOUNDER_SETUP=yes pnpm bootstrap:founder
```

This refuses a missing/disabled/unverified local identity or an existing different founder. It records an audit event. Sign in with MFA to use `/workspace`; grant staff roles and kitchen memberships there. Roles are never accepted from signup metadata. Operations admins manage operations; founder role assignment remains founder-only. Do not grant roles merely from an unauthenticated email request.

## Stripe test account

Add only `sk_test_…` as `STRIPE_TEST_SECRET_KEY`, the **test endpoint's** `whsec_…` as `STRIPE_TEST_WEBHOOK_SECRET`, and an exact allowed `PAYMENT_RETURN_ORIGIN`. Return origin must be HTTPS except loopback and must appear in `APP_ORIGINS`. All three are needed for checkout. `sk_live_` keys are refused.

Send test webhooks to `/api/payments/webhook` using the official Stripe CLI forwarding to local port 8080 or an explicitly authorized private endpoint. Subscribe to `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.paid`. Use the forwarding endpoint's signing secret locally. No public endpoint was created automatically.

Use Stripe test payment details only. Verify completed/expired sessions, wrong signatures, duplicate delivery, full test refunds, pause/resume/skip/cancel and invoice-to-box fulfillment. Redirect success alone never marks an order paid. The weekly $15/meal price is illustrative. Taxes, delivery fees, real payout transfers, prorations, partial refunds and production billing policy are not approved or enabled. Paid box failures remain visible for support; do not create a new charge to retry fulfillment.

## Serve a built private app

After `pnpm build`, run `PORT=8080 pnpm start`. Express serves the built frontend and API together, including SPA deep links. Missing API paths remain JSON 404 responses; missing assets are not replaced with HTML. Fingerprinted assets are immutable, while the HTML and service worker revalidate. Point your browser to localhost:8080 and add its exact `/account` callback before testing auth there. This starts a server; it does not deploy or publish anything.

For the existing Replit shell, its package-manager shim may be broken even when the workspace opens. If the old workspace contains its own broken pnpm binary, run the installer outside that directory: `cd /tmp && CI=true npx --yes --package=pnpm@11.25.0 pnpm --dir /home/runner/workspace install --frozen-lockfile`. This uses the pinned version and avoids an interactive module-replacement prompt. The original workspace is preserved; the review checkout is in `/tmp/nomilora-review-ba4c0b4`.

The Replit Run command builds and starts both existing artifact services: API on 8080 and the customer web service on the port declared in `artifacts/nomilora/.replit-artifact/artifact.toml` (18352). Replit’s artifact router routes `/api` to the former and `/` to the latter; starting only the API makes the root preview return 502 even though internal API checks succeed. The launcher shuts down both services together. Keep **Private preview** enabled so only authenticated project editors can access it. This is a temporary development preview, not a public deployment; it sleeps when the workspace stops. Run does not migrate data, seed records or grant roles.

## Private Stripe webhook forwarding

The pinned official Stripe CLI is a development dependency. To receive signed test events without making the Replit preview public, put the approved sandbox `STRIPE_TEST_SECRET_KEY` in Replit Secrets, set `PAYMENT_RETURN_ORIGIN` to the exact private-preview origin already present in `APP_ORIGINS`, and set `NOMILORA_STRIPE_TEST_FORWARD=yes`. Start the app using its Run command. The launcher connects directly to Stripe, filters the eight required events from the sandbox account itself, and forwards only to loopback `/api/payments/webhook`. It passes the signing secret directly to the API process in memory; no credential is printed, embedded in frontend code or committed. Live keys are rejected before starting the CLI.

If the forwarding process cannot connect or stops, the supervisor stops both app services rather than presenting a working payment intake with no listener. Replit sleeps when inactive; this forwarding setup is for development acceptance, not production webhook hosting. For a real launch, prepare an explicitly approved durable endpoint and operations plan. Do not disable private-preview access to make webhook delivery work.

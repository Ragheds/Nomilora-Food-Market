# Free development setup

## Supabase Auth

1. Sign in at https://supabase.com/dashboard. Create a project in an organization explicitly on the **Free** plan. Do not upgrade or enable paid add-ons. Choose a strong database password yourself and store it privately; Nomilora does not need this password because application data stays in Replit PostgreSQL.
2. In the project's connection/API settings, find its **Project URL** and **publishable key**. Populate `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` on the server, and matching `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the web build. These must point to the same project. No secret/service-role key is needed. Never put private keys in a `VITE_` variable.
3. Under Authentication, enable email/password and keep **Confirm email** on. Set a password minimum of 12 characters. Keep Supabase's rate limits enabled. Do not enable anonymous sign-in for the customer flow.
4. In Authentication URL configuration, set the local Site URL to `http://localhost:5173` and add the exact redirect `http://localhost:5173/account`. If testing with `127.0.0.1`, add `http://127.0.0.1:5173/account` too. Use the same host consistently. For an authorized private Replit preview, add that exact preview URL plus `/account`; do not allow broad wildcard destinations or deploy publicly for this step.
5. Restart the frontend after setting public config, and restart the API after setting server config. In Replit, use Secrets for the server variables; Vite public variables are still deliberately public build configuration.
6. Test registration → confirmation link → sign in → edit profile/preferences/cart/favorites/address → reload → sign out → sign in again. Use the same browser for PKCE confirmation/recovery links. Check that a second account sees none of the first account's saved data. Test password recovery and resend verification, including invalid/expired links.

### Email limitation

Supabase's default email sender is for restricted testing: it only sends to project-team email addresses, with low project-wide rate limits. It is not a customer email service. Start with the project owner's test email. General customer registration and reliable recovery require a separately configured SMTP sender, its verified sender/domain, and any applicable free-plan limits to be reviewed. Do not purchase a sender, upgrade Supabase, or disable email verification to work around this limitation.

Sources: https://supabase.com/docs/guides/auth/auth-smtp and https://supabase.com/docs/guides/auth/passwords . The implementation uses Supabase's official client and verifies tokens with Auth's `/user` endpoint, corresponding to https://supabase.com/docs/reference/javascript/auth-getuser . Auth requests are not application-role authority.

## Existing application PostgreSQL

Keep the Replit `DATABASE_URL` server-side. This development checkpoint has not retrieved or altered the hosted database. A migration script now exists, but do not blindly replay a create-table migration against an existing schema previously created by `drizzle-kit push`.

For a new disposable database, set `DATABASE_URL` securely and run `pnpm --filter @workspace/db migrate`. For the current Replit database, first take a backup/checkpoint, inspect whether the tables and Drizzle migration journal already exist, compare the live schema with `lib/db/migrations/0000_tidy_edwin_jarvis.sql`, and establish a reviewed baseline if the tables were pushed without a migration journal. Do not use `push-force`, drop tables, or insert a guessed migration record. The migration is tested on a fresh embedded PostgreSQL database and verified to be idempotent through Drizzle's migration journal; hosted database baseline verification remains required.

Never copy `.env`, Supabase service-role keys, database URLs, customer exports, or private credentials into GitHub. `.env` files are excluded by `.gitignore`.

## Roles

The first verified sign-in creates a local `app_users` identity, profile, preferences, basket, and only the `customer` role. Higher roles are not self-service. Existing enum roles cover customer, restaurant employee/manager, support agent, operations admin, and founder admin. Only a trusted database administrator may grant a role after independently verifying the Supabase subject; record the grantor in `granted_by_user_id`. Do not grant roles by a supplied email in an unauthenticated endpoint. No role-grant endpoint or demo admin password exists.

The `/api/account/access/admin`, `/support`, and `/partner` gates test role access only. They are not operational dashboards. Kitchen assignment and partner-to-partner isolation must be implemented before partner operations are built.

## Private hosting preparation — no deployment performed

Build with the public auth variables, then serve `artifacts/nomilora/dist/public` as static assets with SPA fallback for UI routes and route `/api` to the Express process. Run `artifacts/api-server/dist/index.mjs` with `PORT`, `DATABASE_URL`, Supabase public config, and exact `APP_ORIGINS` set server-side. Do not send `/api` to the SPA fallback. Keep the API process and its generated logging worker files together. Enforce HTTPS and suitable CSP/security headers at the web server.

The API currently trusts no forwarded IP headers. Configure a verified reverse-proxy trust boundary and a shared rate-limit store before multi-instance hosting; do not set `trust proxy` indiscriminately. Use private deployment access controls if later authorized. GitHub source synchronization does not publish the customer service.

Before launch: finish actual order and payment workflows; verify inventory/capacity transactions, signed test webhooks and idempotency, subscription terms and cancellation; secure partner/support/admin data access; obtain operating approvals and qualified policy review; complete accessibility, device/browser, session/XSS, backup/restore and incident-response reviews. Live payment, delivery, restaurant listing, and public deployment require separate explicit approval.

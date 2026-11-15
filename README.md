# Nomilora Food Market

Existing React/TypeScript/Vite/Tailwind + Express application, continued from Replit checkpoint `69fc1a3`. Exact supplied logo files and the approved visual direction are preserved. This is a development checkpoint, not a launched food service.

## Run locally

Use Node 24 (minimum 22.18) and pnpm 11.25.0. The workspace supports macOS and Linux; it no longer excludes native macOS build dependencies.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev:api
```

In another terminal:

```sh
pnpm dev:web
```

Open http://localhost:5173. Vite forwards `/api` to localhost:8080. Only the API uses `DATABASE_URL`. Vite loads public `VITE_` configuration from the root `.env`; restart Vite after configuring it. Without Supabase configuration, the account page explicitly says accounts are not configured; guest browsing and local preview baskets still work. Authenticated account requests require both Supabase and PostgreSQL.

## What this checkpoint adds

- Official Supabase browser client for registration, sign-in/out, email confirmation/resend, password recovery, and persistent/refreshing sessions. Passwords go to Supabase, never the Express API or the application database.
- Express validates each bearer token with the configured Supabase Auth server. Unconfirmed/anonymous users cannot access account data. Application roles come from PostgreSQL on every request, never client claims or editable metadata.
- Database-backed profiles, preferences, meal-type preferences, favorites, carts, and address CRUD. Ownership is enforced on all operations. Basket replacement and default-address changes use database transactions and per-user locks.
- Separate guest/account state; account switching remounts the account state. Account changes save in sequence, failures remain visible with an explicit retry, and queued changes are discarded on sign-out. Browser guest data is not automatically imported into a signed-in account. Guest simulation history remains browser-local.
- Exact-origin CORS, account rate limits, bounded/validated JSON, private-response no-store headers, generic server errors, and sanitized logs.
- Versioned migrations, regenerated OpenAPI/Zod/client contracts, local database integration tests, and a portable build command.
- Strict diet filters in Explore now exclude unverified labels. Strict allergies return no recommendations while all catalog declarations are unverified. Preferred meal types filter recommendations.

## Setup and verification

Read [setup](docs/SETUP.md) before configuring authentication or applying migrations to an existing database. Read [checkpoint status](docs/CHECKPOINT.md) for test evidence and remaining work.

```sh
pnpm build
pnpm test
# With the API running:
pnpm --filter @workspace/nomilora test:api
# Regenerate OpenAPI clients and validators after contract edits:
pnpm --filter @workspace/api-spec codegen
# New/empty database only, after setting DATABASE_URL:
pnpm --filter @workspace/db migrate
```

`pnpm test` uses an isolated embedded PostgreSQL engine (PGlite) and a local Express server, not a hosted database or a billable external service. Supabase verification is mocked only inside tests. No production authentication bypass exists. The archived `artifacts/mockup-sandbox` remains available but is excluded from the production build.

## Inactive business systems

Checkout remains the existing zero-charge simulation and creates no real order. Stripe payments/subscriptions/refunds, persistent order records, partner approvals/portals, support messaging, delivery operations, admin operational dashboards, and notifications are subsequent milestones. The catalog is still 16 illustrative server-side fixtures, not an approved restaurant menu or a database-managed catalog. No Olia Greens public listing is present. Legal, allergen, nutrition, image rights, kitchen agreements, insurance, tax, and operational reviews remain open. PWA installation/device/offline testing is not a full sign-off.

No public deployment, live payment, real delivery, paid service, or production database mutation is authorized by this checkpoint. Configure and test the account workflow before advancing to durable orders and Stripe test mode.

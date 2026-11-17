# Nomilora Food Market

Existing React/TypeScript/Vite/Tailwind + Express + OpenAPI/Zod + PostgreSQL application, continued from Replit source checkpoint `69fc1a3`. The original six logo assets and green/ivory design are preserved. This repository is a **test-only product**, not a launched food service.

## Working software

- Official Supabase Auth registration, login/logout, verification/resend, password recovery, persistent sessions and authenticator MFA. Express verifies tokens with Supabase; PostgreSQL owns roles and account access. Staff operations require MFA.
- Owned profiles, saved dietary restrictions, favorites, carts and addresses. Verified allergen/diet/cross-contact filtering is consistent across browsing, recommendations and checkout; unverified declarations fail closed for strict restrictions.
- Database catalog, immutable order/food/price snapshots, atomic inventory and slot reservations, idempotent checkout, order history and scoped kitchen preparation/state transitions. Guest checkout remains a no-charge browser simulation; signed-in test checkout saves actual test records.
- Stripe **test-only** hosted checkout, verified raw signed webhooks, refunds and weekly plans. Plan billing supports pause, resume, skip and cancel. Paid weekly invoices create one matching saved box/order; stock or missing-selection exceptions go to staff and can be retried without another charge.
- Customer support tickets/replies, private staff notes, assignment and status; customer notifications and staff queues poll while visible. No external email/SMS/push delivery or human staffing is implied.
- Private prospective restaurant drafts, versioned menu approval/evidence, scoped kitchen memberships, ZIP zones, capacity/cutoff windows, promotions, test partner payables and preparation exports. Real prospective partners, including Olia Greens, never enter the public test catalog.
- Founder/admin controls for roles, disabled accounts, inquiries and audit history. Initial founder bootstrap requires a verified account and explicit CLI confirmation; no demo admin password.
- Consent-based waitlist/partner inquiries; draft information/policy pages; existing PWA manifest, original icons and offline fallback. Private API data is not cached by the service worker.

## Run locally

Node 24 and pnpm 11.25.0 are used in CI. No Replit Agent is required.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# Fill .env privately. Read docs/SETUP.md before using an existing database.
pnpm --filter @workspace/db migrate
NOMILORA_SEED_TEST_DATA=yes pnpm seed:test
pnpm dev:api
# Another terminal:
pnpm dev:web
```

Use `http://localhost:5173`. API defaults to port 8080. To use the configured local Supabase callback at port 15173, run the frontend with `PORT=15173 pnpm dev:web`. The frontend proxy target is configurable with `API_PROXY_TARGET`.

```sh
pnpm build
pnpm test
pnpm --filter @workspace/db check
```

Tests use isolated PGlite databases and local HTTP listeners. The React acceptance test drives customer basket → durable order → support ticket → agent response → customer response visibility through the real Express/storage layers. Auth identities and Stripe transport are mocked only inside tests. Optional `TEST_DATABASE_URL` exercises the production PostgreSQL driver and concurrent checkout against an empty, loopback database named `nomilora_test`. CI provisions that disposable PostgreSQL 16 service and has no deployment credentials or deployment step.

## Configuration and release status

Read [setup](docs/SETUP.md), [checkpoint evidence](docs/CHECKPOINT.md) and [release operations](docs/RELEASE.md). Authentication configuration is separate from application data. A free Nomilora Supabase project exists; its public configuration is stored only in the local ignored `.env`. Do not publish secrets or run migrations blindly against the existing database.

No live payments, real delivery, paid service or public deployment was enabled. The existing database is backed up, migrated and seeded with fictional test meals. Real Supabase sign-in and a saved no-charge order have been verified in the private connected preview. Authenticator/recovery acceptance, Stripe dashboard test-event acceptance, legal/food-safety/restaurant agreements, tax and launch approval remain required. Draft policy pages are not legal sign-off. PWA device/offline and broader accessibility acceptance remain incomplete. The original archived mockup sandbox is retained but excluded from the product build.

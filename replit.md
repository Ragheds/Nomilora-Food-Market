# Nomilora

A mobile-first customer preview for Nomilora, a planned personalized prepared-meal service in Queens, New York.

## Run & Operate

- `pnpm --filter @workspace/nomilora run dev` — run the customer web app through its managed workflow
- `pnpm --filter @workspace/api-server run dev` — run the shared API server through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Phase 1 does not require database, payment, or authentication secrets.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Web: React, TypeScript, Vite, Tailwind CSS
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Customer app: `artifacts/nomilora/`
- Customer API and illustrative catalog: `artifacts/api-server/src/routes/nomilora.ts` and `artifacts/api-server/src/lib/nomilora-catalog.ts`
- API contract: `lib/api-spec/openapi.yaml`
- Generated API hooks and schemas: `lib/api-client-react/` and `lib/api-zod/`
- Phase 1 app notes: `artifacts/nomilora/README.md`

## Architecture decisions

- Phase 1 uses server-served illustrative catalog data and browser-local storage; database persistence and user accounts are deferred.
- Checkout validates server-side sample prices but only returns a zero-charge simulation. It never creates a real order.
- API hooks and Zod schemas are generated from the OpenAPI contract; update the contract and rerun codegen together.
- The PWA caches only the app shell and brand assets. It never caches API or checkout responses.

## Product

Nomilora helps customers explore sample chef-prepared meals, personalize menu ideas, save favorites, manage a local preview cart, and simulate checkout without charges. The planned Queens pilot is not active.

## User preferences

- Keep the name Nomilora and tagline “Good food. Your way.”
- Use the supplied original Nomilora logo and app-icon files without redesign.
- Keep menu data and checkout clearly marked as demo-only until the founder verifies real partners, food details, delivery areas, and payments.

## Gotchas

- No active delivery zones, delivery windows, live payment processing, or subscriptions are configured.
- All meal ingredients, tags, prices, allergen declarations, nutrition, storage, and reheating information are unverified sample data.
- Do not treat missing allergen data as safe. Strict allergen preferences must return no recommendations.
- Do not introduce real-order or delivery-success language while the app remains in demo mode.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

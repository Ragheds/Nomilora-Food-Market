> Historical Phase 1 notes. Current implementation and setup: [root README](../../README.md) and [checkpoint](../../docs/CHECKPOINT.md).

# Nomilora — Phase 1 customer preview

Nomilora is a mobile-first customer experience for a planned prepared-meal pilot in Astoria and Long Island City, Queens. This phase is a preview, not a live ordering service.

## Run

- Start the managed `artifacts/nomilora: web` workflow to preview the customer app.
- Start `artifacts/api-server: API Server` for its typed `/api` endpoints.
- Run `pnpm --filter @workspace/nomilora run typecheck` to check the frontend.
- Run `pnpm --filter @workspace/api-server run typecheck` to check the API.
- The managed web workflow supplies the Vite `PORT` and `BASE_PATH`; for a direct local production build, run `PORT=18352 BASE_PATH=/ pnpm --filter @workspace/nomilora run build`.
- The OpenAPI contract is `lib/api-spec/openapi.yaml`; regenerate client and server schemas with `pnpm --filter @workspace/api-spec run codegen`.

## Phase 1 architecture

- React, TypeScript, Vite, and the workspace's shared UI dependencies power the customer app.
- The shared Express API serves the 16 illustrative meals, a deterministic preference recommender, launch-readiness status, and a server-priced, zero-charge checkout simulation.
- React Query hooks and Zod schemas are generated from the shared OpenAPI contract.
- Cart, favorites, quiz preferences, and demo history are saved in browser local storage. They are not synced to an account or another device.
- Checkout validates meal IDs, quantities, and totals against the server's sample catalog. The simulation does not create an order, reserve food, schedule delivery, or collect payment.
- The PWA caches its app shell and original brand assets only. It never caches API or checkout responses; offline checkout is unavailable.

## Current demo boundaries

- All meals, prices, tags, ingredients, images, allergen declarations, storage guidance, and nutrition are illustrative and unverified.
- Astoria and Long Island City are planned pilot areas, not active delivery zones. No address can be confirmed and no delivery window is available.
- Payments, weekly billing, user accounts, authentication, restaurant onboarding, partner operations, and founder/admin tools are not configured.
- Strict-allergen preferences return no recommendations because every meal's allergen data is unknown. Do not use this preview to make a food-safety decision.
- The food photographs currently reference public Unsplash image URLs for visual demonstration. Replace them with approved, partner-matched assets and retain the appropriate usage rights before launch.
- The included Nomilora logos, app icons, and favicon are the original files from the supplied launch pack and are used without redesign.

## Next phases

1. Add database persistence and authentication for customer preferences, favorites, carts, and real order records.
2. Verify restaurant partners, menu details, allergens, ingredients, packaging, delivery capacity, dates, and eligible service zones.
3. Build partner and founder/admin workflows with role isolation and audit history.
4. Configure and validate payment-provider test mode, then complete food-safety, legal, operational, accessibility, and security reviews before enabling real orders.


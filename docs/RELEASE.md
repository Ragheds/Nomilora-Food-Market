# Release and recovery operations

This code supports a private **test-only** release. There is no public deployment workflow and no live mode toggle. Public release requires explicit founder approval and completion of the open items below.

## Before a private test run

- Preserve the existing database backup and review its migration baseline. Set `DATABASE_URL` only on the server; migrate before starting the API. Re-run migrations to confirm journal idempotence.
- Install from the lockfile with Node 24/pnpm 11.25.0. Run `pnpm build`, `pnpm test` and the Drizzle check. Review GitHub CI, including PostgreSQL concurrency coverage, before merging.
- Set public Supabase config at frontend build time and server config at runtime. Keep Stripe test secrets server-only. Use exact allowed origins; TLS is required outside loopback. Do not blindly enable Express trust proxy: rate limiting currently trusts the direct connection address, so a proxy can cause a shared limit. Review authenticated gateway/rate-limit configuration for the actual host before deployment.
- Test founder MFA, kitchen membership and two independent customer accounts. Seed fictional data only. A seed window expires; create future test windows through the admin scheduler as needed.
- API health does not prove database/provider readiness. Monitor HTTP failures, database connectivity and signed webhook retries without logging credentials, passwords or customer message bodies.

## Acceptance flows

1. Verify customer registration, email confirmation, login, persistent session, logout and recovery with Supabase. No default admin or password bypass is provided.
2. Save preferences/address/cart, sign out and back in, and verify another account cannot read or modify those records. Test strict allergens and unknown cross-contact information.
3. Place a no-charge saved test order, retry the identical request, then confirm one order/reservation. Repeat with Stripe test checkout and signed events. Verify cancellation, payment expiry and full test refund release reservations once.
4. Route orders through the correct kitchen: confirmed → preparing → ready. Only authorized operations staff can dispatch/deliver test records. Customer/staff support notes and kitchen membership must remain isolated.
5. Create a test weekly plan, choose a matching period's box and process a verified paid test invoice. Duplicate it; ensure one order. Fail stock, address or slot validation, repair it and retry the exception without another payment. Pause/skip future billing; already-paid periods require explicit support handling.
6. Submit a private restaurant draft, edit after approval and verify approval is cleared. Real prospective partners remain hidden even if a staff member selects approved. Test inquiry consent, notification read-state and audit entries.
7. Test keyboard navigation, narrow mobile layouts, PWA installation/update and offline fallback on actual supported devices. Offline operations cannot submit orders or cache private API responses.

## Recovery

Stop writes before schema/data recovery. Keep source at a known commit and restore a verified backup into a disposable database before directing the app to it. Migrations are forward-only; do not pretend reverting Git also reverts a database. Prefer a reviewed corrective migration; never apply a guessed destructive rollback. Keep previous built frontend/API artifacts and configuration available privately.

Stripe webhook failures should be retried using the original event/invoice identifiers; unique constraints and transactions prevent repeated fulfillment. Use the billing exception queue for paid periods lacking a valid box. Preserve order and audit records. A full test refund is verified through a signed provider event; marking a payable settled creates only a test accounting record and transfers no money.

## Public-launch blockers

Explicit launch approval; live-mode architecture and review; real restaurant agreements and licensing/insurance; verified menu ingredients/allergens/cross-contact/nutrition and image rights; legally reviewed privacy/terms/refund and retention/deletion procedures; sales tax and billing rules; delivery staffing/coverage/cutoffs and incident/refund processes; authorized email sender; independent security/accessibility review; backups/restore exercises; monitoring, distributed rate limits and load testing appropriate to the deployment.

The draft public policy pages describe current test behavior. They do not establish legal compliance, food-safety certification, allergy safety, fulfillment staffing or a public service commitment.

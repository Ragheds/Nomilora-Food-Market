> Historical audit before the Phase C implementation. See [current checkpoint](../../docs/CHECKPOINT.md) for verified changes and limits.

# Nomilora Phase 1 audit — November 12, 2026

Inspected in the existing Replit project through the connected browser: source, running preview, launch ZIP quick-start requirements and master-spec scope, original assets, build, and API behavior. No Agent generation, upgrade, paid purchase, publishing, payment activation, or external port exposure was performed.

## What is implemented
- Branded customer homepage, 16 illustrative meals, details, search/category/cuisine/style/price controls, favorites, cart, profile, weekly-plan preview, demo checkout and browser-local demo history.
- Five-step optional quiz with deterministic server scoring. Strict-allergen selections return zero recommendations because all demo declarations are unknown. This guard does not make the catalog allergy-safe.
- Typed API client and Express routes for catalog, detail, recommendations, readiness and demo checkout; server validates requests and calculates totals. Checkout returns simulated/not_charged.
- Browser storage persists cart, preferences, favorites and history on the same device; it is not authenticated server/database persistence. Database schema is still scaffolding.
- React/Vite and Express align with the full specification's React/Vite preference; it does not require a Next.js migration.
- Original six installed brand files and favicon match launch ZIP bytes exactly. No logo assets were edited.

## Verified and changed in this audit
- Full workspace TypeScript/build passed with PORT=5173 BASE_PATH=/ pnpm build. Bare pnpm build fails when required environment settings are missing. Nonfatal tooltip source-map warning remains.
- Browser: completed five-step quiz; strict peanut preference returned no recommendations; added a preview meal, changed quantity, refreshed and confirmed persistence; completed no-charge checkout and saw explicit no-real-order confirmation. Reviewed desktop and iPhone SE preview layouts; this is not exhaustive device/accessibility coverage.
- Added validation for malformed saved JSON and wrong data shapes, history bounds, and a shared cart quantity cap (20 per meal). Previously homepage Add preview could exceed the API limit.
- Added route scroll reset so a new page opens at its beginning.
- Added JSON responses for malformed/oversized request-parser errors. Restarted API workflow and verified against active server.
- Added 5 storage/cart regression tests and 6 API smoke tests; all 11 pass. API tests cover catalog/detail/404, disabled operational flags, strict-allergen zero matches, deterministic recommendations, malformed input, invalid checkout, acknowledgment and server totals. Test checkout records are ephemeral, with no real orders.
- Commands: pnpm --filter @workspace/nomilora test; pnpm --filter @workspace/nomilora test:api (requires API running, defaults localhost:8080/api; NOMILORA_API_URL overrides it).

## Priority next steps
1. Complete Phase 1 persistence: select existing approved/free database approach; implement customer/session ownership, migrations, server-side cart/preferences/favorites and persisted demo records. Verify restart and device/session isolation. Do not provision paid services automatically.
2. Improve recommendation semantics: eating styles currently affect score rather than enforcing dietary exclusion, and label substring matching is limited. Define preference versus strict constraints and map illustrative labels deliberately; test incompatible styles, dislikes, all allergens and empty results. Never interpret unknown declarations as safe.
3. Complete disabled customer flow deliberately: contact/verification channel, waitlist handling, configured service-zone checks, address validation, delivery scheduling, and editable weekly-plan behavior. With no verified operating configuration, keep real order fulfillment and billing disabled.
4. Review food photography against each named dish; current remote stock photos are illustrative and may not match the actual meal. Confirm appropriate assets and usage rights.
5. Broaden browser coverage: every route/filter, favorites, back navigation, API outage/retry, corrupted storage, keyboard/focus/contrast, narrow mobile widths, offline/PWA behavior and full checkout regression. Existing automated checks are smoke/regression tests, not comprehensive browser end-to-end coverage.
6. Decide whether to retain React/Vite+Express or align with Next.js before expanding into partner/admin systems. Keep approved logos unchanged in either choice.

## Limits and missing work
- Authentication/accounts, real database persistence, partner/admin portals, live kitchens, verified allergens/nutrition, active delivery zones/windows, contact/waitlist collection and payments are not complete.
- Demo checkout omits address/scheduling/test-payment integration; discount and scheduling controls are placeholders. Disabled payments and delivery are appropriate until configured.
- No claim of launch readiness, comprehensive security review, food-safety verification or production deployment is made.

# Nomilora founder handoff

Nomilora is a working private test product. It is not yet a publicly operating food-delivery business. Original branding and source history are preserved; development did not use Replit Agent or purchase services.

## Verified with the real connected app

- Supabase confirmation/sign-in, persistent profile/session, saved addresses/cart, initial founder access and authenticator verification.
- Recovery email delivery, followed by the corrected MFA-protected password update. The founder completed credentials privately and returned to the signed-in profile.
- No-charge saved order; hosted Stripe sandbox payment and signed full refund.
- Weekly sandbox checkout, verified paid invoice, selection of five fictional meals, one matching order without another charge, pause/resume/skip/cancel.
- Fictional kitchen confirmation/preparation/ready/dispatch/delivery and an accounting record. No food, courier, payout or real charge was created.
- Production builds and workflow/security tests; PostgreSQL concurrency, guarded migration adoption, a full disposable backup restore, and a portable non-root container with a read-only filesystem.

Use Account for security and profile, Test market for fictional checkout, Orders & plans for order/billing state, Help & messages for tickets, and Staff workspace for authorized operations. After a new login, staff tools require a fresh authenticator verification.

## What is still needed for a real launch

| Area | Current state | Required next step |
| --- | --- | --- |
| Domain | Intended `nomilora.com`; not owned | Founder approves a registrar/purchase quote. No purchase made. A registry lookup is not a reservation. |
| Hosting | Private Replit editor preview; sleeps | Approve durable hosting and spending limits, then verify database network access, TLS, exact origins/callbacks, durable webhooks and monitoring. |
| Customer email | Restricted Supabase default sender | Own the sender domain, configure an approved SMTP provider and DNS, and test delivery to ordinary customer addresses. |
| Restaurant/menu | Fictional test kitchen only | Obtain actual agreements, approved menu/prices, ingredient/allergen/cross-contact evidence, operational guidance and image permissions. Olia remains unlisted. |
| Live commerce | Deliberately not implemented/enabled | Complete production payment/tax/refund/payout design and review, business account activation, and explicit live-launch approval. A live key is rejected by the current code. |
| Delivery | Scheduling/capacity and simulated state only | Confirm who prepares and delivers, actual coverage/windows/cutoffs, customer contact and incident/refund procedures. No courier is connected. |
| Policies and operations | Draft test-policy pages | Approve final customer terms/privacy/refunds and applicable business/food operations with the appropriate professionals. |
| Release assurance | Automated and desktop private acceptance | Complete actual private-backup restore exercise, supported-device/PWA/accessibility, deployment-specific security/rate-limit/load review, and a supervised pilot. |

The code cannot determine restaurant agreements, operating facts, business identity, tax decisions or payment/bank information on the founder's behalf. Enter credentials and financial account details privately. Marketing and restaurant outreach remain with the founder; no messages were sent to restaurants.

## Available release paths

A public prelaunch preview/waitlist can be reviewed separately with all real ordering disabled. It still requires explicit approval of its public audience, host and any cost. Replit's Starter documentation currently describes one free published app whose link expires after 30 days; do not mistake it for a durable production commitment. See https://docs.replit.com/billing/plans/starter-plan.

A real ordering launch requires the items above and additional live-commerce implementation/review. Do not replace test credentials with live keys, expose the private development URL, remove MFA, or present fictional declarations as verified real menu information to rush a launch.

Source review: https://github.com/Ragheds/Nomilora-Food-Market/pull/2. Technical setup and release/recovery procedures are in SETUP.md and RELEASE.md. Production deployment and PR merge are not automatic consequences of passing tests.

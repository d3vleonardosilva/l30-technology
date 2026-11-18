# L30 Technology — Floating Camera Licensing API

Secure licensing service foundation for Floating Camera. This source is in a development branch and is not deployed or approved for live sales.

## Product policy

- Annual license: US$19.99 one-time payment.
- One active annual license per Device ID.
- License term: 12 months from issuance.
- Free trial: 7 days, started and tracked server-side.
- No auto-renewal or recurring subscription.
- Paddle is the payment provider; only a verified completed transaction can trigger automatic issuance.
- Initial checkout catalog is USD 19.99. Keep currency localization disabled until localized amounts are recorded and verified end-to-end.

## Architecture

- Windows client verifies signatures locally with public keys only.
- Cloudflare Worker issues signed license envelope v2 using Ed25519.
- Cloudflare Worker private key is stored only as a Worker Secret.
- D1 stores customer, order, trial, license, webhook-idempotency and audit records.
- Existing version-1 licenses remain verifiable by the legacy public key in the desktop client.
- Each v2 key has a permanent key_id; retired public keys remain in the desktop trust keyring.
- The v2 license embeds an opaque local customer UUID, not the buyer's name or email.

## License v2 format

The Worker signs UTF-8 JSON containing version, key_id, and payload, with recursively sorted object keys and compact JSON serialization. The response envelope is:

~~~json
{
  "version": 2,
  "key_id": "l30-floating-camera-ed25519-2026-11",
  "payload": {
    "customer": "Customer Name",
    "device_id": "24_UPPERCASE_HEX_CHARS",
    "expires_on": "YYYY-MM-DD",
    "issued_on": "YYYY-MM-DD",
    "plan": "annual",
    "product": "FloatingCamera",
    "serial": "16_UPPERCASE_HEX"
  },
  "signature": "BASE64_ED25519_SIGNATURE"
}
~~~

The desktop app's PUBLIC_KEYS map must contain the matching public key before the Worker is enabled for production issuance.

## Key custody and recovery

Read SECURITY_AND_OPERATIONS.md. Use tools/generate_signing_key.py on the controlled Windows development machine to generate a key pair and an AES-GCM encrypted recovery backup.

Production secrets are configured separately using Cloudflare Worker Secrets:
- LICENSE_SIGNING_KEY_PKCS8_B64
- LICENSE_ADMIN_TOKEN
- PADDLE_API_KEY
- PADDLE_WEBHOOK_SECRET

Non-secret Worker variables:
- LICENSE_SIGNING_KEY_ID
- PADDLE_PRICE_ID
- SITE_ORIGIN

Never commit a .dev.vars file, private key, plaintext backup, provider credential or admin token. Never deploy with an empty or placeholder signing key.

## API routes

- GET /health — service health.
- POST /api/trial/start — start or query a server-side 7-day trial; body includes device_id.
- POST /api/checkout/create — finds or creates a Paddle customer by exact email, binds its Paddle customer ID to the local customer, then creates a transaction for that customer and device.
- POST /api/webhooks/paddle — verifies Paddle signature and timestamp; processes transaction.completed idempotently.
- GET /api/license?device_id=... — returns the latest active signed token for a device, or a status.
- POST /api/admin/licenses/issue — manual one-year issue; requires Authorization: Bearer ... with LICENSE_ADMIN_TOKEN; protect this route with Cloudflare Access.
- POST /api/admin/licenses/revoke — revoke by serial; requires admin authorization and creates an audit record.

## Database

migrations/0001_initial.sql is the initial schema for the new service. It has customer and order records, server-side trial state, versioned licenses, unique Paddle event IDs and an admin audit table. License history is retained; the partial unique index prevents more than one active license per device. Expired records are moved to expired before renewal.

Do not apply this schema to an existing database without reviewing its current state. This branch is a prototype; create a separate sandbox D1 first.

## Paddle default payment link

The L30 site contains `floatingcamera/checkout.html`, intended as the approved default payment-link page. Configure the Paddle sandbox website approval and default payment link as:

`https://www.l30.tec.br/floatingcamera/checkout.html`

The page currently has a placeholder sandbox client-side token. Replace it only with a Paddle **client-side token** for the matching environment. The page initializes Paddle.js and reads the `_ptxn` transaction reference. Client-side tokens are intended for browser use; never put API keys, webhook secrets, signing keys or admin tokens into the page. Sandbox and live environments require separate configuration and testing. The app accepts checkout URLs only from HTTPS subdomains of `l30.tec.br`.

## Paddle security

The Paddle API key needs the least-privilege scopes required by this Worker: `customer.read`, `customer.write`, `price.read`, and `transaction.write`. The checkout flow looks up an exact customer email, creates the provider customer if needed, binds its `customer_id` to the local customer row, and includes that ID in the transaction. The Worker also fetches the configured price before creating checkout and refuses it unless it is active, non-recurring, exactly USD 19.99, has no trial period or currency overrides. The completed webhook must match the provider transaction ID, exact stored price ID and quantity, local order/device, and bound customer ID before issuing.

The webhook:
- verifies the raw request body with the notification destination secret;
- checks the signed timestamp using the documented 5-second tolerance;
- supports multiple h1 signatures during provider-side key rotation;
- requires a transaction.completed event;
- verifies the local order ID, provider transaction ID, device ID, bound Paddle customer ID, exact price ID and quantity, product term, currency and minimum price;
- confirms the Paddle customer ID stored on the local order matches the transaction's customer ID;
- records event IDs and stores issued tokens idempotently.

Paddle recommends its SDK helper for signature verification and documents the timestamp tolerance and raw-body requirement: https://developer.paddle.com/webhooks/about/signature-verification/

## Mandatory launch gates

1. Generate the production key, add its public key to the desktop app and test the v2 token against the same test vectors.
2. Set production Worker Secrets and non-secret variables.
3. Create a sandbox D1 database, apply migrations and test restores.
4. Protect /api/admin/* with Cloudflare Access, MFA and the independent admin token.
5. Add rate limits for trial and checkout endpoints.
7. Add refund and chargeback handling, support transfer/reissue rules and customer privacy notice.
8. Finish device-identity hardening (Windows-protected installation key), define reinstall/transfer support, and test the documented 7-day signed offline lease.
9. Add automated API integration tests and full Paddle sandbox tests, including customer binding, successful/failed checkout, duplicate/out-of-order webhook, refund and chargeback.
9. Configure Cloudflare Access + MFA for `/api/admin/*`, rate limits for trial and checkout, alerts and tested D1 exports/restores.
10. Review legal pages, tax/payment setup and Paddle seller approval; deploy to a separate staging Worker and API hostname before any production rollout.

## Current status

Completed in this development branch:
- v2 signing envelope with a key ID in the Worker scaffold;
- legacy v1 compatibility retained in the desktop verifier;
- initial D1 schema with license key IDs, webhook-event deduplication and administrative audit;
- Paddle timestamp and signature checks hardened;
- manual issue and revoke endpoints require a separate secret;
- local key-generation and encrypted-recovery utility with round-trip and tamper-detection tests;
- Windows client self-service checkout screen, server-side trial request, online license retrieval and signed 7-day offline lease verification;
- exact Paddle customer lookup/creation and provider-customer binding in checkout/webhook;
- regression tests confirming both stored v1 licenses remain valid.

Not yet completed:
- production key generation, public-key registration and secret provisioning;
- online client compatibility testing against a deployed staging API;
- Cloudflare Access and rate-limit configuration;
- D1 sandbox setup and backup/restore test;
- Paddle sandbox end-to-end tests, refund/chargeback automation;
- Windows installation-identity protection, security review and production deployment.

No live checkout should be advertised until all launch gates have passed.

# L30 Technology — Floating Camera Licensing API

Secure licensing service foundation for Floating Camera. This source is in a development branch and is not deployed or approved for live sales.

## Product policy

- Annual license: US$19.99 one-time payment.
- One active annual license per Device ID.
- License term: 12 months from issuance.
- Free trial: 7 days, started and tracked server-side.
- No auto-renewal or recurring subscription.
- Paddle is the payment provider; only a verified completed transaction can trigger automatic issuance.

## Architecture

- Windows client verifies signatures locally with public keys only.
- Cloudflare Worker issues signed license envelope v2 using Ed25519.
- Cloudflare Worker private key is stored only as a Worker Secret.
- D1 stores customer, order, trial, license, webhook-idempotency and audit records.
- Existing version-1 licenses remain verifiable by the legacy public key in the desktop client.
- Each v2 key has a permanent key_id; retired public keys remain in the desktop trust keyring.

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
- POST /api/checkout/create — creates a Paddle transaction; body includes name, email and device_id.
- POST /api/webhooks/paddle — verifies Paddle signature and timestamp; processes transaction.completed idempotently.
- GET /api/license?device_id=... — returns the latest active signed token for a device, or a status.
- POST /api/admin/licenses/issue — manual one-year issue; requires Authorization: Bearer ... with LICENSE_ADMIN_TOKEN; protect this route with Cloudflare Access.
- POST /api/admin/licenses/revoke — revoke by serial; requires admin authorization and creates an audit record.

## Database

migrations/0001_initial.sql is the initial schema for the new service. It has customer and order records, server-side trial state, versioned licenses, unique Paddle event IDs and an admin audit table. License history is retained; the partial unique index prevents more than one active license per device. Expired records are moved to expired before renewal.

Do not apply this schema to an existing database without reviewing its current state. This branch is a prototype; create a separate sandbox D1 first.

## Paddle security

The webhook:
- verifies the raw request body with the notification destination secret;
- checks the signed timestamp using the documented 5-second tolerance;
- supports multiple h1 signatures during provider-side key rotation;
- requires a transaction.completed event;
- verifies the local order ID, provider transaction ID, device ID, product term, currency and minimum price;
- records event IDs and stores issued tokens idempotently.

Paddle recommends its SDK helper for signature verification and documents the timestamp tolerance and raw-body requirement: https://developer.paddle.com/webhooks/about/signature-verification/

## Mandatory launch gates

1. Generate the production key, add its public key to the desktop app and test the v2 token against the same test vectors.
2. Set production Worker Secrets and non-secret variables.
3. Create a sandbox D1 database, apply migrations and test restores.
4. Protect /api/admin/* with Cloudflare Access, MFA and the independent admin token.
5. Add rate limits for trial and checkout endpoints.
6. Add refund and chargeback handling, support transfer/reissue rules and customer privacy notice.
7. Integrate the Windows client with the API for trial start, license retrieval and periodic revocation checks, including a documented offline grace period.
8. Run automated unit, integration and end-to-end tests with Paddle sandbox.
9. Review legal pages, tax/payment setup and Paddle seller approval.
10. Deploy to a separate staging Worker and API hostname. Only then consider production rollout.

## Current status

Completed in this development branch:
- v2 signing envelope with a key ID in the Worker scaffold;
- legacy v1 compatibility retained in the desktop verifier;
- initial D1 schema with license key IDs, webhook-event deduplication and administrative audit;
- Paddle timestamp and signature checks hardened;
- manual issue and revoke endpoints require a separate secret;
- local key-generation and encrypted-recovery utility.

Not yet completed:
- production key generation, public-key registration and secret provisioning;
- online client integration and offline grace-period behavior;
- Cloudflare Access and rate-limit configuration;
- D1 sandbox tests, Paddle sandbox E2E tests, refund/chargeback automation;
- security review and production deployment.

No live checkout should be advertised until all launch gates have passed.

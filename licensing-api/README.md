# L30 Technology — Floating Camera Licensing API

Backend scaffold for international sales of Floating Camera.

## Commercial policy

- Annual license: **US$19.99**.
- One license is bound to one 24-character Device ID.
- License term: 12 months from issuance.
- Free trial: 7 days, recorded server-side per Device ID.
- Checkout: Paddle, automatic collection, one-time annual purchase (no automatic renewal).
- Paddle localizes checkout currency where enabled in the seller account. The base catalog price remains USD 19.99.

## Deployment

Target: Cloudflare Worker + D1. Suggested API hostname: `api.l30.tec.br`. Do not alter the existing portfolio DNS until the Worker is tested.

## Paddle setup

1. Apply `migrations/0001_initial.sql` to a Cloudflare D1 database.
2. In Paddle, create a product named **Floating Camera — Annual License**.
3. Create a **one-time** price of **USD 19.99**. Do not configure a recurring subscription price: the license expires after 12 months and is not auto-renewing.
4. Enable automatic currency localization in Paddle if desired. The customer sees the applicable localized checkout amount; USD 19.99 is the base price.
5. Configure a Paddle notification destination for `https://api.l30.tec.br/api/webhooks/paddle` and subscribe to `transaction.completed`.
6. Bind D1 as `DB` and configure Worker secrets:
   - `PADDLE_API_KEY`: Paddle API key (server-side only).
   - `PADDLE_WEBHOOK_SECRET`: endpoint-specific Paddle notification secret.
   - `LICENSE_PRIVATE_KEY_PKCS8_B64`: base64 PKCS#8 Ed25519 private key matching the public key already embedded in the desktop app.
7. Configure Worker variables:
   - `PADDLE_PRICE_ID`: Paddle one-time price ID for USD 19.99.
   - `SITE_ORIGIN`: exact allowed site origin, e.g. `https://www.l30.tec.br`.
   - `LICENSE_PUBLIC_KEY_B64`: current app public key.
8. Test using Paddle sandbox credentials and sandbox notification destination before requesting live approval.

## API routes

- `GET /health`
- `POST /api/trial/start` — body: `{ "device_id": "24_HEX_DEVICE_ID" }`
- `POST /api/checkout/create` — body: `{ "name": "...", "email": "...", "device_id": "24_HEX_DEVICE_ID" }`
- `POST /api/webhooks/paddle` — validates Paddle-Signature and provisions a license only for completed transactions.
- `GET /api/license?device_id=24_HEX_DEVICE_ID` — returns the signed annual token if available.

## Security and launch requirements

- Do not collect CPF unless a specific legal/accounting requirement is confirmed.
- Never put Paddle API keys, webhook secrets, or the Ed25519 private key in browser code or Git.
- Browser redirects are not proof of payment. Only a signature-verified Paddle webhook provisions the license.
- The webhook checks the transaction's custom order/device references, completed status, USD currency, and minimum USD 19.99 total before issuing.
- Preserve the existing Ed25519 public key and verify the corresponding private key before production. Do not generate a new key; that would invalidate compatibility with existing signed licenses.
- The 7-day server-side trial endpoint is scaffolded, but the desktop app still needs integration and must fail safely when the service is unavailable.
- Add admin authentication, license revocation, webhook replay/idempotency tests, rate limits, privacy notice, and end-to-end sandbox tests before launch.

## Status

Development scaffold only. Not deployed and not ready to accept live payments. Live launch requires Paddle seller approval, Cloudflare configuration, secrets, matching signing key, app integration, and end-to-end testing.

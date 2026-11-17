# L30 Technology — Floating Camera Licensing API

Initial backend scaffold for the Floating Camera online licensing service.

## Decisions encoded

- 7-day evaluation period, recorded server-side per Device ID.
- One annual license is bound to exactly one Device ID.
- Automatic online payment through Mercado Pago Checkout Pro (Orders API).
- Annual license token remains compatible with the current Floating Camera Ed25519 verifier.
- The app receives a signed JSON license only after the server verifies the Mercado Pago order as processed/accredited.

## Deployment target

Cloudflare Worker + D1 database. This is a separate service from the static portfolio site. Suggested production hostname: `api.l30.tec.br` (do not change existing site DNS until the Worker is ready).

## Required Cloudflare setup

1. Create a D1 database and apply `migrations/0001_initial.sql`.
2. Create a Worker from this directory using `wrangler.jsonc`.
3. Bind the D1 database as `DB`.
4. Configure Worker secrets (never commit them):
   - `MERCADOPAGO_ACCESS_TOKEN`: seller's production or test access token.
   - `MERCADOPAGO_WEBHOOK_SECRET`: secret signature from Mercado Pago Webhooks.
   - `LICENSE_PRIVATE_KEY_PKCS8_B64`: base64 PKCS#8 Ed25519 private key that matches the public key embedded in the current app.
5. Configure variables:
   - `ANNUAL_PRICE_BRL`: annual price, decimal string (e.g. `49.90`); intentionally unset until the owner decides the price.
   - `SITE_ORIGIN`: exact public site origin, e.g. `https://www.l30.tec.br`.
   - `LICENSE_PUBLIC_KEY_B64`: current app public key.
6. Create the Mercado Pago application and configure the **Order (Mercado Pago)** webhook to:
   `https://api.l30.tec.br/api/webhooks/mercadopago`
7. Test in Mercado Pago test mode before production.

## API routes

- `GET /health`
- `POST /api/trial/start` — body: `{ "device_id": "24_HEX_DEVICE_ID" }`
- `POST /api/checkout/create` — body: `{ "name": "...", "email": "...", "device_id": "24_HEX_DEVICE_ID" }`
- `POST /api/webhooks/mercadopago` — signed Order webhook.
- `GET /api/license?device_id=24_HEX_DEVICE_ID` — returns the signed annual token if payment has been verified.

## Security notes

- Do not collect CPF unless a specific legal/accounting requirement is confirmed.
- Never expose the Mercado Pago access token, webhook secret, or Ed25519 private key to browser code or GitHub.
- A browser return URL is not proof of payment. The backend queries the Mercado Pago Orders API and checks the order status and paid amount before issuing a license.
- Webhook signature validation uses HMAC-SHA256 and constant-time comparison.
- The current desktop app uses a 24-character Device ID. The server binds each license to that ID and enforces one active license per device.
- The existing app public key is preserved; the private key must match it exactly. Do not generate a replacement key until existing license compatibility is verified.

## Important implementation status

This is a first backend implementation scaffold. It is not production-ready until the Cloudflare D1 database, secrets, Mercado Pago test credentials, webhook, domain, and matching Ed25519 private key are configured and end-to-end tests pass.

# Floating Camera — L30 Technology website

Responsive static landing page plus separate customer account and Paddle checkout pages. The site has no build step. The checkout pages load the Supabase and Paddle browser SDKs from their official CDNs.

## Preview
Open `index.html` in a browser. For local static preview, run `python -m http.server 8000` from this directory and open `http://localhost:8000`. A full local checkout test also requires Supabase Auth CORS/redirect configuration and a working local payment-link origin; see the notes below.

## Files
- `index.html`: multilingual landing page and product details.
- `buy.html`: English/Portuguese/Spanish sign-in, account creation, password recovery, monthly/annual plan selection and individual/business checkout.
- `pay.html`: Paddle.js payment-link page; reads the `_ptxn` transaction query parameter and opens the corresponding Paddle checkout.
- `supabase-config.js`: public Supabase URL and publishable key for the staging project.
- `paddle-config.js`: public Paddle.js client-side token for the Sandbox environment.
- `assets/floating-camera.png`: application icon.
- `assets/l30-technology.png`: brand mark.
- `assets/floating-camera-real-demo.webp`: illustrative product preview, as supplied.

## Improvements
- Responsive high-contrast product design and mobile navigation.
- English, Portuguese and Spanish translations.
- Product features, how-it-works, use cases, licensing, FAQ and contact sections.
- Pro CTA opens `buy.html`; checkout is handled by the Supabase Edge Function and Paddle.
- No analytics or external trackers are added by the site.

## Licensing v2 — staging status

This branch is for controlled Sandbox testing and is not the production site branch.

- Supabase staging project: `floating-camera-licensing-staging` (`sa-east-1`).
- The database migrations for licensing, monthly subscriptions and private RLS helpers are applied.
- The Edge Functions `create-checkout`, `paddle-webhook`, `activate-device` and `license-status` are deployed and active.
- The browser-side Supabase URL/publishable key are configured for staging; the Paddle.js client token uses the `test_` Sandbox environment.
- The current Paddle transaction records include both monthly and annual checkout URLs routed to `/floatingcamera/pay.html`; one monthly order reached the paid state. These are staging records, not proof of a complete new-customer browser journey.
- The Windows Floating Camera Preview.3 has passed local activation, session persistence and revocation/re-activation checks.
- The checkout page's inline JavaScript and public config files pass syntax checks; the site's GitHub Actions syntax workflow passed on the current `licensing-v2` head.

## Required checks before merging or production

1. In Supabase Authentication → URL Configuration, authorize the exact deployed `buy.html` URL as a redirect URL, and ensure the Site URL and email confirmation/SMTP settings are correct.\n2. Enable leaked-password protection in Supabase Authentication → Password Security; the current project security advisor reports this protection is disabled.
3. In Paddle Sandbox, confirm the default payment link is `https://www.l30.tec.br/floatingcamera/pay.html`, the approved domain matches the site and the monthly/annual Price IDs have the intended 7-day free trial.
4. Test a new account, email confirmation, sign-in, password reset, monthly checkout, annual checkout, business seats, duplicate webhook delivery, subscription cancellation and payment failure.
5. Confirm the resulting entitlement and test activation in the Windows Preview.3.
6. Only after Sandbox validation, create separate Live Paddle products/prices/tokens/secrets and a separate production Supabase project. Never reuse Sandbox credentials for real customers.
7. Update legal pages, support, pricing and installer distribution before public launch.

## Security

The browser may contain only the Supabase publishable key and Paddle client-side token. Never place a Supabase secret/service-role key, Paddle API key, webhook secret or Ed25519 license signing private key in this static site, JavaScript, HTML or GitHub.

## Publishing

Do not merge this branch into `main` or deploy it to the public site while the client token is in Sandbox mode. After the tests above, prepare a production-specific configuration and deployment review. The preview image is illustrative and must not be represented as an unmodified screenshot.

# L30 Technology — Official Website

Official public website for **L30 TECHNOLOGY INOVA SIMPLES (I.S.)**, a Brazilian software developer and publisher.

## Public routes
- `/` — institutional company homepage; Floating Camera product, company, contact and policy links.
- `/floatingcamera/` — downloadable Windows application and its free/Pro licensing information.
- `/floatingcamera/buy.html` — account and pricing/checkout flow.
- `/floatingcamera/terms.html` — Terms of Service.
- `/floatingcamera/privacy.html` — Privacy Policy.
- `/floatingcamera/refund.html` — Refund Policy.
- `/portfolio/` — Leonardo Silva professional portfolio (preserved from the former homepage).
- `/curriculo/`, `/telemetria/`, `/pcp/` — existing portfolio subpages.

## Publisher verification
The homepage represents L30 Technology as a software business. The founder's separate professional portfolio is retained under `/portfolio/` so buyers and merchant-of-record reviewers can distinguish the **Floating Camera software product** from the founder's work history. Terms, privacy, refund and official customer support are linked from the homepage.

Pricing published on the Floating Camera product page must agree with the Paddle Live catalog before Paddle re-review. Paddle Live checkout remains subject to the payment provider's merchant verification and approval.

## Deployment
GitHub Actions deploys the `main` branch to GitHub Pages for the official custom domain. The site is static HTML/CSS/JavaScript. Preserve the existing company and product URLs during future changes.

The `/portfolio/` page uses `../`-relative links to preserve original root-level assets and portfolio demonstration pages.

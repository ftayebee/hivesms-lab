# Phase 1: Product analysis

## Method and limits

All six reference sites were reachable on 2026-09-30:

| Site | Accessed | How |
| --- | --- | --- |
| sms.bd | Yes | Page text extraction |
| bulksmsbd.com | Yes | Page text extraction |
| mimsms.com | Yes | Page text extraction |
| alpha.net.bd/SMS/api | Yes | Page text extraction (API docs) |
| zaman-it.com/sms | Yes | Page text extraction |
| mirnet.com.bd/service/sms-services | Yes | Page text extraction |

Screenshot capture timed out in the browser tool, so the analysis below is based on page
structure and content, **not** on a close visual inspection of colours, typography or spacing.
Visual observations are limited to what the extracted structure implies (e.g. carousel heroes,
logo walls, icon grids). Nothing below was copied into this product: no text, branding, layout
or imagery.

## Common features across the market

- **Two core products framed everywhere:** *masking* (branded alphanumeric sender ID) vs
  *non-masking* (numeric sender). Masking is always priced higher and needs an approval window.
- **OTP / transactional** as a separate product line, sometimes separately priced.
- **Per-SMS BDT pricing in poisha** is the dominant hook, often placed in the hero itself.
- **Tiered recharge plans** where the per-SMS rate depends on the recharge amount, plus a validity
  period (6-12 months) for purchased balance.
- **Fixed SMS bundles** (N SMS for BDT X) on some sites.
- **HTTP API** with a single `api_key` query parameter, GET or POST, JSON responses with numeric
  error codes; endpoints for send, report by request ID, and balance. Code samples in
  cURL/PHP/Python/Node/Java/.NET.
- **Plugins** for WordPress/WooCommerce, WHMCS, Laravel.
- **Location-based / geo-targeted SMS** offered by several providers.
- **Bangla/Unicode support**, long SMS, scheduling, Excel/CSV upload, templates, delivery reports,
  sub-accounts.
- **Local payment rails** shown as badges: bKash, Nagad, Rocket, cards, bank transfer.
- **Regulatory messaging:** BTRC references, notes that promotional SMS rules apply, VAT excluded
  from listed prices.

## UX patterns observed

| Area | Pattern |
| --- | --- |
| Navigation | Wide menus mixing SMS with unrelated services (hosting, voice, WhatsApp); phone number in header; sign-up link prominent, login sometimes hidden. |
| Hero | Price-led headline ("from 0.xx BDT") or superlative claim; carousel banners; generic marketing imagery. |
| Products | Card per SMS type with a bullet list of 6-8 features and a "details" link. |
| Pricing | Tables of tiers with min recharge, masking rate, non-masking rate, validity. |
| Workflow | 4-5 step "Sign up, recharge, create campaign, send, track" strips. |
| Trust | Large client-logo walls, operator logos, regulator badges, round-number stats (e.g. "10M+ SMS", "99% delivery"). |
| Developer | API docs as one long page with parameter tables and multi-language samples; no sandbox, no key scoping, no webhooks. |
| Conversion | Many parallel CTAs (call, WhatsApp, form, sign up); FAQ at the bottom. |
| Contact | Phone and WhatsApp first; forms secondary. |

## Gaps and opportunities

1. **Developer experience is thin.** Query-string API keys, no versioning, no idempotency, no
   webhooks for delivery reports, no key scopes, no rate-limit headers. A modern REST API with
   Bearer auth, idempotency keys, signed webhooks and consistent errors is a real differentiator.
2. **Unverifiable claims dominate trust sections.** "#1", "best rate", "99.99% uptime", large
   logo walls. An honest platform that shows *how* delivery is measured (per-message status,
   failure reasons, operator breakdown) earns trust differently.
3. **Segment and cost transparency is poor.** Users rarely see how Bangla text changes segment
   count and price before sending. A live composer with encoding detection and cost preview fixes
   a very common billing surprise.
4. **Compliance is mentioned but not productised.** Opt-out lists, consent status, promotional
   quiet hours, campaign review and audit logs are rarely visible. These protect both the
   customer's sender reputation and the platform.
5. **Teams and multi-user access** are shallow ("sub-accounts"). Role-based access and audit trails
   matter for banks, hospitals and schools.
6. **Dashboards are rarely shown.** Marketing sites describe the panel but seldom show it.
7. **Information architecture is cluttered** with unrelated services.

## Differentiation for SMSFlow BD

- **Transparent-by-default:** every price shown with the formula (segments x recipients x rate),
  VAT stated separately, all rates admin-configurable, no superlatives.
- **Developer-first API:** `/api/v1`, Bearer API keys with scopes and one-time display, idempotency
  keys, signed delivery webhooks, documented error codes and rate limits.
- **Compliance built in:** consent status per contact, suppression list enforced automatically on
  promotional sends, configurable quiet hours, campaign review queue, audit log for every
  sensitive action.
- **Bangla-aware composer:** detects GSM-7 vs Unicode, shows segments and cost live; segmentation
  rules configurable per provider.
- **Honest trust signals:** industries served instead of fabricated logos; delivery analytics
  shown as product capability, not as a marketing percentage.
- **Focused IA:** SMS only, organised as Products, Solutions, Developers, Pricing, Resources.
- **Provider-agnostic:** the SMS route and payment gateway are adapters, so the operator can change
  upstream providers without rebuilding.

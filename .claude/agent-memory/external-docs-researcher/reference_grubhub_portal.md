---
name: GrubHub Merchant Portal API Reference
description: URL structure, API hosts, authentication, and data export capabilities for restaurant.grubhub.com
type: reference
---

## Portal
- Login: `restaurant.grubhub.com/login`
- SPA (client-side routing) — exact sub-routes must be observed in browser
- Protected by PerimeterX bot detection

## API Domains
- Partner/merchant API: `api-third-party-gtm.grubhub.com` — requires formal partnership application
- Consumer/internal API: `api-gtm.grubhub.com` — reverse-engineered; `/diners/{ud_id}/search_listing` is for customer accounts, NOT restaurant merchant orders
- Pre-prod partner: `api-third-party-gtm-pp.grubhub.com`

## Architecture
- REST (not GraphQL)
- Auth: Bearer token in `Authorization` header; OAuth2 client_credentials or HMAC for partners
- Consumer API auth: POST `/auth` with email/password → `session_handle.access_token`

## Key Partner Endpoints (partnership required)
- `GET /pos/v1/merchant/{merchant_id}/orders?status=...`
- `POST /pos/v1/merchant/{merchant_id}/orders/{order_uuid}/status`

## CSV Export (current Profit Duck approach — no credentials needed)
- Portal path: Financials → Transactions → Download CSV
- Columns: order_channel, order_number, order_date, transaction_id, merchant_net_total, commission, etc.
- Parser: `src/lib/parsers/grubhub.ts` handles this format

## Gotchas
- `/diners/` endpoints are consumer-side, not merchant-side
- Reconciliation via API is explicitly NOT supported by GrubHub
- `developer.grubhub.com` blocks web fetch (PerimeterX + SPA rendering)
- Two separate API domains — do NOT conflate them

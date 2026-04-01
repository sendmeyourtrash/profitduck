# Research Brief: GrubHub for Restaurants Merchant Portal

**Date:** 2026-03-31
**Researcher:** External Docs Researcher
**Scope:** restaurant.grubhub.com portal structure, internal APIs, authentication, and data export capabilities

---

## Summary

GrubHub's merchant portal is a standard SPA (React-based) at `restaurant.grubhub.com`. There is **no public API** that merchant portal users can directly call to pull their own order/financial history programmatically. The "official" partner API (`api-third-party-gtm.grubhub.com`) is gated behind a formal partnership application process and is intended for POS system integrators, not individual restaurant owners acting on their own behalf.

The **practical approach** for Profit Duck (like DoorDash and Uber Eats) is either:
1. CSV export from the portal (confirmed to exist), or
2. A Chrome extension that intercepts the portal's own authenticated API calls.

---

## 1. Portal URL Structure

| Section | Known/Inferred URL |
|---------|-------------------|
| Login | `restaurant.grubhub.com/login` |
| Portal root (post-login) | `restaurant.grubhub.com/` (SPA, routes are client-side) |
| Orders / Transactions | Not confirmed — likely `/orders` or `/transactions` (SPA route) |
| Financials | Not confirmed — likely `/financials` or accessible via Financials tab |
| Menu Management | Not confirmed — likely `/menu` |
| Settings | Not confirmed — likely `/settings` |

The specific SPA route paths (`/orders`, `/financials`, etc.) are **not publicly documented**. They must be determined by logging into the portal and observing the browser URL bar. The portal uses client-side routing so page reloads may not work at sub-paths.

**Key fact:** GrubHub's "for Restaurants" portal and the public-facing Grubhub consumer site are on separate domains. The merchant portal is always `restaurant.grubhub.com`.

---

## 2. API Architecture: REST, Not GraphQL

GrubHub uses **REST APIs**, not GraphQL. This is confirmed by:
- The official Partner API uses REST endpoints like `GET /pos/v1/merchant/{merchant_id}/orders`
- The consumer-facing API (reverse-engineered by the `jlumbroso/grubhub` Python library) uses REST at `api-gtm.grubhub.com`
- No GraphQL references found in any documentation or community research

---

## 3. API Endpoints

### A. Partner API (requires formal partnership — NOT accessible to individual restaurant owners)

**Host:** `api-third-party-gtm.grubhub.com`
**Pre-prod host:** `api-third-party-gtm-pp.grubhub.com`

Key endpoints:
```
GET  /pos/v1/merchant/{merchant_id}/orders
     ?status=RESTAURANT_CONFIRMABLE   # new unconfirmed orders
     ?status=...                      # other statuses
     (date range params — not fully documented publicly)

GET  /pos/v1/group/{group_key}/orders  (pre-production only)

POST /pos/v1/merchant/{merchant_id}/orders/{order_uuid}/status
     (confirm/reject/complete orders)

POST /pos/v1/merchant/{merchant_id}/orders/{order_uuid}/addpickupinstructions
```

### B. Consumer/Portal Internal API (reverse-engineered, subject to change)

**Host:** `api-gtm.grubhub.com`

Key endpoints (from `jlumbroso/grubhub` Python library, confirmed working as of 2023):
```
POST /auth
     Body: { brand, client_id, device_id, email, password }
     Response: { session_handle: { access_token, refresh_token } }

GET  /diners/{ud_id}/search_listing
     ?pageNum=0&pageSize=20&facet=orderType:ALL&sorts=default
     (This is the CONSUMER order history — for customer accounts, not merchants)
```

**Important note:** The `/diners/` endpoint is for GrubHub diner (customer) accounts, NOT merchant accounts. A restaurant owner logging into `restaurant.grubhub.com` is using a different authentication context and different endpoints than a consumer on `grubhub.com`.

### C. Restaurant Information API (public, read-only)

**Host:** `api-gtm.grubhub.com`
```
GET /restaurants/{restaurant_id}   (menu, details, availability)
GET /restaurants/availability_summaries  (up to 30 restaurants at a time)
```
These are read-only public endpoints — no auth needed but rate-limited.

---

## 4. Authentication

### Partner API Authentication (formal partners only)
Three authentication flows are offered:
1. **Simplified Bearer token** — generates a bearer token, included as `Authorization: Bearer {token}` header
2. **OAuth2 client_credentials** — client ID + secret to get access token
3. **HMAC** — recommended for most API calls; constructs a signature in the request header from sender details + message integrity hash
4. **JWT** — stateless, payload signed with shared secret

**To obtain credentials:** Must fill out GrubHub's partner application form at `developer.grubhub.com`. GrubHub reviews manually and contacts you. A pre-production QA phase is required before production credentials are issued.

### Merchant Portal Authentication (restaurant.grubhub.com)
Based on how the portal works as a standard SPA:
- Login via `restaurant.grubhub.com/login` (email + password)
- Almost certainly uses **session cookies and/or JWT stored in cookies or localStorage**
- The `api-gtm.grubhub.com` consumer API uses `Authorization: Bearer {access_token}` headers — the merchant portal likely uses the same pattern
- No public documentation on exact token/cookie structure for the merchant portal specifically

### Consumer API Authentication (from reverse-engineering)
```
# Step 1: Get client_id (scraped from static page)
GET https://www.grubhub.com/eat/static-content-unauth?contentOnly=1
Extract: regex match for "beta_" prefixed hash

# Step 2: Anonymous token (to bootstrap)
POST https://api-gtm.grubhub.com/auth
{ brand, client_id, device_id, scope: "anonymous" }

# Step 3: Authenticated login
POST https://api-gtm.grubhub.com/auth
{ brand, client_id, device_id, email, password }
Response: { session_handle: { access_token, refresh_token, ud_id } }

# All subsequent requests:
Authorization: Bearer {access_token}
```

---

## 5. CSV Export (Confirmed Available)

GrubHub for Restaurants portal offers a **CSV export** for order/transaction history:

- Navigate to **Financials → Transactions** tab
- Select: restaurant(s), order type, date range
- Click **"Download CSV"** — file downloads automatically
- You can also opt into **daily transaction summary emails**

**This is the current approach in Profit Duck** — the `grubhub.ts` parser handles these CSV exports. The columns confirmed in the existing parser match GrubHub's actual export format:
```
order_channel, order_number, order_date, order_time_local, transaction_date,
transaction_time_local, grubhub_store_id, store_name, transaction_type,
fulfillment_type, subtotal, subtotal_sales_tax, tip, merchant_total,
commission, delivery_commission, gh_plus_commission, processing_fee,
merchant_net_total, transaction_id, ...
```

---

## 6. Public Documentation

| Resource | URL | Access |
|----------|-----|--------|
| Partner API docs | `developer.grubhub.com` | Partner application required for full access; some overview pages are public |
| Zendesk dev docs (legacy) | `grubhub-developers.zendesk.com` | Some articles public, some 403 |
| GrubHub for Restaurants help | `grubhub-for-restaurants.zendesk.com` | Some articles 403 |
| GrubHub marketing/FAQ | `get.grubhub.com` | Public |
| Learning center | `learn.grubhub.com` | Connection issues (may be deprecated) |

The `developer.grubhub.com` portal loads as a JS-heavy SPA — the documentation content is not accessible via simple web fetch (PerimeterX bot protection + SPA rendering). Human browser access required.

---

## What Works

- **CSV export** from `restaurant.grubhub.com` Financials → Transactions → Download CSV (current approach, already working)
- **Profit Duck's `grubhub.ts` parser** handles the confirmed CSV format correctly
- **REST API structure** is consistent and predictable (bearer token auth, standard JSON)
- **Partner API** works for POS integrations (if you apply and get approved)

## What Doesn't Work

- **Direct API access** without partnership credentials — the partner API requires formal application
- **`/diners/` endpoints** — these are for consumer accounts, NOT merchant portals
- **Fetching `developer.grubhub.com` docs programmatically** — PerimeterX blocks bots; the portal is SPA-rendered
- **Webhook-based reconciliation** — GrubHub explicitly states reconciliation via API/integration is not supported

## Gotchas

1. **Two separate API domains:** `api-gtm.grubhub.com` (consumer/public) vs `api-third-party-gtm.grubhub.com` (partner/merchant). They are NOT interchangeable.
2. **`/diners/` ≠ merchant orders** — the reverse-engineered consumer API fetches orders placed BY a customer, not orders received BY a restaurant.
3. **SPA routing** — `restaurant.grubhub.com` uses client-side routing. The exact route paths (`/orders`, `/financials`, etc.) must be observed by logging in, not inferred from docs.
4. **PerimeterX bot protection** — both `restaurant.grubhub.com` and `developer.grubhub.com` use PerimeterX. Any automated or extension-based approach must use the authenticated session from real browser interaction.
5. **CSV format may change** — GrubHub has changed column names before. The parser uses `normalizeKeys()` which lowercases and trims, providing some resilience.
6. **Reporting API overview exists** — `developer.grubhub.com/docs/6AWV4VW2XFayLI9SYrzugm/reporting-api-overview` — but content not accessible without browser/partnership.

## Recommended Approach for Profit Duck

The existing **CSV upload + parser** approach is the right one for GrubHub. It requires no credentials, no partnership, and the CSV format is well-defined and stable.

If a Chrome extension approach (like DoorDash/UberEats) is desired in the future:
- The extension would need to intercept XHR/fetch requests made by `restaurant.grubhub.com` while the user is logged in
- Look for requests to `api-gtm.grubhub.com` or a merchant-specific API host in the Network tab
- The session cookie or bearer token from the logged-in portal session would need to be forwarded
- Start by having Alan log in and inspect Network tab to find the actual order-list endpoint used by the portal

---

## Sources

- [GrubHub Developer Portal](https://developer.grubhub.com/)
- [GrubHub Orders API](https://developer.grubhub.com/api/orders)
- [GrubHub Merchant Data API](https://developer.grubhub.com/api/merchant-data)
- [GrubHub Reporting API Overview](https://developer.grubhub.com/docs/6AWV4VW2XFayLI9SYrzugm/reporting-api-overview)
- [GrubHub Integration Process Overview](https://developer.grubhub.com/docs/CyE2fu1kSXwByY8j6d2Ea/grubhub-connect-integration-process-overview)
- [GrubHub Developers Zendesk - Getting Started](https://grubhub-developers.zendesk.com/hc/en-us/articles/115004601686-Getting-Started)
- [GrubHub Developers Zendesk - Orders](https://grubhub-developers.zendesk.com/hc/en-us/articles/115002713846-Orders)
- [GrubHub Developers Zendesk - Managing Orders](https://grubhub-developers.zendesk.com/hc/en-us/articles/360000061063-Managing-Orders)
- [GrubHub for Restaurants - Merchant Portal](https://get.grubhub.com/products/merchant-portal/)
- [GrubHub for Restaurants - How to Download Order History](https://grubhub-for-restaurants.zendesk.com/hc/en-us/articles/115000454723)
- [jlumbroso/grubhub Python library (reverse-engineered consumer API)](https://github.com/jlumbroso/grubhub)
- [Stevesie - GrubHub API Scraper (HAR file method)](https://stevesie.com/apps/grubhub-api)

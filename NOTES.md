# Smartlane Business API — work notes

Covers the integration of Smartlane's "Business API Draft 1.0" (the platform is one Smartlane
*business*; each organization onboards as a *store* underneath it). The older per-org
`smartlane_client.py` integration (API key, live Airway Bill / Load Sheet printing on the Orders
and Batch screens) is a separate thing and was deliberately left untouched.

Last updated: 2026-09-26. Code is on `main` (commit `7fa62b3`, pushed to origin). A local copy of
the work also sits on branch `feature/smartlane-business-api-ui`.

## Current state — read this first

- **Frontend (Vercel) is live with the new code; backend (Fly.io) is not.** Vercel deploys on push,
  but there is no CI for the backend (`backend/fly.toml` + `Dockerfile`, no `.github/workflows`).
  Until the backend is redeployed, the live admin page shows "Request failed" because
  `GET /api/core/admin/smartlane/requests/` returns 404.
- **Production DB needs the new migration** `integrations/0016_smartlanerequest` before the new
  backend code runs (`python manage.py migrate`). Applied locally only.
- Both steps touch production; do them deliberately.

## What is built

### Business API surface (doc items)

| # | Doc item | Real Smartlane endpoint (`/{businessCode}` prefix) | Status |
|---|---|---|---|
| 1 | Auth (HMAC) | signing in `smartlane_business_client.py` | Done — admin credentials form |
| 2 | Test endpoint | `GET /{bc}` | Done — "Test Connection" |
| 3 | Stores list | `GET /store/list` | Done — admin "All Stores" (name search + "All" eye button), "Sync from Smartlane" |
| 4 | Activity log | `GET /store/{id}/activity/log?type=` | Done, raw JSON only — admin "Activity Log" |
| 5 | New KYC | `POST /store/new/kyc` | Done — tenant form -> super-admin approve -> Smartlane |
| 6 | Webhook list | `GET /web/hook?store_id=` | Client only; reachable via API Explorer, no UI |
| 7 | Webhook register/update | `POST /web/hook` `{store_id,type,url}` | Tenant request -> admin approve (untested) |
| 8 | Warehouse list | `GET /store/{id}/warehouse` | Done — admin panel + tenant list |
| 9 | Warehouse add/edit/revoke | `POST /store/{id}/warehouse` | Add: admin "Provision" (existing). Edit/revoke: tenant request -> admin approve — **has a known bug, see below** |
| 10 | Finance info | `GET /store/{id}/finance/information` | Tenant "Financing", raw JSON |
| 11 | Apply finance | `POST /store/{id}/finance/application` | Tenant request -> admin approve (untested) |
| 12 | Create consignment | `POST /store/{id}/consignment/create` | Tenant "Shipments", JSON body box |
| 13 | Track consignment | `POST /store/{id}/consignment/track` | Tenant "Shipments" |
| 14 | Cancel consignment | `POST /store/{id}/consignment/cancel` | Tenant "Shipments" |
| 15 | Airway bill | `POST /store/{id}/consignment/airway/bill` | Tenant "Shipments", raw response |
| 16 | Load sheet | `POST /store/{id}/consignment/load_sheet` | Tenant "Shipments", raw response |
| 17 | Shipper advice | `GET`/`POST /store/{id}/consignment/shipper/advice` | Tenant "Shipments" |
| 18 | City list | `GET /smartlane/city` | Client only, not wired anywhere |

Not in the doc but present in the client: `GET /smartlane/industries`, `GET /finance/products`.

### Approval flow (webhook, warehouse edit/revoke, finance)

One shared model, `SmartlaneRequest` (`integrations/models.py`, table `smartlane_requests`), with a
`request_type` of `webhook` / `warehouse_edit` / `finance` and a JSON `payload`.

1. Tenant submits from the OMS Courier page (only visible once their store is `active`) -> status
   `pending_approval`. Nothing is sent to Smartlane.
2. Super admin sees it under **Requests** on `/admin/smartlane`, filterable by type.
3. **Approve** fires the one Smartlane call (`business_services.approve_request`). If Smartlane
   rejects it, the row stays `pending_approval` so it can be retried. **Reject** needs a note the
   tenant sees.
4. Approve/reject are audit-logged via `core.rbac.write_audit_log`.

Store onboarding uses the same idea via the older `SmartlaneStoreLink` model
(`draft -> pending_approval -> in_review -> active`).

### Internal routes

- Super admin, under `/api/core/admin/smartlane/` (must stay under this prefix — the IP-allowlist
  middleware matches it): `config/`, `config/test/`, `stores/`, `stores/sync/`,
  `stores/<id>/approve|reject|warehouses|warehouses/provision`, `stores/browse/`, `activity-log/`,
  `requests/`, `requests/<id>/approve|reject`, `api-explorer/`, `couriers/`.
- Tenant, under `/api/integrations/oms-courier/`: (root = onboarding), `requests/`, `warehouses/`,
  `finance/`, `shipments/`. The shipments endpoint resolves `store_id` from the caller's own store
  link; it never accepts one from the request.

### Orders UI changes made along the way (display only, no data changes)

- Orders table: fixed column widths, ellipsis + hover tooltip on customer/product, `#` stripped
  from Store Order ID, status line under it removed, narrower ID columns, Date & Time without
  seconds on one line.
- Order detail: removed Country, Postal Code, Address 2, Agent ID, Customer Type, CNIC, Price
  Conversion Rate, Preferred Courier, Risk Status, Expected Delivery Date; removed Vendor, Barcode,
  Compare At Price; removed the Transaction Detail / Comments / Custom Message / Notes / Customer
  History tabs; removed the tax/donation/coupon/gift card/loyalty/wallet/express stitching/"You Owe
  Customer" tiles; both Edit buttons (order and line item) now show only for status `new`.
- `formatPakPhone` now turns a bare 10-digit `3xxxxxxxxx` into `03xxxxxxxxx`.

## Request bodies (confirmed against Smartlane's Postman collection, not the doc prose)

Field order matters: the HMAC covers `json_encode` output, so keep the order and send every key
(use `""` for empty).

**New KYC** — `name, logo_url, poc_name, poc_email, poc_phone, poc_cnic, platform, address, city,
state, industry, ntn, business_years, avg_order_value, avg_monthly_sale, annual_retail_sale`.
`platform` is `api` for us. `industry` must be one of Smartlane's own values (e.g. `Fashion`,
`Textile`, `Retail-Grocery`, `Cosmetics`, `Electronics`) or it 422s. The three money fields go as
strings.

**Warehouse** — `name, shipper_name, email, phone, address, area, city, service_type, zip_code,
auto_booking`. `service_type` is `overnight` or `overland`. Omit `code` on create so Smartlane
assigns one.

**Create consignment** — `{"store_warehouse_code": "...", "consignments": [{store_order_id,
consignee_name, consignee_email, consignee_phone, consignee_address, consignee_city, description,
payment_method ("cod"|"prepaid"), amount, product_count, weight (kg, string), products:[{sku,
name, qty}]}]}`. `store_order_id` is a bare number (no `#`, not quoted). The response confirms
acceptance only; the tracking number arrives later via webhook or `/track`. Builder:
`smartlane_client._build_consignment` (the doc says this API reuses the legacy body).

**Webhook** — `{"store_id": "...", "type": "...", "url": "..."}`; registering the same
store_id/type again updates it.

## Where Smartlane's real behaviour differs from the doc

- Store list path is `/store/list`, and `data` is a flat list with a `status` on each row — not the
  three `active` / `in_active` / `in_review` sections the doc describes. The old parser
  (`_iter_store_rows`) never matched, which also meant "Sync from Smartlane" saw zero stores; now
  fixed to read the flat shape (nested shape kept as fallback).
- The store-list `search` param is ignored by Smartlane; `list_all_stores` filters by name itself.
- Activity log requires `type`; the only value confirmed so far is `consignment_status`.
- Track, airway bill and load sheet are POST (doc says GET); shipper "advise" is spelled `advice`;
  airway bill path is `/airway/bill`.
- Finance info is `/finance/information` (doc says `/finance/application` for the GET).
- KYC needs `city`, `state`, `poc_cnic` (missing from the doc); warehouse uses `email`/`phone`, not
  `shipper_email`/`shipper_phone`.

## Known issues and gaps (most important first)

1. **Warehouse edit/revoke probably doesn't target the existing warehouse.**
   `_apply_warehouse_edit_request` builds a body without the warehouse's `code`
   (`SmartlaneStoreWarehouse.smartlane_warehouse_code`). The client docstring says edit/revoke must
   include `code` (and `status: "revoke"` for revoke); without it Smartlane will most likely create a
   new warehouse or reject. Add `code` to the body.
2. **Warehouse edit sends blanks.** The tenant edit form starts empty except the name, and unfilled
   fields go to Smartlane as `""`, which may overwrite real values. Prefill from the existing
   warehouse, or only send changed fields.
3. **Approve flows are untested against Smartlane** (webhook, warehouse edit/revoke, finance), and
   so is the whole tenant Shipments panel. Only browse, activity log (before the type fix) and the
   empty Requests list were seen working locally.
4. Backend deploy + production migration (see top).
5. Activity log `type` list is incomplete — get the full list from Smartlane and update the
   dropdown in `admin/smartlane/page.jsx`.
6. Webhook `type` is a free-text field because the valid values aren't known.
7. Webhook list (#6) has no UI; City list (#18) and Industries aren't wired into the KYC and
   warehouse forms (city is free text; industry goes through a small alias map in
   `business_services._INDUSTRY_ALIASES`).
8. The tenant KYC form doesn't show the courier checkboxes (`requested_offerings`) even though the
   backend returns the catalog, so orgs can't pick a courier there. The courier catalog CRUD
   (`admin/smartlane/couriers/`) has no frontend at all.
9. Business-API consignments aren't hooked into order booking; real bookings still go through the
   legacy client. Airway bill / load sheet / activity log / finance products render raw JSON, not
   PDFs or tables.
10. Finance: after approval we don't track Smartlane's own credit review (no status endpoint in the
    doc).
11. `SmartlaneBusinessConfig` stores client secret and auth token in plaintext (existing caveat).
12. Small leftovers: `requestsLoading` unused in the tenant OMS Courier page; `OrderDetailPanel`'s
    `EDITABLE_FIELDS` still lists fields whose inputs were removed (harmless).

## Working notes

- Backend checks used: `python manage.py check`, `python manage.py makemigrations --check`.
- Don't start dev servers or hit live endpoints from tooling; ask before any push.

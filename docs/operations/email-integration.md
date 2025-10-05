# Email Integration (Resend)

## Overview
Unity ERP currently sends supplier purchase order notifications through the [Resend](https://resend.com) transactional email service. The implementation focuses on the Purchasing domain and is anchored around a dedicated API route that renders React-based templates before dispatching mail. This document tracks all touchpoints, configuration, and operational expectations so the team can evolve the integration.

## Key Packages
- [`resend`](https://www.npmjs.com/package/resend) – official Node.js SDK used to send messages. Declared in `package.json` and installed at runtime on the API route.【F:package.json†L70-L84】【F:app/api/send-purchase-order-email/route.ts†L1-L148】
- [`@react-email/render`](https://react.email/docs/renderer/renderAsync) – converts the React email template into HTML within both the route handler and the utility helper.【F:lib/email.ts†L1-L25】【F:app/api/send-purchase-order-email/route.ts†L1-L148】
- [`@react-email/components`](https://react.email/docs/components) – UI primitives used to compose the purchase order template.【F:emails/purchase-order-email.tsx†L1-L118】

## Configuration & Environment
Set the following environment variables in every deployment target:
- `RESEND_API_KEY` – required by both the API route and the helper in `lib/email.ts` to authenticate with Resend.【F:lib/email.ts†L1-L31】【F:app/api/send-purchase-order-email/route.ts†L1-L148】
- `EMAIL_FROM` – optional override for the default sender address when dispatching purchase orders.【F:lib/email.ts†L16-L31】【F:app/api/send-purchase-order-email/route.ts†L132-L166】
- `COMPANY_NAME`, `COMPANY_LOGO`, `COMPANY_ADDRESS`, `COMPANY_PHONE` – optional branding fields embedded into outbound messages. Defaults are provided for local development but should be customized for production.【F:app/api/send-purchase-order-email/route.ts†L107-L144】【F:emails/purchase-order-email.tsx†L34-L118】

Ensure that the deployment surface where the API route runs supports secure storage of these secrets (e.g., Vercel/Netlify environment variables or Supabase Edge runtime config).

## Email Templates
All purchase order emails render through `emails/purchase-order-email.tsx`, a React component composed with Tailwind-compatible styling helpers. The template:
- Accepts supplier-specific line items and company metadata via `PurchaseOrderEmailProps`.
- Calculates totals and formats the created date within the component.
- Provides both HTML layout and default text content, with optional notes section when supplied.【F:emails/purchase-order-email.tsx†L18-L118】

A plain-text fallback is produced in `lib/email.ts` when using the helper function (see “Helper & Reuse” below).【F:lib/email.ts†L25-L65】

## Dispatch Flow (API Route)
`POST /api/send-purchase-order-email` orchestrates the full supplier notification workflow when a purchase order is approved in the UI.【F:app/api/send-purchase-order-email/route.ts†L1-L189】

1. **Supabase hydration** – Loads the purchase order, related supplier orders, and supplier metadata using the service-role key.
2. **Supplier resolution** – Groups supplier order lines, fetches the primary email from `supplier_emails`, and normalizes the payload for the template.
3. **Rendering** – Calls `renderAsync` to convert the template to HTML.
4. **Delivery** – Sends via `resend.emails.send`, populating the sender identity from environment variables.
5. **Result aggregation** – Returns a JSON payload summarizing success or per-supplier failures so the UI can surface status.

Any rendering or delivery errors are captured per supplier to prevent a single failure from blocking the rest of the batch.【F:app/api/send-purchase-order-email/route.ts†L43-L183】

### Trigger Point
The Purchasing detail page invokes the route after a PO is approved and a Q number assigned. It sends the purchase order ID in the request body and expects the aggregated results payload in response.【F:app/purchasing/purchase-orders/[id]/page.tsx†L201-L213】

## Helper & Reuse
`lib/email.ts` exports `sendPurchaseOrderEmail`, an abstraction for dispatching a single supplier email. It renders the same React template, sets a plain-text alternative, and exposes a `messageId` on success. While the current API route re-implements similar logic for batch sending, this helper remains available for future workflows or script-based usage.【F:lib/email.ts†L1-L65】

## Data Dependencies
- **Supabase tables:** `purchase_orders`, `supplier_orders`, `suppliercomponents`, `suppliers`, and `supplier_emails` must be populated with accurate supplier contact data for delivery to succeed.【F:app/api/send-purchase-order-email/route.ts†L23-L120】
- **Primary email flag:** The API expects a `supplier_emails.is_primary = true` entry for each supplier. Missing entries are reported in the API response so operations can follow up manually.【F:app/api/send-purchase-order-email/route.ts†L64-L102】

## Observability & Logging
Errors encountered while rendering or sending emails are logged to the server console from the route. Consider piping these logs into the central logging workflow described in `docs/operations/user-logging.md` to capture audit trails and reduce silent failures.【F:app/api/send-purchase-order-email/route.ts†L160-L183】【F:docs/operations/user-logging.md†L66-L132】

## Testing Checklist
1. Approve a purchase order from the Purchasing detail page to trigger the API route.
2. Verify the API response lists one entry per supplier with success state and `messageId` when available.
3. Inspect Resend’s dashboard to confirm delivery.
4. If running locally without real deliveries, use a test API key from Resend’s dashboard; emails will be dropped but the API still returns structured results.

## Open Questions / Next Steps
- Consolidate duplicate logic by reusing `lib/email.ts` inside the API route to reduce drift between the helper and production pathway.
- Expand to customer-facing notifications (quotes, order acknowledgements) once templates and workflows are defined.
- Hook route outcomes into the centralized logging/auditing queue for long-term traceability.

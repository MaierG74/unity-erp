# Email Integration (Resend)

## Overview
Unity ERP currently sends supplier purchase order notifications through the [Resend](https://resend.com) transactional email service. The implementation focuses on the Purchasing domain and is anchored around a dedicated API route that renders React-based templates before dispatching mail. This document tracks all touchpoints, configuration, and operational expectations so the team can evolve the integration.

## Key Packages
- [`resend`](https://www.npmjs.com/package/resend) – official Node.js SDK used to send messages. Declared in `package.json` and installed at runtime on the API route.【F:package.json†L70-L84】【F:app/api/send-purchase-order-email/route.ts†L1-L148】
- [`@react-email/render`](https://react.email/docs/renderer/renderAsync) – converts the React email template into HTML within both the route handler and the utility helper.【F:lib/email.ts†L1-L25】【F:app/api/send-purchase-order-email/route.ts†L1-L148】
- [`@react-email/components`](https://react.email/docs/components) – UI primitives used to compose the purchase order template.【F:emails/purchase-order-email.tsx†L1-L118】

## Configuration & Environment

### Required Environment Variables

Set the following environment variables in every deployment target:

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | **Yes** | API key from Resend dashboard for email authentication |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Service role key for server-side database access |
| `EMAIL_FROM` | **Yes** | Default verified sender email (e.g., `orders@qbutton.co.za`) |
| `EMAIL_FROM_ORDERS` | Recommended | Sender for supplier communications (e.g., `orders@qbutton.co.za`) |
| `EMAIL_FROM_SALES` | Recommended | Sender for customer communications (e.g., `sales@qbutton.co.za`) |
| `NEXT_PUBLIC_APP_URL` | **Yes** | Production URL for email links (e.g., `https://unity-erp.windsurf.build`) |
| `NEXT_PUBLIC_SUPABASE_LOGO_BUCKET` | No | Storage bucket for company logo. Defaults to `QButton` |
| `NEXT_PUBLIC_PO_EMAIL_CC` | No | Default CC list for purchasing notifications |

### Sender Address Configuration

Unity ERP supports separate sender addresses for different communication types:

| Variable | Use Case | Example |
|----------|----------|---------|
| `EMAIL_FROM_ORDERS` | Purchase orders, follow-ups, supplier returns | `orders@qbutton.co.za` |
| `EMAIL_FROM_SALES` | Customer quotes | `sales@qbutton.co.za` |

All email-sending code uses a fallback chain to maintain backward compatibility:
```typescript
// Supplier emails
const fromAddress = process.env.EMAIL_FROM_ORDERS || process.env.EMAIL_FROM || 'purchasing@example.com';

// Customer emails
const fromAddress = process.env.EMAIL_FROM_SALES || process.env.EMAIL_FROM || 'quotes@example.com';
```

### Production Configuration (Netlify)

All environment variables must be configured in Netlify for email functionality to work in production:

1. Go to **Site settings → Build & deploy → Environment → Environment variables**
2. Add each variable with appropriate values
3. Mark `RESEND_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` as **secrets**

See [`deployment-guide.md`](./deployment-guide.md) for complete Netlify configuration instructions.

### Important: Build-Time vs Runtime

The Resend client must be instantiated **inside request handlers**, not at module top-level. This prevents build-time errors when environment variables aren't available during Next.js static generation:

```typescript
// ❌ Bad - fails at build time
const resend = new Resend(process.env.RESEND_API_KEY);

// ✅ Good - runs only at request time
function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set');
  return new Resend(apiKey);
}
```

Branding details (company name, address, phone, website, supplier footer copy, logo path) live in the `quote_company_settings` table and are editable from `/settings`. Environment variables act strictly as fallbacks for local development or in the unlikely event the settings row is missing.

## Email Templates
All purchase order emails render through `emails/purchase-order-email.tsx`, a React component composed with Tailwind-compatible styling helpers. The supplier template now focuses on a clean header, a spacious zebra-striped line item table, and a branded footer (no customer-style summary card or terms block). Key traits:
- Accepts supplier-specific line items and company metadata via `PurchaseOrderEmailProps`.
- Pulls company name/logo/contact/website from `quote_company_settings` so the supplier view stays in lockstep with Settings branding.【F:app/api/send-purchase-order-email/route.ts†L58-L112】
- Calculates totals and formats the created date within the component.
- Widens the description column and increases row spacing so long product descriptions remain easy to scan in email clients.【F:emails/purchase-order-email.tsx†L18-L260】
- Omits the quote email's terms and order-summary blocks to keep the supplier version focused on actionable details.【F:emails/purchase-order-email.tsx†L18-L260】

A plain-text fallback is produced in `lib/email.ts` when using the helper function (see “Helper & Reuse” below).【F:lib/email.ts†L25-L65】

## Dispatch Flow (API Route)
`POST /api/send-purchase-order-email` orchestrates the full supplier notification workflow when a purchase order is approved in the UI.【F:app/api/send-purchase-order-email/route.ts†L1-L189】

1. **Supabase hydration** – Loads the purchase order, related supplier orders, and supplier metadata using the service-role key.
2. **Supplier resolution** – Groups supplier order lines, fetches the primary email from `supplier_emails` (falling back to any available contact or operator overrides from the dialog), and normalizes the payload for the template.
3. **Rendering** – Calls `renderAsync` to convert the template to HTML.
4. **Delivery** – Sends via `resend.emails.send`, populating the sender identity from environment variables.
5. **Result aggregation** – Returns a JSON payload summarizing success or per-supplier failures so the UI can surface status.

Any rendering or delivery errors are captured per supplier to prevent a single failure from blocking the rest of the batch.【F:app/api/send-purchase-order-email/route.ts†L43-L183】

### Trigger Point
The Purchasing detail page invokes the route after a PO is approved and a Q number assigned. It sends the purchase order ID in the request body and expects the aggregated results payload in response.【F:app/purchasing/purchase-orders/[id]/page.tsx†L201-L213】

### Manual Review & CC (UI)
- Once a PO is approved, the action bar exposes **Send Supplier Emails**, which opens `EmailOverrideDialog`. Users can review recipients, override addresses, and add CC contacts before dispatching.【F:app/purchasing/purchase-orders/[id]/page.tsx†L642-L1011】
- Sending requires every supplier to have an address; validation happens client-side and the API still reports per-supplier failures so toast feedback stays accurate.【F:app/purchasing/purchase-orders/[id]/page.tsx†L486-L575】【F:app/api/send-purchase-order-email/route.ts†L27-L173】

## Helper & Reuse
`lib/email.ts` exports `sendPurchaseOrderEmail`, an abstraction for dispatching a single supplier email. It renders the same React template, sets a plain-text alternative, and exposes a `messageId` on success. While the current API route re-implements similar logic for batch sending, this helper remains available for future workflows or script-based usage.【F:lib/email.ts†L1-L65】

## Data Dependencies
- **Supabase tables:** `purchase_orders`, `supplier_orders`, `suppliercomponents`, `suppliers`, and `supplier_emails` must be populated with accurate supplier contact data for delivery to succeed.【F:app/api/send-purchase-order-email/route.ts†L23-L120】
- **Supplier emails:** When `is_primary = true` is present we preselect that address; otherwise we fall back to any email on file or an operator override. Missing rows are still logged in the API response so ops can add the contact later.【F:app/api/send-purchase-order-email/route.ts†L44-L120】【F:app/purchasing/purchase-orders/[id]/EmailOverrideDialog.tsx†L1-L169】
- **Company branding:** `quote_company_settings` (Settings → Company) stores the logo path, address, phone, website, and default reply-to. The API reads this row on every send and only falls back to env values if it is missing.【F:app/api/send-purchase-order-email/route.ts†L58-L112】【F:app/settings/page.tsx†L1-L196】

## Observability & Logging
Errors encountered while rendering or sending emails are logged to the server console from the route. Consider piping these logs into the central logging workflow described in `docs/operations/user-logging.md` to capture audit trails and reduce silent failures.【F:app/api/send-purchase-order-email/route.ts†L160-L183】【F:docs/operations/user-logging.md†L66-L132】

## Testing Checklist
1. Approve a purchase order from the Purchasing detail page to trigger the API route.
2. Verify the API response lists one entry per supplier with success state and `messageId` when available.
3. Inspect Resend’s dashboard to confirm delivery.
4. If running locally without real deliveries, use a test API key from Resend’s dashboard; emails will be dropped but the API still returns structured results.

## Quote Email Integration (Planned)
Unity ERP will soon support emailing quote PDFs directly to customers from the quote detail page. This feature will leverage the existing Resend infrastructure and follow similar patterns to the purchase order email implementation.

**Planning Document**: See [`docs/plans/quote-email-plan.md`](../plans/quote-email-plan.md) for the complete implementation plan.

**Key Features**:
- Send quote PDF as email attachment to customer
- Professional HTML email template with quote summary
- Audit trail via `quote_email_log` table
- Server-side PDF generation for reliability
- Integration with company settings for branding

**New Components**:
- Email Template: `emails/quote-email.tsx`
- API Route: `app/api/quotes/[id]/send-email/route.ts`
- UI Dialog: `components/features/quotes/EmailQuoteDialog.tsx`

## Open Questions / Next Steps
- Consolidate duplicate logic by reusing `lib/email.ts` inside the API route to reduce drift between the helper and production pathway.
- **Implement quote email feature** – See [`docs/plans/quote-email-plan.md`](../plans/quote-email-plan.md) for detailed plan.
- Expand to additional customer-facing notifications (order acknowledgements, shipping notifications) once quote emails are stable.
- Hook route outcomes into the centralized logging/auditing queue for long-term traceability.

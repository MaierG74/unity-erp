# Email Migration to qbutton.co.za

**Date**: January 14, 2026
**Branch**: `january-email-migration` → merged to `January` → merged to `main`
**Commit**: `f5f7ffd feat: migrate email setup to qbutton.co.za with Resend`

## Overview

Migrated the Unity ERP email infrastructure from a test Resend account (using `@apexza.net` domain) to a production Resend account (using `@qbutton.co.za` domain). This migration also introduced separate sender addresses for supplier vs customer communications.

## Changes Summary

### Environment Variables

**Before:**
```env
RESEND_API_KEY=<REDACTED_OLD_KEY>
EMAIL_FROM=noreply@apexza.net
```

**After:**
```env
RESEND_API_KEY=<REDACTED>
EMAIL_FROM=orders@qbutton.co.za
EMAIL_FROM_ORDERS=orders@qbutton.co.za
EMAIL_FROM_SALES=sales@qbutton.co.za
```

### Sender Address Separation

| Email Type | Sender Address | Use Case |
|------------|----------------|----------|
| `EMAIL_FROM_ORDERS` | orders@qbutton.co.za | Purchase orders, follow-ups, supplier returns |
| `EMAIL_FROM_SALES` | sales@qbutton.co.za | Customer quotes |

All email-sending code now uses a fallback chain:
```typescript
const fromAddress = process.env.EMAIL_FROM_ORDERS || process.env.EMAIL_FROM || 'fallback@example.com';
```

### Files Modified

#### API Routes (Supplier Communications)
- [app/api/send-purchase-order-email/route.ts](../../app/api/send-purchase-order-email/route.ts) - Purchase order emails
- [app/api/send-follow-up-email/route.ts](../../app/api/send-follow-up-email/route.ts) - Follow-up emails
- [app/api/send-po-follow-up/route.ts](../../app/api/send-po-follow-up/route.ts) - PO follow-up emails
- [app/api/send-supplier-return-email/route.ts](../../app/api/send-supplier-return-email/route.ts) - Return notifications

#### API Routes (Customer Communications)
- [app/api/quotes/[id]/send-email/route.tsx](../../app/api/quotes/[id]/send-email/route.tsx) - Quote emails (added `companyLogo` and `companyWebsite` props)

#### Email Helper
- [lib/email.tsx](../../lib/email.tsx) - Updated both `sendPurchaseOrderEmail` and `sendQuoteEmail` functions

#### Email Templates
- [emails/quote-email.tsx](../../emails/quote-email.tsx) - Complete redesign (see below)

### Quote Email Template Redesign

The quote email template was completely redesigned based on user feedback:

**Previous Design:**
- Gradient blue header with quote badge
- Detailed summary table with all quote fields
- Blue accent colors throughout

**New Design:**
- Clean white header with company logo (top-left aligned)
- Subtle horizontal line separator
- Simple greeting and message text
- Black footer with company contact details
- Logo preserves aspect ratio (height: 50px, width: auto)

**Email Content:**
```
Dear [Customer Name],

Thank you for allowing us to quote. Please find attached our quotation for your review.

Please review the attached PDF and contact us if you need any adjustments.

Best regards,
[Company Name]
```

**Footer:**
- Company name (white text on black background)
- Address
- Phone number
- Email (clickable mailto: link)
- Website (clickable link, if configured)

### Quote Email Props Added

```typescript
export interface QuoteEmailProps {
  // ... existing props ...
  companyLogo?: string;    // NEW: Company logo URL
  companyWebsite?: string; // NEW: Company website URL
}
```

## Resend Domain Configuration

### qbutton.co.za Domain Verification

| Record Type | Status |
|-------------|--------|
| DKIM | Verified |
| SPF | Verified |
| DMARC | Verified |

With domain verification complete, emails can be sent from any address on the domain (e.g., `orders@`, `sales@`, `info@`) without pre-registering individual sender addresses.

## Deployment Steps

1. **Netlify Environment Variables** - Updated in Netlify dashboard:
   - `RESEND_API_KEY` - New API key from qbutton.co.za Resend account
   - `EMAIL_FROM` - Changed to `orders@qbutton.co.za`
   - `EMAIL_FROM_ORDERS` - Added: `orders@qbutton.co.za`
   - `EMAIL_FROM_SALES` - Added: `sales@qbutton.co.za`

2. **Local Development** - Updated `.env.local` with same values

3. **Code Changes** - Merged to `main` branch to trigger Netlify deployment

## Testing Performed

- Purchase order email sent successfully from `orders@qbutton.co.za`
- Quote email sent successfully from `sales@qbutton.co.za`
- Company logo displays correctly with proper aspect ratio
- Black footer renders correctly across email clients
- Custom message section displays properly

## Rollback Procedure

If issues arise, revert to test account:

1. **Netlify**: Restore previous environment variables
2. **Git**: `git revert f5f7ffd` or checkout previous commit
3. **Verify**: Test email sending functionality

## Related Documentation

- [Email Integration Guide](../operations/email-integration.md) - Updated with new configuration
- [Quote Email Implementation](../operations/quote-email-implementation.md) - Updated with template changes

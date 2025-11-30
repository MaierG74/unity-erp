# Quote Email Integration Plan

## Overview
Enable emailing quote PDFs directly to customers from the quote detail page. This feature will leverage the existing Resend email infrastructure (already used for purchase orders) and the existing Quote PDF generation system.

## Current State Analysis

### Existing Email Infrastructure
- **Email Provider**: Resend (configured with `RESEND_API_KEY`)
- **Email Library**: `lib/email.ts` with helper functions
- **Email Components**: `@react-email/components` for templated emails
- **Existing Template**: `emails/purchase-order-email.tsx` (purchase orders to suppliers)
- **API Route**: `/api/send-purchase-order-email` (POST) for batch supplier emails
- **Documentation**: `docs/operations/email-integration.md`

### Existing Quote PDF System
- **PDF Generator**: `components/quotes/QuotePDF.tsx` using `@react-pdf/renderer`
- **Features**:
  - Company branding (logo, address, phone, email from settings)
  - Line items with images and bullet points
  - Attachments (item-level and quote-level reference images)
  - Totals calculation (subtotal, VAT, grand total)
  - Terms & conditions
  - Multi-page support
- **Current Usage**: Download and "Open PDF" buttons on quote detail page
- **Company Info Source**: Loaded from `/api/settings` or defaults

### Quote Data Model
- **Tables**: `quotes`, `quote_items`, `quote_attachments`, `customers`
- **Customer Fields**: ✅ `id`, `name`, `email`, `telephone`, `contact` (email field exists in database, needs to be added to TypeScript types)
- **Quote Fields**: Includes `customer_id`, `quote_number`, `status`, `grand_total`
- **Quote Location**: `app/quotes/[id]/page.tsx` → `EnhancedQuoteEditor.tsx`

## Requirements

### Functional Requirements
1. **Email Quote PDF**: Send quote PDF as attachment to customer email
2. **Email Template**: Professional HTML email with quote summary
3. **Customer Email Validation**: Verify customer has valid email before sending
4. **Send Confirmation**: Show success/failure feedback to user
5. **Email Log**: Track when quotes were emailed (audit trail)
6. **PDF Attachment**: Attach the same PDF that users can download/preview
7. **Subject Line**: Clear subject with quote number
8. **Email Body**: Include company branding, quote summary, and professional message

### Non-Functional Requirements
1. **Reuse Infrastructure**: Leverage existing Resend setup
2. **Consistent Branding**: Use same company info as PDF
3. **Error Handling**: Graceful failures with clear user feedback
4. **Security**: Respect RLS policies, validate permissions
5. **Performance**: Generate PDF server-side to avoid browser limitations
6. **Logging**: Log email sends for compliance/audit

## Technical Architecture

### Component Overview
```
Quote Detail Page (EnhancedQuoteEditor.tsx)
    ↓ User clicks "Email Quote"
    ↓
API Route (/api/quotes/[id]/send-email)
    ↓ Fetches quote + customer data
    ↓ Generates PDF server-side
    ↓ Renders email template
    ↓ Sends via Resend with PDF attachment
    ↓
Email Template (emails/quote-email.tsx)
    ↓ Professional HTML email
    ↓
Customer Inbox ✉️
```

### Database Changes

#### 1. Customer Email Field ✅
**Status**: Already exists in database!

The `customers` table already has:
- `email TEXT`
- `telephone TEXT`
- `contact TEXT`

**Action Required**: Update TypeScript interface in `lib/db/customers.ts` to include these fields.

#### 2. Quote Email Log Table (Optional but Recommended)
```sql
-- Track email sends for audit trail
CREATE TABLE IF NOT EXISTS quote_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_by UUID REFERENCES auth.users(id),
  resend_message_id TEXT, -- Resend's message ID for tracking
  status TEXT NOT NULL DEFAULT 'sent', -- 'sent', 'failed', 'bounced'
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS policies for quote_email_log
ALTER TABLE quote_email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view quote email logs"
  ON quote_email_log FOR SELECT
  USING (true);

CREATE POLICY "Users can insert quote email logs"
  ON quote_email_log FOR INSERT
  WITH CHECK (true);
```

### API Implementation

#### New API Route: `/api/quotes/[id]/send-email/route.ts`

**Responsibilities:**
1. Validate quote exists and user has permission
2. Fetch customer email from database
3. Generate PDF server-side using `@react-pdf/renderer`
4. Render email template
5. Send email via Resend with PDF attachment
6. Log the email send
7. Return success/failure response

**Request Body:**
```typescript
{
  recipientEmail?: string; // Optional override (use customer email if not provided)
  ccEmails?: string[];     // Optional CC addresses
  includeAttachments?: boolean; // Include quote-level attachments (default: false)
  customMessage?: string;  // Optional custom message to append to email body
}
```

**Response:**
```typescript
{
  success: boolean;
  messageId?: string;      // Resend message ID
  error?: string;
}
```

**Implementation Pattern:**
- Follow structure from `app/api/send-purchase-order-email/route.ts`
- Use `@react-pdf/renderer` server-side (installed as dependency)
- Use `renderAsync` from `@react-email/render` for email template
- Attach PDF as base64-encoded attachment to Resend

### Email Template

#### New Template: `emails/quote-email.tsx`

**Props Interface:**
```typescript
interface QuoteEmailProps {
  quoteNumber: string;
  customerName: string;
  quoteDate: string;
  subtotal: number;
  vatAmount: number;
  grandTotal: number;
  itemCount: number;
  validityDays?: number;
  customMessage?: string;
  companyName?: string;
  companyLogo?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
}
```

**Email Structure:**
1. **Header**: Company logo and branding
2. **Greeting**: "Dear [Customer Name],"
3. **Opening**: "Please find attached our quotation for your review."
4. **Quote Summary Table**:
   - Quote Number
   - Date
   - Number of items
   - Total amount (with VAT)
5. **Custom Message**: Optional personalized message
6. **Validity Notice**: "This quotation is valid for 30 days from the date above."
7. **Call to Action**: "Please contact us if you have any questions."
8. **Footer**: Company contact information and copyright

**Styling**: Use `@react-email/components` with Tailwind support (same as purchase-order-email.tsx)

### UI Changes

#### Quote Detail Page (`EnhancedQuoteEditor.tsx`)

**Add Email Button:**
- Location: Near "Download PDF" and "Open PDF" buttons
- Icon: `Mail` or `Send` from `lucide-react`
- Label: "Email Quote"
- Behavior: Opens confirmation dialog before sending

**Email Dialog Component:**
```typescript
interface EmailQuoteDialogProps {
  quote: Quote & { customer?: Customer };
  onSend: (params: EmailSendParams) => Promise<void>;
}
```

**Dialog Fields:**
1. **To** (required): Pre-filled with customer email, editable
2. **CC** (optional): Additional recipients
3. **Message** (optional): Custom message to include in email
4. **Attachments** (checkbox): Include quote-level attachments (default: off)
5. **Preview PDF** (button): Open PDF preview before sending
6. **Send** (button): Send email with confirmation

**Validation:**
- Customer must have email address
- Email format validation
- Cannot send if quote has no items
- Cannot send if customer email is missing

**Success Flow:**
1. Show toast: "Quote emailed successfully to [email]"
2. Close dialog
3. Update UI to show "Last emailed" timestamp (optional)

**Error Flow:**
1. Show error toast with specific message
2. Keep dialog open for retry
3. Log error to console

### Library Dependencies

**New:**
```json
{
  "@react-pdf/renderer": "^3.x.x" // Already installed for Quote PDF
}
```

**Existing (Already Installed):**
```json
{
  "resend": "latest",
  "@react-email/components": "latest",
  "@react-email/render": "latest"
}
```

### Environment Variables

**Required (Already Configured):**
- `RESEND_API_KEY` – Resend API key for sending emails
- `EMAIL_FROM` – Default sender address (e.g., `quotes@unity-erp.com`)

**Optional (For Branding):**
- `COMPANY_NAME` – Company name for email footer
- `COMPANY_LOGO` – Public URL for company logo
- `COMPANY_ADDRESS` – Company address for footer
- `COMPANY_PHONE` – Company phone for footer

**Note:** These are already loaded from `/api/settings` for PDF generation, so we should reuse that pattern.

## Implementation Steps

### Phase 1: Database & Data Model ⚡ (Partially Complete)
1. ✅ **Customer Email Field**: Already exists in database (`customers.email`, `customers.telephone`, `customers.contact`)
2. **Migration**: Create `quote_email_log` table (optional but recommended for audit trail)
3. **Type Definitions**: Update `Customer` interface in `lib/db/customers.ts` to include `email`, `telephone`, and `contact` fields
4. **Database Functions**: Update `fetchQuoteWithCustomer` in `lib/db/quotes.ts` to include customer email in query

### Phase 2: Email Template
1. **Create Template**: `emails/quote-email.tsx` using React Email components
2. **Styling**: Match purchase order template style
3. **Plain Text**: Generate plain text version for email clients
4. **Testing**: Test template rendering with sample data

### Phase 3: API Route
1. **Create Route**: `app/api/quotes/[id]/send-email/route.ts`
2. **PDF Generation**: Implement server-side PDF generation using `@react-pdf/renderer`
3. **Email Rendering**: Render email template to HTML
4. **Resend Integration**: Send email with PDF attachment
5. **Error Handling**: Comprehensive error handling and logging
6. **Email Logging**: Insert record into `quote_email_log`
7. **Testing**: Test with real Resend test API key

### Phase 4: UI Components
1. **Email Dialog**: Create `components/features/quotes/EmailQuoteDialog.tsx`
2. **Form Validation**: Email format validation, required fields
3. **Button Integration**: Add "Email Quote" button to `EnhancedQuoteEditor.tsx`
4. **Toast Notifications**: Success and error feedback
5. **Loading States**: Show loading during email send
6. **Testing**: Test full user flow

### Phase 5: Helper Functions
1. **Email Helper**: Add `sendQuoteEmail` function to `lib/email.ts`
2. **Quote Helper**: Add `fetchQuoteWithCustomer` to `lib/db/quotes.ts`
3. **Validation**: Email format validation utilities
4. **Testing**: Unit tests for helpers

### Phase 6: Documentation & Testing
1. **Update Docs**: Add quote email section to `docs/operations/email-integration.md`
2. **Update Plan**: Document completion in `docs/plans/quoting-module-plan.md`
3. **README Update**: Link to new plan in `docs/README.md`
4. **Testing Checklist**: Comprehensive testing (below)

## Testing Checklist

### Unit Tests
- [ ] Email template renders correctly with all props
- [ ] Plain text version generates correctly
- [ ] PDF generates server-side without errors
- [ ] Email validation functions work correctly
- [ ] Database helpers fetch correct data

### Integration Tests
- [ ] API route handles valid requests
- [ ] API route validates permissions
- [ ] API route handles missing customer email
- [ ] API route logs email sends correctly
- [ ] Resend integration works (use test API key)
- [ ] PDF attachment is valid and opens correctly

### User Acceptance Tests
- [ ] Email button appears on quote detail page
- [ ] Click email button opens dialog
- [ ] Dialog pre-fills customer email correctly
- [ ] Dialog shows error if customer has no email
- [ ] Custom message field works
- [ ] Preview PDF button works
- [ ] Send button triggers email
- [ ] Success toast appears on successful send
- [ ] Error toast appears on failure
- [ ] Email log is created in database
- [ ] Received email looks professional
- [ ] PDF attachment opens correctly
- [ ] Email displays correctly in various clients (Gmail, Outlook, etc.)

### Edge Cases
- [ ] Quote with no customer
- [ ] Customer with no email address
- [ ] Invalid email format
- [ ] Very large quotes (many items/attachments)
- [ ] PDF generation fails
- [ ] Resend API error (rate limit, auth failure)
- [ ] Network timeout
- [ ] Quote with no items (should prevent send)
- [ ] Unicode characters in customer name/description

## Security Considerations

1. **RLS Policies**: Ensure users can only email quotes they have access to
2. **Email Validation**: Validate email format server-side
3. **Rate Limiting**: Consider rate limiting to prevent abuse
4. **Audit Trail**: Log all email sends with timestamp and sender
5. **Sensitive Data**: Do not log email content, only metadata
6. **API Key Security**: Ensure `RESEND_API_KEY` is not exposed client-side
7. **Customer Privacy**: Only send to customer email, validate consent

## Performance Considerations

1. **Server-Side PDF**: Generate PDF server-side to avoid browser memory limits
2. **Async Processing**: Consider queue for very large PDFs (future enhancement)
3. **Attachment Size**: Monitor PDF size, warn if >10MB
4. **Database Queries**: Optimize quote + customer fetch (single query if possible)
5. **Caching**: Cache company settings to avoid repeated API calls

## Open Questions & Decisions Needed

1. ✅ **Customer Email Field**: Does the `customers` table already have an `email` field?
   - **Answer**: Yes! The `customers` table already has `email`, `telephone`, and `contact` fields. Just need to update TypeScript interfaces.

2. **Email Logging**: Should we track email open/click events?
   - **Decision**: Start with send log only, add tracking later if needed

3. **Attachments**: Should we include quote-level attachments in the email?
   - **Decision**: Make it optional with checkbox (default: off to keep email size small)

4. **Approval Workflow**: Should quotes need approval before emailing?
   - **Decision**: No approval required initially, send from any status

5. **Multiple Recipients**: Support CC/BCC?
   - **Decision**: Support CC initially, BCC can be added later if needed

6. **Email Templates**: Support multiple templates (formal, casual)?
   - **Decision**: Single template initially, can add template selection later

7. **Reply-To**: Should emails have a reply-to address?
   - **Decision**: Use company email from settings as reply-to

## Success Metrics

1. **Adoption**: % of quotes emailed vs. downloaded
2. **Reliability**: Email send success rate (target: >99%)
3. **Speed**: Time from click to email sent (target: <5 seconds)
4. **User Feedback**: User satisfaction with email quality
5. **Error Rate**: Failed sends per week (target: <1%)

## Future Enhancements

1. **Email Scheduling**: Schedule quote emails for later
2. **Email Templates**: Multiple template options (formal, casual, branded)
3. **Follow-Up Reminders**: Remind to follow up if no response
4. **Email Tracking**: Track opens, clicks, downloads
5. **Bulk Email**: Email multiple quotes at once
6. **Quote Expiry**: Auto-email reminder before quote expires
7. **Customer Portal**: Link to customer portal to view/accept quote online
8. **E-Signature**: Integrate with DocuSign or similar for quote acceptance
9. **Internationalization**: Multi-language email templates
10. **Customizable Footer**: Per-user email signatures

## Related Documentation

- **Email Infrastructure**: [`docs/operations/email-integration.md`](../operations/email-integration.md)
- **Quoting Module**: [`docs/plans/quoting-module-plan.md`](quoting-module-plan.md)
- **Purchase Order Emails**: [`app/api/send-purchase-order-email/route.ts`](../../app/api/send-purchase-order-email/route.ts)
- **Email Template Example**: [`emails/purchase-order-email.tsx`](../../emails/purchase-order-email.tsx)

## Timeline Estimate

- **Phase 1 (Database)**: ~~1-2 hours~~ → **0.5-1 hour** ⚡ (Customer email field already exists! Just need TypeScript updates and optional email log table)
- **Phase 2 (Email Template)**: 2-3 hours
- **Phase 3 (API Route)**: 3-4 hours
- **Phase 4 (UI Components)**: 3-4 hours
- **Phase 5 (Helpers)**: 1-2 hours
- **Phase 6 (Documentation & Testing)**: 2-3 hours

**Total Estimated Time**: ~~12-18 hours~~ → **11-17 hours** (reduced due to existing customer email infrastructure)

## Notes

- Reuse as much as possible from purchase order email implementation
- Follow existing patterns in `docs/overview/STYLE_GUIDE.md` for UI components
- Ensure mobile responsiveness for email template
- Test email rendering across major email clients (Gmail, Outlook, Apple Mail)
- Consider adding "Send Test Email" option for admins to preview before sending to customer

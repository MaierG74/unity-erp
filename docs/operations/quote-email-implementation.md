# Quote Email Implementation Summary

## Overview
The quote email feature allows users to send quote PDFs directly to customers via email from the quote detail page. This implementation uses Resend for email delivery and React Email for templating.

**Status**: ✅ **Completed** (October 2025)

## Implementation Details

### Architecture

#### Client-Side PDF Generation
Unlike the original plan (which proposed server-side PDF generation), we generate PDFs **client-side** due to Next.js compatibility issues with `@react-pdf/renderer` in server components.

**Flow:**
```
Quote Detail Page (EnhancedQuoteEditor.tsx)
    ↓ User clicks "Email Quote"
    ↓
EmailQuoteDialog Component
    ↓ Generates PDF using @react-pdf/renderer (client-side)
    ↓ Converts PDF to base64
    ↓
API Route (/api/quotes/[id]/send-email)
    ↓ Receives base64 PDF
    ↓ Converts back to Buffer
    ↓ Renders email template
    ↓ Sends via Resend with PDF attachment
    ↓
Customer Inbox ✉️
```

### Key Components

#### 1. Email Dialog Component
**File**: [`components/features/quotes/EmailQuoteDialog.tsx`](../../components/features/quotes/EmailQuoteDialog.tsx)

**Features:**
- Pre-fills customer email from database
- Custom message field
- Email validation
- PDF preview button
- Client-side PDF generation using `@react-pdf/renderer`
- Converts PDF to base64 for transmission to API

**PDF Generation:**
```typescript
const pdfBlob = await pdf(
  <QuotePDFDocument quote={quote as any} companyInfo={companyInfo} />
).toBlob();

const pdfBuffer = await pdfBlob.arrayBuffer();
const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
```

#### 2. API Route
**File**: [`app/api/quotes/[id]/send-email/route.tsx`](../../app/api/quotes/[id]/send-email/route.tsx)

**Responsibilities:**
- Validates quote exists
- Fetches quote data with customer and items
- **Properly groups item attachments** (critical for images in PDF)
- Fetches company settings from `quote_company_settings` table
- Receives base64 PDF from client
- Converts base64 back to Buffer
- Renders email template
- Sends email via Resend with PDF attachment
- Logs send to `quote_email_log` table

**Important**: The API now properly structures item attachments by:
1. Fetching all attachments for the quote
2. Grouping attachments by scope (`quote` vs `item`)
3. Mapping item attachments to their respective items
4. This ensures product images appear in the emailed PDF

#### 3. Email Template
**File**: [`emails/quote-email.tsx`](../../emails/quote-email.tsx)

**Structure (Updated January 2026):**
- Clean white header with company logo (top-left aligned, preserves aspect ratio)
- Subtle horizontal line separator
- Simple greeting with customer name
- Brief thank-you message and call to action
- Custom message section (if provided)
- Black footer with company contact details

**Template Content:**
```
Dear [Customer Name],

Thank you for allowing us to quote. Please find attached our quotation for your review.

Please review the attached PDF and contact us if you need any adjustments.

Best regards,
[Company Name]
```

**Styling:**
- Uses inline styles (not Tailwind classes) for email compatibility
- Minimalist color scheme (white background, black footer)
- Logo height fixed at 50px with auto width to preserve aspect ratio
- Mobile-responsive layout

**Props Added (January 2026):**
```typescript
export interface QuoteEmailProps {
  // ... existing props ...
  companyLogo?: string;    // Company logo URL from settings
  companyWebsite?: string; // Company website URL from settings
}
```

#### 4. PDF Document Component
**File**: [`components/quotes/QuotePDF.tsx`](../../components/quotes/QuotePDF.tsx) (default export `QuotePDFDocument`)

**Features:**
- Company branding (logo, contact info)
- Line items with product images
- Bullet points for item specifications
- Quote-level reference images
- Totals calculation
- Terms & conditions
- Multi-page support
- Line item header row keeps **Description / Qty / Unit Price / Total Excl VAT** aligned on the same row as the item name
- Images and bullet specs render on a dedicated detail row underneath the header row

### Consistency Across Preview, Download, and Email
The PDF render is shared across all three actions:
- **Preview PDF**: Uses `QuotePDFDownload` to generate a PDF blob in the browser and open it in a new tab.
- **Download PDF**: Uses the same `QuotePDFDownload` renderer, then saves via the File System Access API (or a browser download fallback).
- **Email Quote**: Uses the same `QuotePDFDocument` component (imported from `components/quotes/QuotePDF.tsx`) to generate the attachment.

### Database

#### Quote Email Log Table
**Migration**: [`migrations/20251005_quote_email_log.sql`](../../migrations/20251005_quote_email_log.sql)

```sql
CREATE TABLE IF NOT EXISTS quote_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_by UUID REFERENCES auth.users(id),
  resend_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Purpose**: Audit trail for all quote emails sent

#### Company Settings Table
**Table**: `quote_company_settings`

The API fetches company information from this table (setting_id = 1):
- `company_name`
- `company_logo_path` (converted to public URL)
- `address_line1`, `address_line2`, `city`, `postal_code`, `country`
- `phone`
- `email`

This ensures emails always use current company branding.

### Environment Variables

**Required:**
```env
RESEND_API_KEY=re_xxxxxxxxxxxxx
EMAIL_FROM=orders@qbutton.co.za
EMAIL_FROM_ORDERS=orders@qbutton.co.za
EMAIL_FROM_SALES=sales@qbutton.co.za
```

**Email Provider**: Resend
- Production domain: `qbutton.co.za` (verified with DKIM, SPF, DMARC)

**Sender Addresses:**
- Supplier emails (purchase orders, follow-ups, returns): `orders@qbutton.co.za`
- Customer emails (quotes): `sales@qbutton.co.za`

**DNS Configuration** (for apexza.net):
- MX record: `send` → `feedback-smtp.eu-west-1.amazonses.com` (Priority 10)
- SPF: `send` → `v=spf1 include:amazonses.com ~all`
- DKIM: `resend._domainkey` → (Resend-provided public key)
- DMARC: `_dmarc` → `v=DMARC1; p=none;`

### API Endpoints

#### POST `/api/quotes/[id]/send-email`

**Request Body:**
```typescript
{
  recipientEmail?: string;  // Optional override (uses customer email if not provided)
  customMessage?: string;   // Optional custom message for email body
  pdfBase64: string;        // Base64-encoded PDF from client
  pdfFilename: string;      // Filename for PDF attachment
}
```

**Response:**
```typescript
{
  success: boolean;
  messageId?: string;       // Resend message ID
  recipient: string;        // Email address used
  message: string;          // Success message
  error?: string;           // Error message if failed
  details?: string;         // Error details
}
```

#### GET `/api/quotes/[id]`

**Enhanced to include item attachments:**
- Fetches quote with customer and items
- **Groups attachments by scope and item_id**
- Attaches item-specific attachments to each item object
- Returns quote-level attachments separately

This change ensures product images are properly included in PDFs.

### Integration with UI

#### Quote Detail Page
**File**: [`components/quotes/EnhancedQuoteEditor.tsx`](../../components/quotes/EnhancedQuoteEditor.tsx)

**Email Button:**
- Icon: `Mail` (lucide-react)
- Label: "Email Quote"
- Location: Near PDF download/preview buttons
- Opens `EmailQuoteDialog` on click

**Company Info Loading:**
- Fetches from `/api/settings` on component mount
- Builds company info object with logo URL
- Passes to email dialog and PDF components

**Success Feedback:**
```typescript
toast({
  title: 'Email sent successfully',
  description: `Quote ${quote.quote_number} has been emailed to ${customerEmail}.`,
});
```

### Email Helper Function
**File**: [`lib/email.tsx`](../../lib/email.tsx)

**Function**: `sendQuoteEmail()`

**Parameters:**
```typescript
sendQuoteEmail(
  customerEmail: string,
  data: QuoteEmailProps,
  pdfAttachment?: { content: Buffer | string; filename: string }
): Promise<{ success: boolean; messageId?: string }>
```

**Features:**
- Renders email template to HTML
- Generates plain text version
- Attaches PDF if provided
- Sets reply-to to company email
- Returns Resend message ID for tracking

## Technical Decisions

### Why Client-Side PDF Generation?

**Problem**: `@react-pdf/renderer` doesn't work in Next.js server components or API routes due to how it handles React components.

**Error**: `TypeError: a.Component is not a constructor`

**Attempted Solutions:**
1. ❌ Created separate server-only PDF component
2. ❌ Used `React.createElement()` instead of JSX
3. ❌ Renamed route from `.ts` to `.tsx`

**Final Solution**: ✅ Generate PDF client-side, convert to base64, send to API

**Benefits:**
- Works reliably with `@react-pdf/renderer`
- Keeps API route simple
- Allows PDF preview in browser before sending
- No server-side rendering complexity

**Trade-offs:**
- Slightly larger request payload (base64 encoded PDF)
- PDF generation happens in user's browser (but modern browsers handle this fine)

### Why Inline Styles in Email Template?

Email clients have limited CSS support. Inline styles ensure consistent rendering across:
- Gmail (web, mobile)
- Outlook (desktop, web)
- Apple Mail
- Other clients

We use `style={{ ... }}` instead of Tailwind classes for maximum compatibility.

### Why Separate Settings Table?

The API fetches from `quote_company_settings` table (not the generic `settings` table which uses key-value pairs):
- Simpler queries (column-based vs JSONB)
- Better TypeScript support
- Dedicated to quote/document branding
- Easy to extend with quote-specific settings

### Why Convert Images to Base64?

**Problem**: `@react-pdf/renderer` has trouble loading external images from URLs when generating PDFs. Images would appear in the app's PDF preview but not in emailed PDFs.

**Solution**: Convert all product images to base64 data URLs before PDF generation.

**How it works:**
1. Before generating the PDF, fetch each image URL
2. Convert the blob to a base64 data URL using FileReader
3. Replace the Supabase URL with the base64 string in the quote data
4. Generate the PDF with embedded base64 images

**Benefits:**
- ✅ Images are guaranteed to be included in the PDF
- ✅ No dependency on external URLs being accessible during PDF rendering
- ✅ Works offline once images are fetched
- ✅ No CORS issues
- ✅ Consistent with best practices for PDF image embedding

**Code:**
```typescript
const imageUrlToBase64 = async (url: string): Promise<string> => {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
};

// Convert all item images
for (const item of quoteWithBase64Images.items) {
  if (item.attachments) {
    for (const attachment of item.attachments) {
      if (attachment.file_url && attachment.mime_type?.startsWith('image/')) {
        attachment.file_url = await imageUrlToBase64(attachment.file_url);
      }
    }
  }
}
```

### Why Text-Only Email Branding?

**Problem**: Company logo image in email triggered Gmail's "suspicious images" warning and sometimes didn't render.

**Solution**: Use text-only branding in the email template (company name as heading, contact info in footer).

**Benefits:**
- ✅ No Gmail image warnings
- ✅ Faster email rendering
- ✅ Better accessibility
- ✅ Consistent rendering across all email clients
- ✅ Smaller email size

The PDF still includes the company logo - only the email HTML uses text.

## Testing

### Manual Testing Performed
✅ Email sent successfully with PDF attachment
✅ Company information from settings appears correctly
✅ Product images appear in emailed PDF (base64 embedded)
✅ Email template renders correctly in Gmail (text-only branding)
✅ Custom message displays in highlighted section
✅ Quote summary shows accurate totals
✅ Database logging works (quote_email_log)
✅ Domain verification successful (apexza.net)
✅ No Gmail image warnings (text-only email)

### Known Issues & Resolutions

#### Issue 1: Missing RESEND_API_KEY
**Error**: 500 Internal Server Error
**Fix**: Added API key to `.env.local` and restarted dev server

#### Issue 2: Email Bounced (Domain Not Verified)
**Error**: Email sent but bounced
**Cause**: Using `onboarding@resend.dev` test domain (only sends to verified addresses)
**Fix**: Verified `apexza.net` domain with DNS records, updated `EMAIL_FROM`

#### Issue 3: Product Images Missing from Emailed PDF
**Error**: Images appear in app PDF preview but not in emailed PDF
**Root Cause**: Multiple issues combined:
1. API routes used wrong column name (`item_id` instead of `quote_item_id`)
2. EnhancedQuoteEditor wasn't flattening nested attachments into state
3. Images weren't being converted to base64 before PDF generation

**Final Solution**:

1. **API Routes** - Fixed column name ([route.ts:49](../../app/api/quotes/[id]/route.ts#L49), [route.tsx:57](../../app/api/quotes/[id]/send-email/route.tsx#L57)):
   ```typescript
   // Changed from att.item_id to att.quote_item_id
   allAttachments.filter((att: any) => att.scope === 'item' && att.quote_item_id)
   ```

2. **EnhancedQuoteEditor** - Flatten attachments ([EnhancedQuoteEditor.tsx:140-146](../../components/quotes/EnhancedQuoteEditor.tsx#L140-L146)):
   ```typescript
   const allAttachments = [
     ...(quoteData.attachments || []), // Quote-level
     ...(quoteData.items || []).flatMap((item: any) => item.attachments || []) // Item-level
   ];
   setAttachments(allAttachments);
   ```

3. **EmailQuoteDialog** - Convert images to base64 ([EmailQuoteDialog.tsx:52-67](../../components/features/quotes/EmailQuoteDialog.tsx#L52-L67)):
   ```typescript
   const imageUrlToBase64 = async (url: string): Promise<string> => {
     const response = await fetch(url);
     const blob = await response.blob();
     return new Promise((resolve, reject) => {
       const reader = new FileReader();
       reader.onloadend = () => resolve(reader.result as string);
       reader.readAsDataURL(blob);
     });
   };
   ```

4. **EnhancedQuoteEditor** - Correct filtering ([EnhancedQuoteEditor.tsx:545](../../components/quotes/EnhancedQuoteEditor.tsx#L545)):
   ```typescript
   attachments.filter((att) => att.scope === 'item' && att.quote_item_id === item.id)
   ```

#### Issue 4: Company Settings Not Showing in Email
**Error**: Email showed placeholder text ("Unity ERP", "Your Business Address")
**Cause**: API route was querying wrong table (`settings` instead of `quote_company_settings`)
**Fix**: Changed query to `quote_company_settings` with `setting_id = 1` ([route.tsx:93-96](../../app/api/quotes/[id]/send-email/route.tsx#L93-L96))

#### Issue 5: Gmail Image Warning and Logo Not Showing
**Error**: Gmail showed "suspicious images" warning, company logo didn't render
**Cause**: External image URLs in email HTML can trigger spam filters
**Fix**: Removed company logo from email template, using text-only branding instead ([quote-email.tsx:67-72](../../emails/quote-email.tsx#L67-L72))

## Future Enhancements

### Potential Improvements
1. **Email Scheduling**: Allow scheduling quote emails for later
2. **Email Templates**: Multiple template options (formal, casual, minimal)
3. **Email Tracking**: Track opens, clicks (Resend supports this)
4. **Bulk Email**: Send multiple quotes at once
5. **Email History**: Show list of sent emails in quote detail page
6. **Resend on Failure**: Automatic retry mechanism
7. **CC/BCC Support**: Add CC/BCC fields to dialog
8. **Attachment Options**: Include quote-level attachments (reference images)
9. **Preview Email**: Show email preview before sending (not just PDF)
10. **Custom From Name**: Allow per-user email signatures

### Performance Optimizations
1. **Caching**: Cache company settings to reduce API calls
2. **Compression**: Compress large PDFs before base64 encoding
3. **Background Jobs**: Queue email sends for very large PDFs
4. **Rate Limiting**: Prevent email spam/abuse

## Related Documentation

- **Planning Document**: [`docs/plans/quote-email-plan.md`](../plans/quote-email-plan.md)
- **Email Integration Guide**: [`docs/operations/email-integration.md`](email-integration.md)
- **Quoting Module Plan**: [`docs/plans/quoting-module-plan.md`](../plans/quoting-module-plan.md)

## Summary

The quote email feature is fully functional and production-ready. Key achievements:

✅ Email integration with Resend
✅ Professional email template with company branding (redesigned January 2026)
✅ Client-side PDF generation (with product images)
✅ Database audit logging
✅ Domain verification for production use (qbutton.co.za)
✅ Error handling and user feedback
✅ Company settings integration
✅ Separate sender addresses (orders@ vs sales@)
✅ Company logo with preserved aspect ratio
✅ Clean minimalist email design

**Total Implementation Time**: ~8 hours (initial), ~2 hours (January 2026 redesign)

**Last Updated**: January 14, 2026

## Changelog

- **January 14, 2026**: Migrated to qbutton.co.za domain, added separate sender addresses (EMAIL_FROM_ORDERS, EMAIL_FROM_SALES), redesigned email template to clean white header with logo and black footer. See [email-migration-qbutton-20260114.md](../changelogs/email-migration-qbutton-20260114.md).
- **October 6, 2025**: Initial implementation with apexza.net domain.

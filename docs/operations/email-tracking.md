# Email Delivery Tracking & Monitoring

## Overview

Unity ERP now tracks email delivery status for all sent emails (Purchase Orders and Quotes) via Resend webhook integration. The system provides real-time delivery status updates, bounce notifications, and a global notification indicator for failed deliveries.

This document covers the complete implementation, configuration, troubleshooting, and next steps.

## Features

### 1. Real-Time Delivery Tracking
- Tracks email lifecycle events: `sent` → `delivered` → `opened` → `clicked`
- Captures failed delivery events: `bounced`, `complained` (spam reports)
- Stores detailed bounce/complaint reasons for troubleshooting
- Auto-refreshes status every 30 seconds on detail pages

### 2. Email Activity Cards
Reusable component displays email history with:
- Visual status badges (Sent, Delivered, Bounced, Opened)
- Expandable event timeline with timestamps
- Alert banners for delivery issues
- Links to view detailed error messages

### 3. Global Notification System
Navbar indicator shows:
- Badge count of bounced/failed emails
- Dropdown with issue details and timestamps
- Direct links to affected POs/Quotes
- Dismiss functionality (session-based)
- Auto-refresh every 60 seconds

## Architecture

### Database Schema

**`email_events` Table** - Stores all webhook events from Resend:
```sql
CREATE TABLE IF NOT EXISTS email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resend_email_id TEXT NOT NULL,
  resend_event_id TEXT,
  event_type TEXT NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recipient_email TEXT NOT NULL,
  subject TEXT,
  purchase_order_id BIGINT REFERENCES purchase_orders(purchase_order_id),
  quote_id UUID REFERENCES quotes(id),
  bounce_type TEXT,
  bounce_message TEXT,
  complaint_type TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Enhanced Email Log Tables** - Added delivery tracking columns:
- `purchase_order_email_log`: Added `delivery_status`, `delivered_at`, `bounced_at`, `bounce_reason`, `opened_at`, `clicked_at`
- `quote_email_log`: Same columns added for quote email tracking

### API Routes

**Webhook Endpoint**: [app/api/webhooks/resend/route.ts](../../app/api/webhooks/resend/route.ts)
- Receives webhook events from Resend
- Validates payload and maps event types
- Stores events in `email_events` table
- Updates delivery status in email log tables
- Links events to purchase orders or quotes via Resend email ID

**Status Endpoints**:
- [app/api/email-status/purchase-orders/[id]/route.ts](../../app/api/email-status/purchase-orders/[id]/route.ts)
- [app/api/email-status/quotes/[id]/route.ts](../../app/api/email-status/quotes/[id]/route.ts)

Both endpoints return enriched email data including:
- Email log entries with delivery status
- Associated events from `email_events`
- Aggregated status flags (delivered, bounced, opened)

**Issues Endpoint**: [app/api/email-issues/route.ts](../../app/api/email-issues/route.ts)
- Fetches recent bounced/complained emails (last 7 days)
- Powers the global notification indicator
- Returns up to 20 most recent issues

### UI Components

**EmailActivityCard**: [components/features/emails/EmailActivityCard.tsx](../../components/features/emails/EmailActivityCard.tsx)
- Reusable component for PO and Quote pages
- Shows email history with status badges
- Expandable event timeline
- Alert banners for bounced emails
- Auto-refresh with React Query

**EmailIssuesIndicator**: [components/features/emails/EmailIssuesIndicator.tsx](../../components/features/emails/EmailIssuesIndicator.tsx)
- Global navbar notification
- Badge count with popover
- Dismissible issue list
- Session-based dismiss tracking

### Integration Points

**Purchase Order Page**: [app/purchasing/purchase-orders/[id]/page.tsx](../../app/purchasing/purchase-orders/[id]/page.tsx)
- EmailActivityCard added to main content area
- Shows all sent PO emails with delivery status
- Alerts for bounced supplier emails

**Quote Editor**: [components/quotes/EnhancedQuoteEditor.tsx](../../components/quotes/EnhancedQuoteEditor.tsx)
- EmailActivityCard added to Quote Details tab
- Shows all sent quote emails with delivery status
- Alerts for bounced customer emails

**Navbar**: [components/layout/navbar.tsx](../../components/layout/navbar.tsx)
- EmailIssuesIndicator added between Admin link and ThemeToggle
- Visible to all authenticated users

## Configuration

### Required Environment Variables

No new environment variables are required. The system uses existing Resend and Supabase configuration.

Optional (recommended for production):
- `RESEND_WEBHOOK_SECRET` - For webhook signature verification (future enhancement)

### Resend Webhook Configuration

**CRITICAL SETUP STEP**: Configure webhook in Resend dashboard:

1. Log in to [Resend Dashboard](https://resend.com/dashboard)
2. Navigate to **Webhooks** section
3. Click **Add Endpoint**
4. Configure:
   - **URL**: `https://your-domain.com/api/webhooks/resend`
   - **Events**: Select all email events:
     - `email.sent`
     - `email.delivered`
     - `email.bounced`
     - `email.complained`
     - `email.opened`
     - `email.clicked`
5. Save the webhook

**Production URL Examples**:
- Netlify: `https://unity-erp.windsurf.build/api/webhooks/resend`
- Custom domain: `https://yourdomain.com/api/webhooks/resend`

**Local Development**:
For local testing, use a tool like [ngrok](https://ngrok.com/) or [Resend's webhook testing](https://resend.com/docs/api-reference/webhooks/test-webhook):
```bash
ngrok http 3000
# Use: https://your-ngrok-url.ngrok.io/api/webhooks/resend
```

### Database Migration

Migration already applied: `db/migrations/20260114_email_tracking.sql`

If running in a new environment:
```bash
# Apply via Cursor AI or psql
psql -h your-supabase-host -U postgres -d postgres -f db/migrations/20260114_email_tracking.sql
```

## Resend Webhook Events

### Event Types

| Resend Event | Mapped Type | Description |
|--------------|-------------|-------------|
| `email.sent` | `sent` | Email accepted by Resend |
| `email.delivered` | `delivered` | Email delivered to recipient's inbox |
| `email.delivery_delayed` | `sent` | Temporary delay (mapped to sent) |
| `email.bounced` | `bounced` | Email rejected by recipient server |
| `email.complained` | `complained` | Recipient marked as spam |
| `email.opened` | `opened` | Recipient opened the email |
| `email.clicked` | `clicked` | Recipient clicked a link |

### Webhook Payload Example

```json
{
  "type": "email.bounced",
  "created_at": "2026-01-16T10:30:00.000Z",
  "data": {
    "email_id": "re_abc123xyz",
    "from": "orders@qbutton.co.za",
    "to": ["supplier@example.com"],
    "subject": "Purchase Order Q1234",
    "bounced_at": "2026-01-16T10:30:00.000Z",
    "bounce": {
      "type": "hard",
      "message": "550 5.1.1 User unknown"
    }
  }
}
```

## Usage

### Viewing Email Status

**Purchase Orders**:
1. Navigate to Purchase Order detail page
2. Email Activity Card displays below the main content
3. View status badges: Sent, Delivered, Bounced, Opened
4. Click "Show details" to expand event timeline
5. Bounced emails show alert with reason

**Quotes**:
1. Open quote in editor
2. Go to "Quote Details" tab
3. Email Activity Card shows at bottom of tab
4. Same functionality as PO emails

**Global Notifications**:
1. Check navbar for mail icon with badge
2. Click to view recent issues
3. Click issue to navigate to affected PO/Quote
4. Dismiss individual issues or all at once

### Understanding Delivery Status

**Status Flow (Normal)**:
```
Sent → Delivered → Opened → Clicked
```

**Status Flow (Failure)**:
```
Sent → Bounced (hard bounce - permanent failure)
Sent → Complained (marked as spam)
```

**Status Meanings**:
- **Sent**: Resend accepted and queued the email
- **Delivered**: Email successfully delivered to recipient's mail server
- **Bounced**: Email rejected (bad address, full mailbox, spam filter)
- **Complained**: Recipient marked email as spam
- **Opened**: Recipient opened the email (tracked via pixel)
- **Clicked**: Recipient clicked a link in the email

## Troubleshooting

### Webhook Not Receiving Events

**Symptom**: Emails sent but status stays "Sent", no delivery updates.

**Checks**:
1. Verify webhook configured in Resend dashboard
2. Check webhook URL is correct and accessible
3. Test webhook endpoint manually:
   ```bash
   curl -X POST https://your-domain.com/api/webhooks/resend \
     -H "Content-Type: application/json" \
     -d '{"type":"email.sent","data":{"email_id":"test123"}}'
   ```
4. Check Next.js logs for webhook errors
5. Verify API route is deployed (not in draft branch)

### Emails Show as Bounced

**Hard Bounce** (Permanent):
- Invalid email address
- Domain doesn't exist
- Recipient account deleted

**Soft Bounce** (Temporary):
- Mailbox full
- Server temporarily unavailable
- Email too large

**Actions**:
1. Verify email address with supplier/customer
2. Update contact info in system
3. For soft bounces, try resending later
4. For hard bounces, contact customer/supplier via phone

### Missing Email History

**Symptom**: EmailActivityCard shows "No emails sent yet" but emails were sent.

**Causes**:
1. Emails sent before tracking system deployed
2. `resend_email_id` not stored in email log
3. Email log entry missing

**Resolution**:
- Only emails sent after webhook configuration will have tracking
- Historical emails will not have delivery status
- Verify `resend_email_id` stored when sending new emails

### Global Notification Not Showing

**Checks**:
1. Verify user is authenticated
2. Check recent bounced emails exist (last 7 days)
3. Open browser console for errors
4. Verify API endpoint accessible: `/api/email-issues`
5. Check React Query is configured properly

## Data Retention

**Current Policy**:
- `email_events`: No automatic cleanup (manual purge if needed)
- `purchase_order_email_log`: Permanent retention
- `quote_email_log`: Permanent retention

**Future Enhancement**:
Consider adding automatic cleanup for old events (e.g., purge events older than 90 days).

## Performance Considerations

**Auto-Refresh Intervals**:
- EmailActivityCard: 30 seconds
- EmailIssuesIndicator: 60 seconds

**Optimization Notes**:
- API queries limited to 20 most recent issues
- React Query caching reduces redundant requests
- Indexes on `resend_email_id` for fast lookups

## Security

**Webhook Security** (Future Enhancement):
- Add `RESEND_WEBHOOK_SECRET` verification
- Validate webhook signature using Resend SDK
- Reject unsigned webhook requests

**Current State**:
- Webhook endpoint is public (accepts all requests)
- Consider adding IP allowlist for Resend's webhook IPs
- Service role key protects database writes

## Testing

### Manual Testing Checklist

**Purchase Order Email Tracking**:
- [ ] Approve and send PO to supplier
- [ ] Verify `resend_email_id` stored in `purchase_order_email_log`
- [ ] Wait for webhook events (sent, delivered)
- [ ] Check EmailActivityCard shows correct status
- [ ] Verify event timeline displays properly

**Quote Email Tracking**:
- [ ] Send quote email to customer
- [ ] Verify `resend_email_id` stored in `quote_email_log`
- [ ] Wait for webhook events
- [ ] Check EmailActivityCard in Quote Details tab
- [ ] Verify status updates correctly

**Bounce Handling**:
- [ ] Send email to invalid address (test@invalid-domain-xyz.com)
- [ ] Wait for bounce webhook event
- [ ] Verify EmailActivityCard shows bounce alert
- [ ] Check global notification indicator appears
- [ ] Click notification to view bounce details

**Global Notifications**:
- [ ] Create multiple bounced emails
- [ ] Check badge count in navbar
- [ ] Open popover to view issues
- [ ] Click issue link to navigate to PO/Quote
- [ ] Dismiss individual issue
- [ ] Dismiss all issues

### Webhook Testing

Use Resend's test webhook feature:
1. Go to Resend Dashboard → Webhooks → Your endpoint
2. Click "Test" button
3. Send sample events: sent, delivered, bounced
4. Verify events appear in database
5. Check UI updates accordingly

## Known Limitations

1. **Historical Emails**: Only tracks emails sent after implementation (no retroactive tracking)
2. **Open/Click Tracking**: Requires HTML emails with tracking pixels (already implemented)
3. **Webhook Reliability**: Depends on Resend webhook delivery (no retry mechanism)
4. **Dismiss Persistence**: Issue dismissals are session-based (cleared on logout)

## Next Steps

### Immediate (Required for Production)

1. **Configure Resend Webhook** ⚠️ CRITICAL
   - Add webhook URL in Resend dashboard
   - Enable all email events
   - Test webhook delivery

2. **Test in Production**
   - Send test PO to verified email
   - Send test quote to customer
   - Verify webhook events received
   - Check global notifications work

### Short-Term Enhancements

1. **Webhook Security**
   - Add `RESEND_WEBHOOK_SECRET` environment variable
   - Implement signature verification
   - Reject unsigned requests

2. **Persistent Dismiss**
   - Store dismissed issues in localStorage or database
   - Add "Mark as resolved" option
   - Track who dismissed what (audit trail)

3. **Email Retry Logic**
   - Add "Resend Email" button for failed deliveries
   - Implement automatic retry for soft bounces
   - Track retry attempts

4. **Enhanced Notifications**
   - Email/Slack alerts for bounced POs/Quotes
   - Daily digest of email issues
   - Bounce rate monitoring dashboard

### Medium-Term Improvements

1. **Analytics Dashboard**
   - Delivery rate metrics (delivered / sent)
   - Bounce rate by supplier/customer
   - Open rate tracking for quotes
   - Click-through rates on quote links

2. **Automated Follow-ups**
   - Remind if quote not opened after X days
   - Alert if PO not delivered after 24 hours
   - Escalation for repeated bounces

3. **Email Validation**
   - Pre-send email address validation
   - Warn about known bad addresses
   - Suggest corrections for typos

4. **Data Retention Policy**
   - Implement automatic cleanup (90+ days old)
   - Archive old events to separate table
   - Keep recent events hot, archive old events cold

### Long-Term Vision

1. **Advanced Tracking**
   - Track PDF downloads from emails
   - Monitor time spent viewing PDFs
   - A/B test email templates

2. **Customer Engagement Scoring**
   - Score customers by email engagement
   - Identify hot leads (opened quote multiple times)
   - Flag unresponsive customers

3. **Supplier Communication Health**
   - Track supplier response times
   - Identify problematic email addresses
   - Recommend preferred contact methods

## Related Documentation

- [Email Integration (Resend)](./email-integration.md) - Core email sending setup
- [Quote Email Implementation](./quote-email-implementation.md) - Quote email feature
- [Deployment Guide](./deployment-guide.md) - Production deployment
- [Email Migration Changelog](../changelogs/email-migration-qbutton-20260114.md) - Recent email changes

## Migration File

- [20260114_email_tracking.sql](../../db/migrations/20260114_email_tracking.sql)

## Key Files Reference

### API Routes
- `app/api/webhooks/resend/route.ts` - Webhook handler
- `app/api/email-status/purchase-orders/[id]/route.ts` - PO email status
- `app/api/email-status/quotes/[id]/route.ts` - Quote email status
- `app/api/email-issues/route.ts` - Global issues endpoint

### Components
- `components/features/emails/EmailActivityCard.tsx` - Email status display
- `components/features/emails/EmailIssuesIndicator.tsx` - Navbar notification

### Integration Points
- `app/purchasing/purchase-orders/[id]/page.tsx` - PO integration
- `components/quotes/EnhancedQuoteEditor.tsx` - Quote integration
- `components/layout/navbar.tsx` - Global notification

### Database
- `db/migrations/20260114_email_tracking.sql` - Schema migration

## Support

For issues or questions about email tracking:
1. Check troubleshooting section above
2. Review webhook logs in Resend dashboard
3. Check Next.js server logs for errors
4. Verify webhook configuration in Resend
5. Test webhook endpoint manually with curl

## Changelog

- **2026-01-16**: Initial implementation with webhook integration, global notifications, and delivery tracking

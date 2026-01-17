# Email Delivery Tracking Implementation

**Date**: 2026-01-16
**Type**: Feature Implementation
**Status**: ✅ Complete (Requires webhook configuration)

## Overview

Implemented comprehensive email delivery tracking system using Resend webhooks. The system tracks email lifecycle events (sent, delivered, bounced, opened, clicked) for all Purchase Orders and Quotes, provides real-time status updates, and alerts users to delivery failures through a global notification system.

## What Changed

### Database Schema

**New Table: `email_events`**
- Stores all webhook events from Resend
- Links events to purchase orders or quotes
- Captures bounce/complaint details
- Stores raw webhook payload for debugging

**Enhanced Email Log Tables**:
- `purchase_order_email_log`: Added delivery tracking columns
  - `delivery_status` (TEXT)
  - `delivered_at` (TIMESTAMPTZ)
  - `bounced_at` (TIMESTAMPTZ)
  - `bounce_reason` (TEXT)
  - `opened_at` (TIMESTAMPTZ)
  - `clicked_at` (TIMESTAMPTZ)
- `quote_email_log`: Same columns added

**Migration**: [db/migrations/20260114_email_tracking.sql](../../db/migrations/20260114_email_tracking.sql)

### API Routes

**New Webhook Endpoint**: `POST /api/webhooks/resend`
- Receives webhook events from Resend
- Maps event types to internal schema
- Updates delivery status in email logs
- Stores events in `email_events` table
- Links events via `resend_email_id`

**New Status Endpoints**:
- `GET /api/email-status/purchase-orders/[id]` - Fetch PO email status
- `GET /api/email-status/quotes/[id]` - Fetch quote email status
- Both return enriched data with events and aggregated status

**New Issues Endpoint**: `GET /api/email-issues`
- Returns recent bounced/complained emails (last 7 days)
- Powers global notification indicator
- Limits to 20 most recent issues

### UI Components

**EmailActivityCard** (`components/features/emails/EmailActivityCard.tsx`)
- Reusable component for displaying email delivery status
- Shows email list with visual status badges
- Expandable event timeline per email
- Alert banners for bounced/failed emails
- Auto-refreshes every 30 seconds
- Used in both PO and Quote pages

**EmailIssuesIndicator** (`components/features/emails/EmailIssuesIndicator.tsx`)
- Global navbar notification for email issues
- Badge shows count of bounced/complained emails
- Popover displays issue list with details
- Links to affected PO/Quote pages
- Session-based dismiss functionality
- Auto-refreshes every 60 seconds

### Integration Points

**Purchase Order Page** (`app/purchasing/purchase-orders/[id]/page.tsx`)
- Added EmailActivityCard below main content
- Displays all sent PO emails with delivery status
- Shows alerts for bounced supplier emails

**Quote Editor** (`components/quotes/EnhancedQuoteEditor.tsx`)
- Added EmailActivityCard to Quote Details tab
- Displays all sent quote emails with delivery status
- Shows alerts for bounced customer emails

**Navbar** (`components/layout/navbar.tsx`)
- Added EmailIssuesIndicator between Admin link and ThemeToggle
- Visible to all authenticated users

## Feature Details

### Tracked Events

| Event Type | Description | User Visibility |
|------------|-------------|-----------------|
| `sent` | Email accepted by Resend | Badge on EmailActivityCard |
| `delivered` | Email delivered to inbox | Green badge + timestamp |
| `bounced` | Email rejected (hard/soft) | Red alert + error message |
| `complained` | Marked as spam | Yellow alert |
| `opened` | Recipient opened email | Badge + timestamp |
| `clicked` | Recipient clicked link | Badge + timestamp |

### Email Status Flow

**Normal Flow**:
```
Sent → Delivered → Opened → Clicked
```

**Failure Flow**:
```
Sent → Bounced (permanent failure)
Sent → Complained (spam report)
```

### Global Notification System

**Badge Display Rules**:
- Shows count of bounced + complained emails from last 7 days
- Only shows issues not yet dismissed in current session
- Updates every 60 seconds

**Notification Details**:
- Timestamp with relative time (e.g., "2h ago")
- Recipient email address
- Email subject
- Bounce/complaint reason
- Direct link to affected PO or Quote
- Individual dismiss buttons

## Files Changed

### Created
- `db/migrations/20260114_email_tracking.sql`
- `app/api/webhooks/resend/route.ts`
- `app/api/email-status/purchase-orders/[id]/route.ts`
- `app/api/email-status/quotes/[id]/route.ts`
- `app/api/email-issues/route.ts`
- `components/features/emails/EmailActivityCard.tsx`
- `components/features/emails/EmailIssuesIndicator.tsx`
- `docs/operations/email-tracking.md`

### Modified
- `app/purchasing/purchase-orders/[id]/page.tsx` - Added EmailActivityCard
- `components/quotes/EnhancedQuoteEditor.tsx` - Added EmailActivityCard
- `components/layout/navbar.tsx` - Added EmailIssuesIndicator

## Configuration Required

### Resend Webhook Setup ⚠️ CRITICAL

This feature requires webhook configuration in Resend dashboard:

1. Log in to [Resend Dashboard](https://resend.com/dashboard)
2. Navigate to **Webhooks** section
3. Click **Add Endpoint**
4. Configure:
   - **URL**: `https://your-production-domain.com/api/webhooks/resend`
   - **Events**: Select all:
     - `email.sent`
     - `email.delivered`
     - `email.bounced`
     - `email.complained`
     - `email.opened`
     - `email.clicked`
5. Save the webhook

**Without this configuration, the tracking system will not receive delivery updates.**

### Optional Environment Variables

- `RESEND_WEBHOOK_SECRET` - For webhook signature verification (future enhancement)

## Testing Checklist

- [x] Database migration applied successfully
- [x] Webhook endpoint accepts POST requests
- [x] Email status APIs return correct data
- [x] EmailActivityCard displays on PO page
- [x] EmailActivityCard displays on Quote page
- [x] EmailIssuesIndicator shows in navbar
- [x] Bounce alerts display correctly
- [ ] **Resend webhook configured** (production step)
- [ ] **End-to-end test with real emails** (production step)

## Known Limitations

1. **Historical Emails**: Only tracks emails sent after implementation (no retroactive tracking)
2. **Webhook Dependency**: Relies on Resend webhook delivery (no retry mechanism yet)
3. **Dismiss Persistence**: Issue dismissals are session-based (cleared on logout)
4. **Open/Click Tracking**: Requires HTML emails with tracking pixels (already enabled)

## Performance Impact

- **Database**: New table + columns add minimal overhead
- **API**: Webhook endpoint handles async events (non-blocking)
- **UI**: Auto-refresh every 30-60s (React Query caching reduces load)
- **Indexes**: Added on `resend_email_id` for fast lookups

## User Impact

**Positive**:
- Visibility into email delivery status
- Alerts for failed deliveries (no silent failures)
- Proactive notification of issues
- Better customer/supplier communication tracking

**Neutral**:
- New UI elements (EmailActivityCard) add vertical space to pages
- Global notification badge may require initial user education

**None**:
- No breaking changes to existing workflows
- No changes to email sending logic
- Backward compatible with existing email logs

## Next Steps

### Immediate (Production Deployment)

1. **Configure Resend Webhook** ⚠️ CRITICAL
   - Set webhook URL in Resend dashboard
   - Enable all email events
   - Test webhook with sample events

2. **Verify in Production**
   - Send test PO email
   - Send test quote email
   - Confirm webhook events received
   - Check EmailActivityCard shows status
   - Verify global notifications work

### Short-Term Enhancements

1. **Webhook Security**
   - Add `RESEND_WEBHOOK_SECRET` env var
   - Implement signature verification
   - Reject unsigned webhook requests

2. **Persistent Dismiss**
   - Store dismissed issues in database
   - Add "Mark as resolved" workflow
   - Track resolution history

3. **Email Retry**
   - Add "Resend" button for failed emails
   - Automatic retry for soft bounces
   - Track retry attempts

4. **Enhanced Alerts**
   - Email/Slack notifications for critical failures
   - Daily digest of delivery issues
   - Escalation for repeated bounces

### Medium-Term Improvements

1. **Analytics Dashboard**
   - Email delivery rate metrics
   - Bounce rate by supplier/customer
   - Open rate tracking for quotes
   - Engagement scoring

2. **Automated Follow-ups**
   - Remind if quote not opened after N days
   - Alert if PO not delivered within 24h
   - Escalation workflows

3. **Data Retention**
   - Implement cleanup for old events (90+ days)
   - Archive historical data
   - Performance optimization

## Related Work

**Previous Changes**:
- [Email Migration to qbutton.co.za](./email-migration-qbutton-20260114.md) - Separate sender addresses
- [Quote Email Implementation](../operations/quote-email-implementation.md) - Quote email feature

**Dependencies**:
- Resend API integration (existing)
- React Query (existing)
- Supabase service role key (existing)

## Documentation

- **Operations Guide**: [docs/operations/email-tracking.md](../operations/email-tracking.md)
- **Email Integration**: [docs/operations/email-integration.md](../operations/email-integration.md)
- **Migration File**: [db/migrations/20260114_email_tracking.sql](../../db/migrations/20260114_email_tracking.sql)

## Rollback Plan

If issues arise:

1. **Disable Webhook**: Remove webhook in Resend dashboard (stops new events)
2. **Revert UI**: Remove EmailActivityCard and EmailIssuesIndicator from UI
3. **Keep Database**: Migration is backward compatible (new columns are nullable)
4. **API Routes**: Can be safely disabled without affecting email sending

**Database Rollback** (if needed):
```sql
-- Remove tracking columns
ALTER TABLE purchase_order_email_log
  DROP COLUMN IF EXISTS delivery_status,
  DROP COLUMN IF EXISTS delivered_at,
  DROP COLUMN IF EXISTS bounced_at,
  DROP COLUMN IF EXISTS bounce_reason,
  DROP COLUMN IF EXISTS opened_at,
  DROP COLUMN IF EXISTS clicked_at;

ALTER TABLE quote_email_log
  DROP COLUMN IF EXISTS delivery_status,
  DROP COLUMN IF EXISTS delivered_at,
  DROP COLUMN IF EXISTS bounced_at,
  DROP COLUMN IF EXISTS bounce_reason,
  DROP COLUMN IF EXISTS opened_at,
  DROP COLUMN IF EXISTS clicked_at;

-- Remove events table
DROP TABLE IF EXISTS email_events;
```

## Success Metrics

**Week 1**:
- [ ] 100% of new emails have `resend_email_id` stored
- [ ] Webhook receives >95% of expected events
- [ ] Zero webhook errors in logs

**Week 2**:
- [ ] Users acknowledge delivery issue alerts
- [ ] Bounce rate baseline established
- [ ] Open rate tracking for quotes available

**Month 1**:
- [ ] Reduced failed delivery incidents (known issues resolved)
- [ ] Users proactively fix bounced addresses
- [ ] Email engagement metrics inform sales process

## Sign-off

- [x] Code implementation complete
- [x] Database migration tested
- [x] Documentation complete
- [x] Testing checklist created
- [ ] Resend webhook configured (production deployment step)
- [ ] Production verification complete (after deployment)

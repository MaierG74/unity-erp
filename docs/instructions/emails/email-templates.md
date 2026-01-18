# Email Templates

This guide explains how to customize the email content sent from Unity ERP.

## Overview

Unity ERP sends automated emails for:
- **Purchase Orders** - Sent to suppliers when placing orders
- **Quotes** - Sent to customers with attached PDF quotes
- **Follow-ups** - Sent to suppliers requesting delivery status updates
- **Goods Returns** - Sent to suppliers when returning items

The content of these emails can be customized through the **Document Templates** section in Settings.

## Accessing Email Templates

1. Navigate to **Settings** in the left sidebar
2. Scroll down to the **Document Templates** section
3. Click to expand the section if collapsed

## Available Templates

### Purchase Order Templates

These templates control the content of emails sent to suppliers when you create and send a purchase order.

#### Contact Information

**Location:** Settings > Document Templates > Purchase Order Templates > Contact Information

This controls who suppliers should contact if they have questions about an order.

| Field | Description | Example |
|-------|-------------|---------|
| Contact Name | Name shown in the Important Notice | Mignon |
| Contact Email | Email address for order queries | orders@qbutton.co.za |

**Where it appears:** In the yellow "Important Notice" box at the bottom of purchase order emails.

#### Important Notice Text

**Location:** Settings > Document Templates > Purchase Order Templates > Important Notice Text

This is the message shown in the yellow notice box in purchase order emails. It reminds suppliers to verify the order details before processing.

**Placeholders available:**
- `{{contact_name}}` - Replaced with the Contact Name from above
- `{{contact_email}}` - Replaced with the Contact Email from above

**Default text:**
```
Please verify all quantities, pricing, and specifications before processing this order. If you notice any discrepancies or have questions, contact {{contact_name}} at {{contact_email}} before proceeding.
```

**Example customization:**
```
IMPORTANT: Please confirm receipt of this order within 24 hours. Verify all quantities and pricing. For any queries, contact {{contact_name}} at {{contact_email}}. Orders not confirmed may be cancelled.
```

## How to Edit Templates

1. Go to **Settings**
2. Scroll to **Document Templates**
3. Expand the relevant category (Quote Templates or Purchase Order Templates)
4. Edit the text in the text area
5. Click **Save Templates**

## Tips

- **Test before going live:** After editing a template, send a test email to yourself to verify the formatting
- **Keep it professional:** Templates are sent to customers and suppliers, so maintain a professional tone
- **Use placeholders:** Where available, use placeholders like `{{contact_name}}` so the content stays up-to-date when you change contact details
- **Backup your content:** Before making major changes, copy the existing text somewhere safe

## Quote Templates

### Default Terms & Conditions

**Location:** Settings > Document Templates > Quote Templates > Default Terms & Conditions

This text appears on quote PDFs when no quote-specific terms are entered. Individual quotes can override this by entering terms directly on the quote.

**Where it appears:** At the bottom of generated quote PDFs in the "Terms & Conditions" section.

**Default text:**
```
• Payment terms: 30 days from invoice date
• All prices exclude VAT unless otherwise stated
• This quotation is valid for 30 days from the date above
• Delivery times may vary depending on stock availability
```

## Troubleshooting

### Changes not appearing in emails

1. Ensure you clicked **Save Templates** after editing
2. Wait a moment and try sending the email again
3. Clear your browser cache and refresh the Settings page

### Placeholder not being replaced

- Ensure the placeholder is typed exactly as shown: `{{contact_name}}` (with double curly braces)
- Check there are no extra spaces inside the braces
- The placeholder names are case-sensitive

### Template reverted to default

If a template appears blank or reverted:
1. The system uses hardcoded defaults as a fallback
2. Re-enter your custom text and save again
3. If the issue persists, contact support

## Related Documentation

- [Sending Purchase Orders](../../features/purchasing.md)
- [Creating and Emailing Quotes](../../features/quotes.md)

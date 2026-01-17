# Fix: Quote Attachment "Show in PDF" Toggle

**Date**: 2026-01-17
**Status**: ✅ Completed

## Issue

The "Show in PDF" checkbox in the quote attachment dialog was not working. When users clicked the checkbox to toggle whether an attachment should be displayed in the PDF, the UI would not update and the change was not persisted.

## Root Cause

The `toggleDisplayInQuote` function in `QuoteAttachmentManager.tsx` was only updating local component state but not persisting changes to the database. The issue manifested as follows:

1. User clicks checkbox → `toggleDisplayInQuote` called
2. Local state updated (attachments array modified)
3. Parent component's `onAttachmentsChange` triggered
4. Parent increments `attachmentsVersion`
5. `InlineAttachmentsCell` re-fetches from database via `refresh()`
6. **Database still has old value** → overwrites local state change
7. UI reverts to original state

The function had a `// TODO: Update in database` comment indicating this was known incomplete functionality.

## Solution

Added database persistence to the toggle function:

1. **Created new database function** (`lib/db/quotes.ts`)
   - `updateQuoteAttachmentDisplayInQuote(id, displayInQuote)` - Updates the `display_in_quote` field in the `quote_attachments` table

2. **Updated toggle handler** (`components/quotes/QuoteAttachmentManager.tsx`)
   - Made `toggleDisplayInQuote` async
   - Database update happens first
   - Only updates local state if database update succeeds
   - Removed TODO comment

## Files Changed

### 1. `lib/db/quotes.ts`

**Added new function:**
```typescript
export async function updateQuoteAttachmentDisplayInQuote(
  id: string,
  displayInQuote: boolean
): Promise<void> {
  const { error } = await supabase
    .from('quote_attachments')
    .update({ display_in_quote: displayInQuote })
    .eq('id', id);
  if (error) throw error;
}
```

### 2. `components/quotes/QuoteAttachmentManager.tsx`

**Import changes:**
```typescript
// Before
import { QuoteAttachment, uploadQuoteAttachment, deleteQuoteAttachment } from '@/lib/db/quotes';

// After
import { QuoteAttachment, uploadQuoteAttachment, deleteQuoteAttachment, updateQuoteAttachmentDisplayInQuote } from '@/lib/db/quotes';
```

**Function changes:**
```typescript
// Before
const toggleDisplayInQuote = (attachmentId: string, display: boolean) => {
  const updatedAttachments = attachments.map(att =>
    att.id === attachmentId ? { ...att, display_in_quote: display } : att
  );
  onAttachmentsChange(updatedAttachments);
  // TODO: Update in database
};

// After
const toggleDisplayInQuote = async (attachmentId: string, display: boolean) => {
  // Update database first
  try {
    await updateQuoteAttachmentDisplayInQuote(attachmentId, display);
  } catch (error) {
    console.error('Failed to update attachment display setting:', error);
    return; // Don't update local state if DB update fails
  }

  const updatedAttachments = attachments.map(att =>
    att.id === attachmentId ? { ...att, display_in_quote: display } : att
  );
  onAttachmentsChange(updatedAttachments);
};
```

## Testing Performed

1. ✅ Single attachment toggle (checked → unchecked → checked)
2. ✅ UI updates immediately on click
3. ✅ State persists after dialog close/reopen
4. ✅ State persists after page refresh
5. ✅ Badge counter ("X Visible in PDF") updates correctly

## Multiple Images Support

The fix correctly handles multiple attachments because:
- Each attachment has a unique `id`
- Database update targets specific attachment by ID
- Local state update only modifies the matching attachment
- No interference between different attachments' toggle states

## Edge Cases Handled

- **Database failure**: If the database update fails, local state is not updated (preventing UI/DB mismatch)
- **Network issues**: Error is logged but doesn't crash the component
- **Undefined values**: Checkbox defaults to checked if `display_in_quote` is undefined (maintains backward compatibility)

## Related Documentation

- See `startupissue.md` and `docs/technical/dev-server-troubleshooting.md` for @react-pdf/renderer build issues
- Quote attachment workflow: User uploads → toggles visibility → generates PDF (only visible attachments included)

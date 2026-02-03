# Staff: Remove Staff View Modal Debug Log

**Date**: 2026-02-03
**Status**: ✅ Completed

## Summary

Removed a debug `console.log` from the Staff View modal to avoid logging sensitive document URLs in production.

## Changes

- Removed debug logging of `id_document_urls` and `bank_account_image_urls` in the Staff View modal.
  - `components/features/staff/StaffViewModal.tsx`

## Testing

- Manual smoke check: open `/staff`, view a staff member modal, confirm it loads without console errors.

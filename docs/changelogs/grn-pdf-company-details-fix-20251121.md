# GRN PDF Company Details Fix

**Date:** November 21, 2025
**Type:** Bug Fix
**Status:** ✅ Deployed

---

## Overview

Fixed an issue where the "Goods Returned" PDF (GRN) was missing company details (name, address, logo) in the header. The issue was caused by the client-side PDF generation falling back to default values because the company settings were not being passed to the `ReturnGoodsPDFDownload` component.

---

## Changes

### Frontend
- **`components/features/purchasing/order-detail.tsx`**:
  - Added a query to fetch company settings from `quote_company_settings`.
  - Updated `ReturnGoodsPDFDownload` usage to pass the fetched `companyInfo` prop.
  - Ensures the PDF is generated with the correct branding and contact details.

### Backend
- **`app/api/supplier-returns/[returnId]/document/route.tsx`**:
  - Updated the settings fetch logic to be more robust (removed hardcoded `setting_id` check).

---

## Verification

1. Navigate to a Purchase Order with a processed return.
2. Click "Open PDF" or "Download PDF" in the "Goods Returned Document" section.
3. Verify that the PDF header displays the correct Company Name, Address, Phone, and Email as configured in the Settings page.

# Purchasing: Purchase Orders List – Loading + Error States

Date: 2025-11-02

Area: Purchasing → Purchase Orders list (`app/purchasing/purchase-orders/page.tsx`)

Changes

- Added `isLoading` / `error` handling via `useQuery` destructure.
- While loading, render a skeleton table (reusing the dashboard shimmer style using `components/ui/skeleton`).
- On error, show a retry-friendly `Alert` with a “Retry” button wired to `refetch()`.
- Gated `renderTable()` to render only when data is ready (prevents premature “No results” states during load).
- Disabled filter controls while loading to avoid confusing state changes.

Rationale

- Provide consistent UX with dashboard/quotes shimmer patterns.
- Make failures discoverable and recoverable without a full page refresh.
- Avoid filter interactions that fight with initial load.

Files

- Updated: `app/purchasing/purchase-orders/page.tsx`


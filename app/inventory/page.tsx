'use client';

/**
 * Inventory Page
 *
 * REFACTORED: Uses PageToolbar for compact header layout.
 * - Removed verbose description paragraph (was "Manage components, categories...")
 * - Removed decorative gradient divider
 * - Reduced container padding from py-6 to py-2
 * - Tabs sit directly below the compact toolbar
 * - URL-based filter persistence for navigating back from detail pages
 *
 * Note: Each tab (Components, Categories, etc.) maintains its own
 * search/filter controls since filtering needs differ per tab.
 * Filter state is preserved in URL query parameters (?q=search&category=X&supplier=Y&tab=components)
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { ComponentsTab } from '@/components/features/inventory/ComponentsTab';
import { CategoriesTab } from '@/components/features/inventory/CategoriesTab';
import { OnOrderTab } from '@/components/features/inventory/OnOrderTab';
import { TransactionsTab } from '@/components/features/inventory/TransactionsTab';
import { ReportsTab } from '@/components/features/inventory/ReportsTab';
import { ManualStockIssueTab } from '@/components/features/inventory/ManualStockIssueTab';
import { ImportTabWrapper } from '@/components/features/inventory/ImportTabWrapper';
import { OverheadCostsTab } from '@/components/features/inventory/OverheadCostsTab';

const VALID_TABS = ['components', 'categories', 'overhead', 'on-order', 'stock-issue', 'transactions', 'reports', 'import'] as const;
type ValidTab = typeof VALID_TABS[number];

export default function InventoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get active tab from URL, defaulting to 'components'
  const tabParam = searchParams?.get('tab');
  const activeTab: ValidTab = VALID_TABS.includes(tabParam as ValidTab)
    ? (tabParam as ValidTab)
    : 'components';

  // Handle tab change - update URL while preserving other params
  const handleTabChange = (newTab: string) => {
    const params = new URLSearchParams(searchParams?.toString() || '');

    if (newTab === 'components') {
      // Default tab - remove from URL to keep it clean
      params.delete('tab');
    } else {
      params.set('tab', newTab);
    }

    const query = params.toString();
    const url = query ? `/inventory?${query}` : '/inventory';
    router.replace(url, { scroll: false });
  };

  return (
    // CHANGED: Reduced py-6 to py-2 for less vertical padding
    <div className="container mx-auto py-2">
      {/* NEW: PageToolbar replaces the old header with h1 + description + divider */}
      <PageToolbar
        title="Inventory"
        // Note: Search is handled per-tab since each tab has different filter needs
        // Actions could be added here for cross-tab operations if needed
      />

      {/* CHANGED: Reduced space-y from 6 to 4 for tighter layout */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="grid w-full max-w-7xl grid-cols-8">
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="overhead">Overhead</TabsTrigger>
          <TabsTrigger value="on-order">On Order</TabsTrigger>
          <TabsTrigger value="stock-issue">Stock Issue</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="import" className="text-warning">Import</TabsTrigger>
        </TabsList>

        {/* CHANGED: Reduced space-y from 4 to 2 in tab content */}
        <TabsContent value="components" className="space-y-2">
          <ComponentsTab />
        </TabsContent>

        <TabsContent value="categories" className="space-y-2">
          <CategoriesTab />
        </TabsContent>

        <TabsContent value="overhead" className="space-y-2">
          <OverheadCostsTab />
        </TabsContent>

        <TabsContent value="on-order" className="space-y-2">
          <OnOrderTab />
        </TabsContent>

        <TabsContent value="stock-issue" className="space-y-2">
          <ManualStockIssueTab />
        </TabsContent>

        <TabsContent value="transactions" className="space-y-2">
          <TransactionsTab />
        </TabsContent>

        <TabsContent value="reports" className="space-y-2">
          <ReportsTab />
        </TabsContent>

        <TabsContent value="import" className="space-y-2">
          <ImportTabWrapper />
        </TabsContent>
      </Tabs>
    </div>
  );
}

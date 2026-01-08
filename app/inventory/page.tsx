'use client';

/**
 * Inventory Page
 *
 * REFACTORED: Uses PageToolbar for compact header layout.
 * - Removed verbose description paragraph (was "Manage components, categories...")
 * - Removed decorative gradient divider
 * - Reduced container padding from py-6 to py-2
 * - Tabs sit directly below the compact toolbar
 *
 * Note: Each tab (Components, Categories, etc.) maintains its own
 * search/filter controls since filtering needs differ per tab.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { ComponentsTab } from '@/components/features/inventory/ComponentsTab';
import { CategoriesTab } from '@/components/features/inventory/CategoriesTab';
import { OnOrderTab } from '@/components/features/inventory/OnOrderTab';
import { TransactionsTab } from '@/components/features/inventory/TransactionsTab';
import { ReportsTab } from '@/components/features/inventory/ReportsTab';
import { ManualStockIssueTab } from '@/components/features/inventory/ManualStockIssueTab';
import { ImportTabWrapper } from '@/components/features/inventory/ImportTabWrapper';

export default function InventoryPage() {
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
      <Tabs defaultValue="components" className="space-y-4">
        <TabsList className="grid w-full max-w-5xl grid-cols-7">
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="on-order">On Order</TabsTrigger>
          <TabsTrigger value="stock-issue">Stock Issue</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          {/* CHANGED: Use semantic warning color instead of hardcoded orange */}
          <TabsTrigger value="import" className="text-warning">Import</TabsTrigger>
        </TabsList>

        {/* CHANGED: Reduced space-y from 4 to 2 in tab content */}
        <TabsContent value="components" className="space-y-2">
          <ComponentsTab />
        </TabsContent>

        <TabsContent value="categories" className="space-y-2">
          <CategoriesTab />
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

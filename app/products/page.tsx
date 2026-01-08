'use client';

/**
 * Products Page
 *
 * REFACTORED: Uses PageToolbar for compact header layout.
 * - Removed verbose description paragraph
 * - Removed decorative gradient divider
 * - Reduced container padding
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProductsTransactionsTab } from '@/components/features/products/TransactionsTab';
import { ProductsReportsTab } from '@/components/features/products/ReportsTab';
import { ProductsPage as LegacyProductsPage } from '@/src/pages.old/products/ProductsPage';
import { PageToolbar } from '@/components/ui/page-toolbar';

export default function ProductsHomePage() {
  return (
    // CHANGED: Minimal spacing, no container padding
    <div className="py-0 space-y-2">
      {/* CHANGED: Just the tabs, no duplicate PageToolbar - each tab has its own header */}
      <Tabs defaultValue="list" className="space-y-2">
        <TabsList className="grid w-full max-w-2xl grid-cols-3">
          <TabsTrigger value="list">Catalog</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        {/* CHANGED: Reduced space-y from 4 to 2 */}
        <TabsContent value="list" className="space-y-2">
          <LegacyProductsPage />
        </TabsContent>

        <TabsContent value="transactions" className="space-y-2">
          <ProductsTransactionsTab />
        </TabsContent>

        <TabsContent value="reports" className="space-y-2">
          <ProductsReportsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

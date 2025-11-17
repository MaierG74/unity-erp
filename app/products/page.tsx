'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProductsTransactionsTab } from '@/components/features/products/TransactionsTab';
import { ProductsReportsTab } from '@/components/features/products/ReportsTab';
import { ProductsPage as LegacyProductsPage } from '@/src/pages.old/products/ProductsPage';

export default function ProductsHomePage() {
  return (
    <div className="container mx-auto py-6">
      <div className="space-y-2 mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Products</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Manage finished goods, bill of materials, and analyze production health.
        </p>
        <div className="mt-2 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      </div>

      <Tabs defaultValue="list" className="space-y-6">
        <TabsList className="grid w-full max-w-2xl grid-cols-3">
          <TabsTrigger value="list">Catalog</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <LegacyProductsPage />
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4">
          <ProductsTransactionsTab />
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <ProductsReportsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

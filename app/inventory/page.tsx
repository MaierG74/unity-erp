'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ComponentsTab } from '@/components/features/inventory/ComponentsTab';
import { CategoriesTab } from '@/components/features/inventory/CategoriesTab';
import { OnOrderTab } from '@/components/features/inventory/OnOrderTab';
import { TransactionsTab } from '@/components/features/inventory/TransactionsTab';
import { ReportsTab } from '@/components/features/inventory/ReportsTab';

export default function InventoryPage() {
  return (
    <div className="container mx-auto py-6">
      {/* Header */}
      <div className="space-y-2 mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Manage components, categories, track orders, and view inventory reports.
        </p>
        <div className="mt-2 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="components" className="space-y-6">
        <TabsList className="grid w-full max-w-3xl grid-cols-5">
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="on-order">On Order</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="components" className="space-y-4">
          <ComponentsTab />
        </TabsContent>

        <TabsContent value="categories" className="space-y-4">
          <CategoriesTab />
        </TabsContent>

        <TabsContent value="on-order" className="space-y-4">
          <OnOrderTab />
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4">
          <TransactionsTab />
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <ReportsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

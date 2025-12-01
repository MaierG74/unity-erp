'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AirtableImportTab } from './AirtableImportTab';
import { AirtableBulkImportTab } from './AirtableBulkImportTab';
import { FileInput, Package } from 'lucide-react';

export function ImportTabWrapper() {
  return (
    <Tabs defaultValue="single" className="space-y-4">
      <TabsList>
        <TabsTrigger value="single" className="gap-2">
          <FileInput className="h-4 w-4" />
          Single Import
        </TabsTrigger>
        <TabsTrigger value="bulk" className="gap-2">
          <Package className="h-4 w-4" />
          Bulk Import
        </TabsTrigger>
      </TabsList>
      
      <TabsContent value="single">
        <AirtableImportTab />
      </TabsContent>
      
      <TabsContent value="bulk">
        <AirtableBulkImportTab />
      </TabsContent>
    </Tabs>
  );
}

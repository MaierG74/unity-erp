import { Metadata } from 'next';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { JobCategoriesManager } from '@/components/features/labor/job-categories-manager';
import { JobsRatesTable } from '@/components/features/labor/jobs-rates-table';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Labor Management',
  description: 'Manage job categories and jobs for the bill of labor',
};

export default function LaborManagementPage() {
  return (
    <div className="container mx-auto py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Labor Management</h1>
          <p className="text-muted-foreground">
            Manage jobs, rates, and categories for the bill of labor
          </p>
        </div>
        <Button asChild variant="outline" className="gap-2">
          <Link href="/labor-planning">
            Open Labor Planning
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="jobs-rates" className="space-y-4">
        <TabsList>
          <TabsTrigger value="jobs-rates">Jobs & Rates</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="jobs-rates" className="space-y-4">
          <JobsRatesTable />
        </TabsContent>
        <TabsContent value="categories" className="space-y-4">
          <JobCategoriesManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}

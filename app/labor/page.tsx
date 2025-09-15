import { Metadata } from 'next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { JobCategoriesManager } from '@/components/features/labor/job-categories-manager';
import { JobsManager } from '@/components/features/labor/jobs-manager';
import { PieceworkRatesManager } from '@/components/features/labor/piecework-rates-manager';
import { JobHourlyRatesManager } from '@/components/features/labor/job-hourly-rates-manager';

export const metadata: Metadata = {
  title: 'Labor Management',
  description: 'Manage job categories, rates, and jobs for the bill of labor',
};

export default function LaborManagementPage() {
  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Labor Management</h1>
        <p className="text-muted-foreground">
          Manage job categories, rates, and jobs for the bill of labor
        </p>
      </div>
      
      <Tabs defaultValue="jobs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="categories">Job Categories</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="hourly">Hourly Rates</TabsTrigger>
          <TabsTrigger value="piecework">Piecework Rates</TabsTrigger>
        </TabsList>
        <TabsContent value="categories" className="space-y-4">
          <JobCategoriesManager />
        </TabsContent>
        <TabsContent value="jobs" className="space-y-4">
          <JobsManager />
        </TabsContent>
        <TabsContent value="hourly" className="space-y-4">
          <JobHourlyRatesManager />
        </TabsContent>
        <TabsContent value="piecework" className="space-y-4">
          <PieceworkRatesManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}

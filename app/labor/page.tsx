import { Metadata } from 'next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { JobCategoriesManager } from '@/components/labor/job-categories-manager';
import { JobsManager } from '@/components/labor/jobs-manager';

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
        </TabsList>
        <TabsContent value="categories" className="space-y-4">
          <JobCategoriesManager />
        </TabsContent>
        <TabsContent value="jobs" className="space-y-4">
          <JobsManager />
        </TabsContent>
      </Tabs>
    </div>
  );
} 
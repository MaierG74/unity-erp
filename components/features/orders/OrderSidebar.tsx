'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, Package, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OrderSidebarProps {
  orderId: number;
  onTabChange: (tabId: string) => void;
}

export function OrderSidebar({ orderId, onTabChange }: OrderSidebarProps) {
  // Fetch customer order documents
  const { data: customerDocs, isLoading: docsLoading } = useQuery({
    queryKey: ['orderCustomerDocs', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_attachments')
        .select('*')
        .eq('order_id', orderId)
        .eq('category', 'Customer Order');
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch order progress summary
  const { data: progress } = useQuery({
    queryKey: ['orderProgress', orderId],
    queryFn: async () => {
      // Stock issuances count
      const { count: issuedCount } = await supabase
        .from('stock_issuances')
        .select('*', { count: 'exact', head: true })
        .eq('order_id', orderId);

      // Job cards by status
      const { data: jobCards } = await supabase
        .from('job_cards')
        .select('status')
        .eq('order_id', orderId);

      const activeJobs = jobCards?.filter(j => j.status === 'in_progress' || j.status === 'pending').length ?? 0;
      const completeJobs = jobCards?.filter(j => j.status === 'completed').length ?? 0;

      // Purchase order lines
      const { count: poCount } = await supabase
        .from('purchase_order_lines')
        .select('*', { count: 'exact', head: true })
        .eq('order_id', orderId);

      return {
        issuedCount: issuedCount ?? 0,
        activeJobs,
        completeJobs,
        totalJobs: jobCards?.length ?? 0,
        poCount: poCount ?? 0,
      };
    },
  });

  return (
    <div className="space-y-4">
      {/* Customer Order Documents */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Customer Documents
          </CardTitle>
        </CardHeader>
        <CardContent>
          {docsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading...
            </div>
          ) : customerDocs && customerDocs.length > 0 ? (
            <div className="space-y-2">
              {customerDocs.map((doc: any) => (
                <a
                  key={doc.id}
                  href={doc.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2 rounded-md border hover:bg-muted/50 transition-colors text-sm"
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{doc.file_name || 'Document'}</span>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No customer order attached</p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full text-xs"
            onClick={() => onTabChange('documents')}
          >
            View all documents
          </Button>
        </CardContent>
      </Card>

      {/* Order Progress */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Order Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Stock Issuances */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Stock issued</span>
            <span className={cn(
              'font-medium',
              (progress?.issuedCount ?? 0) > 0 ? 'text-green-600' : 'text-muted-foreground'
            )}>
              {progress?.issuedCount ?? 0} items
            </span>
          </div>

          {/* Job Cards */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Job cards</span>
            <span className="font-medium">
              {progress?.totalJobs === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                <>
                  {(progress?.activeJobs ?? 0) > 0 && (
                    <span className="text-amber-600">{progress?.activeJobs} active</span>
                  )}
                  {(progress?.activeJobs ?? 0) > 0 && (progress?.completeJobs ?? 0) > 0 && ', '}
                  {(progress?.completeJobs ?? 0) > 0 && (
                    <span className="text-green-600">{progress?.completeJobs} complete</span>
                  )}
                </>
              )}
            </span>
          </div>

          {/* Procurement */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Purchase orders</span>
            <span className={cn(
              'font-medium',
              (progress?.poCount ?? 0) > 0 ? 'text-amber-600' : 'text-muted-foreground'
            )}>
              {(progress?.poCount ?? 0) > 0 ? `${progress?.poCount} pending` : 'None'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => onTabChange('issue-stock')}
          >
            <Package className="h-4 w-4" />
            Issue Stock
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => onTabChange('job-cards')}
          >
            <ClipboardList className="h-4 w-4" />
            Job Cards
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

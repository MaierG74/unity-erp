'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Play,
  Square,
  Printer,
  Download,
  FileText,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { JobCardPDFDownload } from '@/components/features/job-cards/JobCardPDFDownload';

type JobCardStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
type ItemStatus = 'pending' | 'in_progress' | 'completed';

interface JobCardItem {
  item_id: number;
  job_card_id: number;
  product_id: number;
  job_id: number;
  quantity: number;
  completed_quantity: number;
  piece_rate: number;
  status: ItemStatus;
  start_time: string | null;
  completion_time: string | null;
  notes: string | null;
  products: {
    name: string;
    internal_code: string;
  } | null;
  jobs: {
    name: string;
  } | null;
}

interface JobCard {
  job_card_id: number;
  order_id: number | null;
  staff_id: number;
  issue_date: string;
  due_date: string | null;
  completion_date: string | null;
  status: JobCardStatus;
  notes: string | null;
  created_at: string;
  staff: {
    first_name: string;
    last_name: string;
  } | null;
  orders: {
    order_id: number;
    order_number: string;
    customers: {
      name: string;
    } | null;
  } | null;
}

const statusConfig: Record<JobCardStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode; className?: string }> = {
  pending: { label: 'Pending', variant: 'secondary', icon: <Clock className="h-3 w-3" /> },
  in_progress: { label: 'In Progress', variant: 'default', icon: <Loader2 className="h-3 w-3" />, className: 'bg-blue-500' },
  completed: { label: 'Completed', variant: 'outline', icon: <CheckCircle className="h-3 w-3 text-green-500" />, className: 'border-green-500 text-green-500' },
  cancelled: { label: 'Cancelled', variant: 'destructive', icon: <XCircle className="h-3 w-3" /> },
};

const itemStatusConfig: Record<ItemStatus, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  pending: { label: 'Pending', variant: 'secondary' },
  in_progress: { label: 'In Progress', variant: 'default' },
  completed: { label: 'Completed', variant: 'outline' },
};

export default function JobCardDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const jobCardId = parseInt(params.id as string);

  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingQuantity, setEditingQuantity] = useState<number>(0);

  // Fetch job card details
  const { data: jobCard, isLoading: loadingJobCard, error: jobCardError, refetch: refetchJobCard } = useQuery({
    queryKey: ['jobCard', jobCardId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_cards')
        .select(`
          *,
          staff:staff_id(first_name, last_name),
          orders:order_id(order_id, order_number, customers(name))
        `)
        .eq('job_card_id', jobCardId)
        .single();
      if (error) throw error;
      return data as JobCard;
    },
    enabled: Number.isFinite(jobCardId) && jobCardId > 0,
    retry: 1,
  });

  // Fetch job card items
  const { data: items = [], isLoading: loadingItems } = useQuery({
    queryKey: ['jobCardItems', jobCardId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_card_items')
        .select(`
          *,
          products:product_id(name, internal_code),
          jobs:job_id(name)
        `)
        .eq('job_card_id', jobCardId)
        .order('item_id');
      if (error) throw error;
      return data as JobCardItem[];
    },
  });

  // Fetch company info for PDF
  const { data: companyInfo } = useQuery({
    queryKey: ['companyInfo'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('key, value')
        .in('key', ['company_name', 'company_address', 'company_phone', 'company_email']);
      if (error) throw error;
      const settings: Record<string, string> = {};
      data?.forEach((s) => {
        settings[s.key] = s.value;
      });
      return {
        name: settings.company_name || 'Unity Manufacturing',
        address: settings.company_address,
        phone: settings.company_phone,
        email: settings.company_email,
      };
    },
  });

  // Status transition mutation
  const statusMutation = useMutation({
    mutationFn: async ({ newStatus, completionDate }: { newStatus: JobCardStatus; completionDate?: string }) => {
      const updates: Record<string, any> = { status: newStatus };
      if (completionDate) {
        updates.completion_date = completionDate;
      }
      const { error } = await supabase
        .from('job_cards')
        .update(updates)
        .eq('job_card_id', jobCardId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobCard', jobCardId] });
      queryClient.invalidateQueries({ queryKey: ['jobCards'] });
      toast.success('Job card status updated');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update status');
    },
  });

  // Item completion mutation
  const itemMutation = useMutation({
    mutationFn: async ({ itemId, completedQuantity }: { itemId: number; completedQuantity: number }) => {
      const item = items.find((i) => i.item_id === itemId);
      if (!item) throw new Error('Item not found');

      // Determine new status based on completed quantity
      let newStatus: ItemStatus = 'pending';
      if (completedQuantity >= item.quantity) {
        newStatus = 'completed';
      } else if (completedQuantity > 0) {
        newStatus = 'in_progress';
      }

      const updates: Record<string, any> = {
        completed_quantity: completedQuantity,
        status: newStatus,
      };

      if (newStatus === 'completed' && !item.completion_time) {
        updates.completion_time = new Date().toISOString();
      }
      if (completedQuantity > 0 && !item.start_time) {
        updates.start_time = new Date().toISOString();
      }

      const { error } = await supabase
        .from('job_card_items')
        .update(updates)
        .eq('item_id', itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobCardItems', jobCardId] });
      setEditingItemId(null);
      toast.success('Item updated');

      // Check if all items are completed to auto-complete job card
      checkAutoComplete();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update item');
    },
  });

  const checkAutoComplete = async () => {
    // Refetch items to check if all are completed
    const { data: updatedItems } = await supabase
      .from('job_card_items')
      .select('status')
      .eq('job_card_id', jobCardId);

    if (updatedItems && updatedItems.every((item) => item.status === 'completed')) {
      // All items completed, auto-complete job card
      if (jobCard?.status !== 'completed') {
        statusMutation.mutate({
          newStatus: 'completed',
          completionDate: new Date().toISOString().split('T')[0],
        });
      }
    }
  };

  const handleStartWork = () => {
    statusMutation.mutate({ newStatus: 'in_progress' });
  };

  const handleMarkComplete = () => {
    statusMutation.mutate({
      newStatus: 'completed',
      completionDate: new Date().toISOString().split('T')[0],
    });
  };

  const handleCancel = () => {
    statusMutation.mutate({ newStatus: 'cancelled' });
  };

  const handleEditItem = (item: JobCardItem) => {
    setEditingItemId(item.item_id);
    setEditingQuantity(item.completed_quantity);
  };

  const handleSaveItem = (itemId: number) => {
    itemMutation.mutate({ itemId, completedQuantity: editingQuantity });
  };

  const handleCancelEdit = () => {
    setEditingItemId(null);
    setEditingQuantity(0);
  };

  // Calculate totals
  const totalValue = items.reduce((sum, item) => sum + item.quantity * item.piece_rate, 0);
  const completedValue = items.reduce((sum, item) => sum + item.completed_quantity * item.piece_rate, 0);
  const totalItems = items.length;
  const completedItems = items.filter((item) => item.status === 'completed').length;

  if (loadingJobCard || loadingItems) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!jobCard) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">
          {jobCardError ? `Error loading job card: ${jobCardError.message}` : 'Job card not found'}
        </p>
        <div className="flex justify-center gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => refetchJobCard()}>
            Retry
          </Button>
          <Button variant="link" size="sm" asChild>
            <Link href="/staff/job-cards">Back to Job Cards</Link>
          </Button>
        </div>
      </div>
    );
  }

  const status = statusConfig[jobCard.status] || statusConfig.pending;
  const canStart = jobCard.status === 'pending';
  const canComplete = jobCard.status === 'in_progress';
  const canCancel = jobCard.status !== 'completed' && jobCard.status !== 'cancelled';
  const isEditable = jobCard.status !== 'completed' && jobCard.status !== 'cancelled';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/staff/job-cards">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Job Card #{jobCard.job_card_id}</h1>
            <p className="text-muted-foreground">
              Issued {format(new Date(jobCard.issue_date), 'MMMM d, yyyy')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={status.variant} className={`gap-1 ${status.className || ''}`}>
            {status.icon}
            {status.label}
          </Badge>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="flex flex-wrap gap-2">
        {canStart && (
          <Button onClick={handleStartWork} disabled={statusMutation.isPending}>
            <Play className="h-4 w-4 mr-2" />
            Start Work
          </Button>
        )}
        {canComplete && (
          <Button onClick={handleMarkComplete} disabled={statusMutation.isPending} variant="default">
            <CheckCircle className="h-4 w-4 mr-2" />
            Mark Complete
          </Button>
        )}
        {canCancel && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={statusMutation.isPending}>
                <XCircle className="h-4 w-4 mr-2" />
                Cancel Job Card
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel Job Card?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action will cancel the job card. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep Working</AlertDialogCancel>
                <AlertDialogAction onClick={handleCancel}>Cancel Job Card</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <div className="flex-1" />
        <JobCardPDFDownload
          jobCard={{
            job_card_id: jobCard.job_card_id,
            staff_name: jobCard.staff
              ? `${jobCard.staff.first_name} ${jobCard.staff.last_name}`
              : 'Unassigned',
            order_number: jobCard.orders?.order_number || null,
            customer_name: jobCard.orders?.customers?.name || null,
            issue_date: jobCard.issue_date,
            due_date: jobCard.due_date,
            notes: jobCard.notes,
            status: jobCard.status,
          }}
          items={items.map((item) => ({
            item_id: item.item_id,
            product_name: item.products?.name || 'Unknown Product',
            product_code: item.products?.internal_code || '',
            job_name: item.jobs?.name || 'Unknown Job',
            quantity: item.quantity,
            completed_quantity: item.completed_quantity,
            piece_rate: item.piece_rate,
          }))}
          companyInfo={companyInfo}
        />
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Assigned To</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-medium">
              {jobCard.staff
                ? `${jobCard.staff.first_name} ${jobCard.staff.last_name}`
                : 'Unassigned'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Related Order</CardDescription>
          </CardHeader>
          <CardContent>
            {jobCard.orders ? (
              <Link
                href={`/orders/${jobCard.orders.order_id}`}
                className="text-lg font-medium text-primary hover:underline inline-flex items-center gap-1"
              >
                {jobCard.orders.order_number}
                <ExternalLink className="h-3 w-3" />
              </Link>
            ) : (
              <p className="text-muted-foreground">No order linked</p>
            )}
            {jobCard.orders?.customers && (
              <p className="text-sm text-muted-foreground">
                {jobCard.orders.customers.name}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Due Date</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-medium">
              {jobCard.due_date
                ? format(new Date(jobCard.due_date), 'MMM d, yyyy')
                : 'No due date'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Progress</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-medium">
              {completedItems} / {totalItems} items
            </p>
            <p className="text-sm text-muted-foreground">
              R {completedValue.toFixed(2)} / R {totalValue.toFixed(2)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Notes */}
      {jobCard.notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap">{jobCard.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Items Table */}
      <Card>
        <CardHeader>
          <CardTitle>Job Card Items</CardTitle>
          <CardDescription>
            Track completion for each item on this job card
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Job</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Piece Rate</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const itemStatus = itemStatusConfig[item.status] || itemStatusConfig.pending;
                const isEditing = editingItemId === item.item_id;
                const itemTotal = item.completed_quantity * item.piece_rate;

                return (
                  <TableRow key={item.item_id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{item.products?.name || '-'}</div>
                        <div className="text-sm text-muted-foreground">
                          {item.products?.internal_code}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{item.jobs?.name || '-'}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <Input
                          type="number"
                          min={0}
                          max={item.quantity}
                          value={editingQuantity}
                          onChange={(e) => setEditingQuantity(parseInt(e.target.value) || 0)}
                          className="w-20 text-right"
                          autoFocus
                        />
                      ) : (
                        <span className={item.completed_quantity >= item.quantity ? 'text-green-500 font-medium' : ''}>
                          {item.completed_quantity}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      R {item.piece_rate.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      R {itemTotal.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={itemStatus.variant}>{itemStatus.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {isEditable && (
                        isEditing ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={handleCancelEdit}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleSaveItem(item.item_id)}
                              disabled={itemMutation.isPending}
                            >
                              Save
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditItem(item)}
                          >
                            Update
                          </Button>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* Totals */}
          <div className="mt-4 pt-4 border-t flex justify-end">
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Total Value</div>
              <div className="text-2xl font-bold">R {totalValue.toFixed(2)}</div>
              <div className="text-sm text-muted-foreground">
                Earned: <span className="text-green-500 font-medium">R {completedValue.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Completion Info */}
      {jobCard.status === 'completed' && jobCard.completion_date && (
        <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">
                Completed on {format(new Date(jobCard.completion_date), 'MMMM d, yyyy')}
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

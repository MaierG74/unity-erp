'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ArrowLeft, Plus, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { PageToolbar } from '@/components/ui/page-toolbar';

type JobCardStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

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
    order_number: string;
    customers: {
      company_name: string;
    } | null;
  } | null;
  job_card_items: { count: number }[];
}

const statusConfig: Record<JobCardStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
  pending: { label: 'Pending', variant: 'secondary', icon: <Clock className="h-3 w-3" /> },
  in_progress: { label: 'In Progress', variant: 'default', icon: <Loader2 className="h-3 w-3" /> },
  completed: { label: 'Completed', variant: 'outline', icon: <CheckCircle className="h-3 w-3 text-green-500" /> },
  cancelled: { label: 'Cancelled', variant: 'destructive', icon: <XCircle className="h-3 w-3" /> },
};

export default function JobCardsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | JobCardStatus>('all');
  const [staffFilter, setStaffFilter] = useState<string>('all');

  // Fetch job cards
  const { data: jobCards = [], isLoading } = useQuery({
    queryKey: ['jobCards', search, statusFilter, staffFilter],
    queryFn: async () => {
      let query = supabase
        .from('job_cards')
        .select(`
          *,
          staff:staff_id(first_name, last_name),
          orders:order_id(order_number, customers(company_name)),
          job_card_items(count)
        `)
        .order('issue_date', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (staffFilter !== 'all') {
        query = query.eq('staff_id', parseInt(staffFilter));
      }

      const { data, error } = await query;
      if (error) throw error;

      // Client-side search filter
      let results = data || [];
      if (search) {
        const searchLower = search.toLowerCase();
        results = results.filter((jc: JobCard) => {
          const staffName = jc.staff ? `${jc.staff.first_name} ${jc.staff.last_name}`.toLowerCase() : '';
          const orderNum = jc.orders?.order_number?.toLowerCase() || '';
          const customerName = jc.orders?.customers?.company_name?.toLowerCase() || '';
          return staffName.includes(searchLower) ||
                 orderNum.includes(searchLower) ||
                 customerName.includes(searchLower) ||
                 jc.job_card_id.toString().includes(searchLower);
        });
      }

      return results as JobCard[];
    },
  });

  // Fetch staff for filter dropdown
  const { data: staffList = [] } = useQuery({
    queryKey: ['staffList'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('staff_id, first_name, last_name')
        .eq('is_active', true)
        .order('first_name');
      if (error) throw error;
      return data || [];
    },
  });

  const getItemsCount = (jobCard: JobCard) => {
    if (jobCard.job_card_items && jobCard.job_card_items.length > 0) {
      return jobCard.job_card_items[0].count;
    }
    return 0;
  };

  return (
    <div className="space-y-4">
      <PageToolbar
        title="Job Cards"
        actions={[
          {
            label: 'Create Job Card',
            onClick: () => router.push('/staff/job-cards/new'),
            icon: <Plus className="h-4 w-4" />,
          },
        ]}
      />

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/staff">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Staff
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Input
          placeholder="Search by ID, staff, order, customer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | JobCardStatus)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={staffFilter} onValueChange={setStaffFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Staff Member" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Staff</SelectItem>
            {staffList.map((s) => (
              <SelectItem key={s.staff_id} value={s.staff_id.toString()}>
                {s.first_name} {s.last_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">ID</TableHead>
              <TableHead>Staff Member</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Issue Date</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead className="text-center">Items</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  <p className="text-muted-foreground mt-2">Loading job cards...</p>
                </TableCell>
              </TableRow>
            ) : jobCards.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No job cards found
                </TableCell>
              </TableRow>
            ) : (
              jobCards.map((jobCard) => {
                const status = statusConfig[jobCard.status] || statusConfig.pending;
                return (
                  <TableRow
                    key={jobCard.job_card_id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/staff/job-cards/${jobCard.job_card_id}`)}
                  >
                    <TableCell className="font-mono text-sm">
                      #{jobCard.job_card_id}
                    </TableCell>
                    <TableCell>
                      {jobCard.staff
                        ? `${jobCard.staff.first_name} ${jobCard.staff.last_name}`
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {jobCard.orders ? (
                        <div>
                          <div className="font-medium">{jobCard.orders.order_number}</div>
                          {jobCard.orders.customers && (
                            <div className="text-sm text-muted-foreground">
                              {jobCard.orders.customers.company_name}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No order</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant} className="gap-1">
                        {status.icon}
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {format(new Date(jobCard.issue_date), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>
                      {jobCard.due_date
                        ? format(new Date(jobCard.due_date), 'MMM d, yyyy')
                        : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{getItemsCount(jobCard)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/staff/job-cards/${jobCard.job_card_id}`);
                        }}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Summary */}
      {!isLoading && jobCards.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Showing {jobCards.length} job card{jobCards.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

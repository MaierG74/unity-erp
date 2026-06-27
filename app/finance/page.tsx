'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Clock, FileText, ReceiptText } from 'lucide-react';

import { useAuth } from '@/components/common/auth-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { formatCurrency } from '@/lib/format-utils';

type FinanceCard = {
  purchase_order_id: number;
  q_number: string | null;
  supplier_name: string;
  amount: number;
  age_days: number;
  order_date: string | null;
  payment_status: 'awaiting_invoice' | 'awaiting_payment' | 'awaiting_pop';
};

type FinanceResponse = {
  groups: Record<FinanceCard['payment_status'], FinanceCard[]>;
  total: number;
};

const GROUPS: Array<{
  key: FinanceCard['payment_status'];
  title: string;
  empty: string;
  icon: typeof FileText;
}> = [
  {
    key: 'awaiting_invoice',
    title: 'Awaiting invoice',
    empty: 'No cash-supplier POs are waiting for an invoice.',
    icon: FileText,
  },
  {
    key: 'awaiting_payment',
    title: 'Awaiting payment',
    empty: 'No supplier invoices are waiting for payment.',
    icon: Clock,
  },
  {
    key: 'awaiting_pop',
    title: 'Awaiting POP',
    empty: 'No paid supplier invoices are waiting for proof of payment.',
    icon: ReceiptText,
  },
];

function formatQNumber(qNumber: string | null, purchaseOrderId: number) {
  if (!qNumber) return `PO #${purchaseOrderId}`;
  return qNumber.startsWith('Q') ? qNumber : `Q${qNumber}`;
}

function PendingPaymentCard({ item }: { item: FinanceCard }) {
  return (
    <Link
      href={`/purchasing/purchase-orders/${item.purchase_order_id}`}
      className="block rounded-md border bg-card p-3 transition-colors hover:bg-muted/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium leading-none">
            {formatQNumber(item.q_number, item.purchase_order_id)}
          </div>
          <div className="mt-1 truncate text-sm text-muted-foreground">
            {item.supplier_name}
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {item.age_days}d
        </Badge>
      </div>
      <div className="mt-3 text-lg font-semibold">
        {formatCurrency(item.amount)}
      </div>
    </Link>
  );
}

async function fetchPendingSupplierPayments(): Promise<FinanceResponse> {
  const response = await authorizedFetch('/api/finance/pending-supplier-payments', {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? 'Failed to load pending supplier payments');
  }

  return response.json();
}

export default function FinancePage() {
  const { user, loading } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['finance', 'pending-supplier-payments'],
    queryFn: fetchPendingSupplierPayments,
    enabled: !!user,
    staleTime: 30_000,
  });

  if (loading) return null;
  if (!user) return null;

  // TODO(POL-128): gate behind finance module/permission.
  const groups = data?.groups;

  return (
    <div className="space-y-5 p-6 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Finance — Pending supplier payments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cash supplier POs grouped by invoice and payment state.
          </p>
        </div>
        <Badge variant="outline">{data?.total ?? 0} open</Badge>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load finance queue</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : 'Please try again.'}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {GROUPS.map((group) => {
          const Icon = group.icon;
          const items = groups?.[group.key] ?? [];

          return (
            <Card key={group.key}>
              <CardHeader className="space-y-0 pb-3">
                <CardTitle className="flex items-center justify-between gap-3 text-base">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {group.title}
                  </span>
                  <Badge variant="secondary">{items.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="rounded-md border bg-card p-3">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="mt-2 h-4 w-36" />
                      <Skeleton className="mt-3 h-6 w-20" />
                    </div>
                  ))
                ) : items.length > 0 ? (
                  items.map((item) => (
                    <PendingPaymentCard key={item.purchase_order_id} item={item} />
                  ))
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    {group.empty}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

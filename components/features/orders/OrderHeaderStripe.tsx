'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeft, ChevronsUpDown, Check, Search, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { StatusBadge } from './StatusBadge';
import { formatCurrency } from '@/lib/format-utils';

interface OrderHeaderStripeProps {
  orderId: number;
  order: any;
  customers: any[];
  customersLoading: boolean;
  editCustomerId: string;
  editOrderNumber: string;
  editDeliveryDate: string;
  statusOptions: any[];
  updateOrderMutation: any;
  updateStatusMutation: any;
  onCustomerChange: (customerId: string) => void;
  onOrderNumberChange: (value: string) => void;
  onOrderNumberBlur: () => void;
  onDeliveryDateChange: (date: string) => void;
}

export function OrderHeaderStripe({
  orderId,
  order,
  customers,
  customersLoading,
  editCustomerId,
  editOrderNumber,
  editDeliveryDate,
  statusOptions,
  updateOrderMutation,
  updateStatusMutation,
  onCustomerChange,
  onOrderNumberChange,
  onOrderNumberBlur,
  onDeliveryDateChange,
}: OrderHeaderStripeProps) {
  const router = useRouter();
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);

  const filteredCustomers = useMemo(
    () =>
      (customers || []).filter((c) =>
        c.name.toLowerCase().startsWith(customerSearchTerm.toLowerCase())
      ),
    [customers, customerSearchTerm]
  );

  const handleCustomerSelect = (customerId: string) => {
    onCustomerChange(customerId);
    setCustomerOpen(false);
    setCustomerSearchTerm('');
  };

  const handleStatusChange = (statusId: number) => {
    updateStatusMutation.mutate({ statusId });
    setStatusOpen(false);
  };

  const currentCustomer = customers?.find(
    (c) => c.id.toString() === editCustomerId
  ) || order?.customer;

  return (
    <div className="space-y-2">
      {/* Row 1: Back + PO# + Status + Delivery */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          {/* Inline-editable PO# */}
          <Input
            value={editOrderNumber}
            onChange={(e) => onOrderNumberChange(e.target.value)}
            onBlur={onOrderNumberBlur}
            placeholder="PO #"
            className="h-8 w-40 text-lg font-bold bg-transparent border-none hover:border-input focus:border-input px-1"
          />

          {updateOrderMutation.isPending && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Status dropdown */}
          <Popover open={statusOpen} onOpenChange={setStatusOpen}>
            <PopoverTrigger asChild>
              <button className="cursor-pointer">
                <StatusBadge status={order?.status?.status_name || 'Open'} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" align="end">
              {statusOptions.map((s: any) => (
                <div
                  key={s.id}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-accent',
                    order?.status_id === s.id && 'bg-accent'
                  )}
                  onClick={() => handleStatusChange(s.id)}
                >
                  <Check
                    className={cn(
                      'h-3.5 w-3.5',
                      order?.status_id === s.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {s.status_name}
                </div>
              ))}
            </PopoverContent>
          </Popover>

          {/* Delivery date badge/editor */}
          <Badge variant="outline" className="gap-1 px-2 py-1">
            <span className="text-muted-foreground text-xs">Due:</span>
            <Input
              type="date"
              value={editDeliveryDate}
              onChange={(e) => onDeliveryDateChange(e.target.value)}
              className="h-5 w-[120px] text-xs bg-transparent border-none p-0"
            />
          </Badge>
        </div>
      </div>

      {/* Row 2: Metadata line */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground pl-10 flex-wrap">
        {/* Customer picker */}
        <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer">
              <span className="font-medium text-foreground truncate max-w-[200px]">
                {currentCustomer?.name || 'Select customer'}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0" align="start">
            <div className="flex items-center border-b px-3">
              <Search className="h-4 w-4 text-muted-foreground mr-2" />
              <input
                className="flex h-10 w-full bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground"
                placeholder="Search customers..."
                value={customerSearchTerm}
                onChange={(e) => setCustomerSearchTerm(e.target.value)}
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto p-1">
              {filteredCustomers.length === 0 ? (
                <div className="py-6 text-center text-sm">No customer found.</div>
              ) : (
                filteredCustomers.map((c) => (
                  <div
                    key={c.id}
                    className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                    onClick={() => handleCustomerSelect(String(c.id))}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        editCustomerId === c.id.toString()
                          ? 'opacity-100'
                          : 'opacity-0'
                      )}
                    />
                    {c.name}
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <span className="text-muted-foreground/50">|</span>

        <span>
          Created{' '}
          {order?.created_at &&
            format(new Date(order.created_at), 'MMM d, yyyy')}
        </span>

        <span className="text-muted-foreground/50">|</span>

        <span className="font-medium text-foreground">
          {formatCurrency(order?.total_amount || 0)}
        </span>
      </div>
    </div>
  );
}

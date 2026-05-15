'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCustomersList } from '@/hooks/use-customers-list';
import { saveProject } from '@/lib/roomcraft/project-store';
import type { RoomCraftProject } from '@/lib/roomcraft/types';

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProjectModal({ open, onOpenChange }: CreateProjectModalProps) {
  const router = useRouter();
  const { data: customers = [], isError, isLoading } = useCustomersList();
  const [reference, setReference] = React.useState('');
  const [customerId, setCustomerId] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const selectedCustomer = customers.find((customer) => String(customer.id) === customerId);
  const canSubmit = Boolean(reference.trim() && selectedCustomer && !submitting);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || !selectedCustomer) return;

    setSubmitting(true);

    const now = new Date().toISOString();
    const project: RoomCraftProject = {
      id: crypto.randomUUID(),
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      reference: reference.trim(),
      createdAt: now,
      updatedAt: now,
      pieces: [],
    };

    saveProject(project);
    setReference('');
    setCustomerId('');
    setSubmitting(false);
    onOpenChange(false);
    router.push(`/roomcraft/${project.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="reference">Reference</Label>
            <Input
              id="reference"
              placeholder="Smith kitchen renovation"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer">Customer</Label>
            <Select
              value={customerId}
              onValueChange={setCustomerId}
              disabled={isLoading || isError}
            >
              <SelectTrigger id="customer">
                <SelectValue
                  placeholder={
                    isLoading
                      ? 'Loading...'
                      : isError
                        ? 'Customers unavailable'
                        : 'Select customer'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={String(customer.id)}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

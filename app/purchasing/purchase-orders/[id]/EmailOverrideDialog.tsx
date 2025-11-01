'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type EmailOverride = { supplierId: number; email: string };
export type EmailOption = { email: string; is_primary: boolean };

export type EmailRecipientRow = {
  supplierId: number;
  supplierName: string;
  options: EmailOption[];
  selectedEmail: string;
};

interface EmailOverrideDialogProps {
  open: boolean;
  onClose: () => void;
  rows: EmailRecipientRow[];
  cc: string;
  loading: boolean;
  onConfirm: (payload: { overrides: EmailOverride[]; cc: string[] }) => void;
}

export function EmailOverrideDialog({
  open,
  onClose,
  rows,
  cc,
  loading,
  onConfirm,
}: EmailOverrideDialogProps) {
  const [localRows, setLocalRows] = useState(rows);
  const [ccValue, setCcValue] = useState(cc);

  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

  useEffect(() => {
    setCcValue(cc);
  }, [cc]);

  const hasMissing = useMemo(() => localRows.some((row) => !row.selectedEmail?.trim()), [localRows]);

  const handleSelectEmail = (supplierId: number, email: string) => {
    setLocalRows((prev) =>
      prev.map((row) =>
        row.supplierId === supplierId ? { ...row, selectedEmail: email } : row
      )
    );
  };

  const overrides = useMemo<EmailOverride[]>(() => {
    return localRows
      .filter((row) => row.selectedEmail?.trim())
      .map((row) => ({ supplierId: row.supplierId, email: row.selectedEmail.trim() }));
  }, [localRows]);

  const handleConfirm = () => {
    const ccList = ccValue
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    onConfirm({ overrides, cc: ccList });
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !loading && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Send Supplier Emails</DialogTitle>
          <DialogDescription>
            Review recipients, choose the email to use, and optionally CC additional contacts before
            sending.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">CC (comma separated)</label>
            <Input
              value={ccValue}
              onChange={(e) => setCcValue(e.target.value)}
              placeholder="ops@example.com, buyer@example.com"
              className="mt-1"
              disabled={loading}
            />
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {localRows.map((row) => (
                  <TableRow key={row.supplierId}>
                    <TableCell className="font-medium">{row.supplierName}</TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        {row.options.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {row.options.map((option) => (
                              <button
                                key={option.email}
                                type="button"
                                onClick={() => handleSelectEmail(row.supplierId, option.email)}
                                className={cn(
                                  'rounded-md border px-2 py-1 text-xs transition-colors',
                                  row.selectedEmail === option.email
                                    ? 'bg-muted font-medium'
                                    : 'text-muted-foreground hover:bg-muted/70'
                                )}
                                disabled={loading}
                              >
                                <span className="flex items-center gap-1">
                                  {option.email}
                                  {option.is_primary && (
                                    <Badge variant="secondary" className="text-[10px]">
                                      Primary
                                    </Badge>
                                  )}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No email on file. Provide one below.
                          </p>
                        )}
                        <Input
                          value={row.selectedEmail}
                          onChange={(e) => handleSelectEmail(row.supplierId, e.target.value)}
                          placeholder="supplier@example.com"
                          disabled={loading}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {hasMissing && (
            <p className="text-sm text-destructive">
              Please enter an email for every supplier before sending.
            </p>
          )}
          <div className="flex w-full justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={loading || hasMissing}>
              {loading ? 'Sending…' : 'Send Emails'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

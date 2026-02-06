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
import { Checkbox } from '@/components/ui/checkbox';
import { Check, X, FileText, Paperclip } from 'lucide-react';
import { POAttachment } from '@/lib/db/purchase-order-attachments';

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
  attachments?: POAttachment[];
  onConfirm: (payload: { overrides: EmailOverride[]; cc: string[]; skippedSuppliers?: number[]; selectedAttachmentIds?: string[] }) => void;
}

export function EmailOverrideDialog({
  open,
  onClose,
  rows,
  cc,
  loading,
  attachments = [],
  onConfirm,
}: EmailOverrideDialogProps) {
  const [localRows, setLocalRows] = useState(rows);
  const [ccValue, setCcValue] = useState(cc);
  // Track additional selected emails per supplier (beyond the primary)
  const [additionalSelections, setAdditionalSelections] = useState<Map<number, Set<string>>>(new Map());
  // Track suppliers that should be skipped (no email sent)
  const [skippedSuppliers, setSkippedSuppliers] = useState<Set<number>>(new Set());
  // Track which uploaded attachments to include in the email
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLocalRows(rows);
    // Reset selections when rows change
    setAdditionalSelections(new Map());
    setSkippedSuppliers(new Set());
  }, [rows]);

  useEffect(() => {
    setCcValue(cc);
  }, [cc]);

  // Check if any non-skipped supplier has no email selected
  const hasMissing = useMemo(() => {
    return localRows.some((row) => {
      if (skippedSuppliers.has(row.supplierId)) return false; // Skipped suppliers are OK
      const hasTo = !!row.selectedEmail?.trim();
      const hasCc = (additionalSelections.get(row.supplierId)?.size || 0) > 0;
      return !hasTo && !hasCc; // Need at least TO or CC
    });
  }, [localRows, skippedSuppliers, additionalSelections]);

  const handleToggleEmail = (supplierId: number, email: string, isPrimary: boolean) => {
    const row = localRows.find((r) => r.supplierId === supplierId);
    if (!row) return;

    // If supplier was skipped, un-skip them when selecting an email
    if (skippedSuppliers.has(supplierId)) {
      setSkippedSuppliers((prev) => {
        const updated = new Set(prev);
        updated.delete(supplierId);
        return updated;
      });
    }

    const currentPrimary = row.selectedEmail;
    const currentAdditional = additionalSelections.get(supplierId) || new Set<string>();

    if (email === currentPrimary) {
      // Clicking the current primary - deselect it (allow CC-only)
      setLocalRows((prev) =>
        prev.map((r) =>
          r.supplierId === supplierId ? { ...r, selectedEmail: '' } : r
        )
      );
    } else if (currentAdditional.has(email)) {
      // Clicking an already-selected CC email - deselect it
      setAdditionalSelections((prev) => {
        const updated = new Map(prev);
        const newSet = new Set(currentAdditional);
        newSet.delete(email);
        updated.set(supplierId, newSet);
        return updated;
      });
    } else if (!currentPrimary) {
      // No primary selected yet - make this the primary (TO)
      setLocalRows((prev) =>
        prev.map((r) =>
          r.supplierId === supplierId ? { ...r, selectedEmail: email } : r
        )
      );
    } else {
      // Add to additional selections (CC)
      setAdditionalSelections((prev) => {
        const updated = new Map(prev);
        const newSet = new Set(currentAdditional);
        newSet.add(email);
        updated.set(supplierId, newSet);
        return updated;
      });
    }
  };

  const handleToggleSkip = (supplierId: number) => {
    setSkippedSuppliers((prev) => {
      const updated = new Set(prev);
      if (updated.has(supplierId)) {
        updated.delete(supplierId);
      } else {
        updated.add(supplierId);
        // Clear selections for this supplier
        setLocalRows((rows) =>
          rows.map((r) =>
            r.supplierId === supplierId ? { ...r, selectedEmail: '' } : r
          )
        );
        setAdditionalSelections((selections) => {
          const newSelections = new Map(selections);
          newSelections.delete(supplierId);
          return newSelections;
        });
      }
      return updated;
    });
  };

  const handleInputChange = (supplierId: number, value: string) => {
    setLocalRows((prev) =>
      prev.map((row) =>
        row.supplierId === supplierId ? { ...row, selectedEmail: value } : row
      )
    );
  };

  const overrides = useMemo<EmailOverride[]>(() => {
    return localRows
      .filter((row) => row.selectedEmail?.trim())
      .map((row) => ({ supplierId: row.supplierId, email: row.selectedEmail.trim() }));
  }, [localRows]);

  const handleConfirm = () => {
    // Start with manual CC entries
    const ccSet = new Set(
      ccValue
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0)
    );

    // Add all additional selected emails to CC
    additionalSelections.forEach((emails, supplierId) => {
      // Only add CC if supplier is not skipped
      if (!skippedSuppliers.has(supplierId)) {
        emails.forEach((email) => ccSet.add(email.toLowerCase()));
      }
    });

    // Filter out skipped suppliers from overrides
    const filteredOverrides = overrides.filter(
      (override) => !skippedSuppliers.has(override.supplierId)
    );

    onConfirm({
      overrides: filteredOverrides,
      cc: Array.from(ccSet),
      skippedSuppliers: Array.from(skippedSuppliers),
      selectedAttachmentIds: Array.from(selectedAttachmentIds),
    });
  };

  // Helper to check if an email is selected (either as primary or additional)
  const isEmailSelected = (supplierId: number, email: string): 'primary' | 'cc' | false => {
    const row = localRows.find((r) => r.supplierId === supplierId);
    if (row?.selectedEmail === email) return 'primary';
    if (additionalSelections.get(supplierId)?.has(email)) return 'cc';
    return false;
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !loading && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Send Supplier Emails</DialogTitle>
          <DialogDescription>
            Click emails to select them. First selected = TO, additional selections = CC.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Additional CC (comma separated)</label>
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
                  <TableHead>Recipients (click to select multiple)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {localRows.map((row) => {
                  const additionalCount = additionalSelections.get(row.supplierId)?.size || 0;
                  const isSkipped = skippedSuppliers.has(row.supplierId);
                  const hasTo = !!row.selectedEmail?.trim();
                  return (
                    <TableRow key={row.supplierId} className={cn(isSkipped && 'opacity-50')}>
                      <TableCell className="font-medium align-top pt-4">
                        <div className="flex items-start gap-2">
                          <div className="flex-1">
                            {row.supplierName}
                            {!isSkipped && additionalCount > 0 && (
                              <div className="text-xs text-muted-foreground mt-1">
                                +{additionalCount} CC
                              </div>
                            )}
                            {!isSkipped && !hasTo && additionalCount > 0 && (
                              <div className="text-xs text-amber-500 mt-1">
                                CC only
                              </div>
                            )}
                            {isSkipped && (
                              <div className="text-xs text-muted-foreground mt-1">
                                Not sending
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2 items-center">
                            {/* Skip/Don't send button */}
                            <button
                              type="button"
                              onClick={() => handleToggleSkip(row.supplierId)}
                              className={cn(
                                'rounded-md border px-2 py-1 text-xs transition-colors flex items-center gap-1',
                                isSkipped
                                  ? 'bg-destructive/10 text-destructive border-destructive/50 font-medium'
                                  : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30'
                              )}
                              disabled={loading}
                            >
                              <X className="h-3 w-3" />
                              <span>{isSkipped ? 'Skipped' : "Don't send"}</span>
                            </button>

                            {/* Email options */}
                            {!isSkipped && row.options.length > 0 && (
                              <>
                                <span className="text-muted-foreground text-xs">|</span>
                                {row.options.map((option) => {
                                  const selectionStatus = isEmailSelected(row.supplierId, option.email);
                                  return (
                                    <button
                                      key={option.email}
                                      type="button"
                                      onClick={() => handleToggleEmail(row.supplierId, option.email, option.is_primary)}
                                      className={cn(
                                        'rounded-md border px-2 py-1 text-xs transition-colors flex items-center gap-1',
                                        selectionStatus === 'primary'
                                          ? 'bg-primary text-primary-foreground font-medium border-primary'
                                          : selectionStatus === 'cc'
                                          ? 'bg-muted font-medium border-muted-foreground/50'
                                          : 'text-muted-foreground hover:bg-muted/70'
                                      )}
                                      disabled={loading}
                                    >
                                      {selectionStatus && (
                                        <Check className="h-3 w-3" />
                                      )}
                                      <span>{option.email}</span>
                                      {option.is_primary && (
                                        <Badge variant="secondary" className="text-[10px] ml-1">
                                          Primary
                                        </Badge>
                                      )}
                                      {selectionStatus === 'primary' && (
                                        <Badge variant="outline" className="text-[10px] ml-1 bg-primary-foreground/20">
                                          TO
                                        </Badge>
                                      )}
                                      {selectionStatus === 'cc' && (
                                        <Badge variant="outline" className="text-[10px] ml-1">
                                          CC
                                        </Badge>
                                      )}
                                    </button>
                                  );
                                })}
                              </>
                            )}
                          </div>
                          {!isSkipped && row.options.length === 0 && (
                            <p className="text-sm text-muted-foreground">
                              No email on file. Provide one below.
                            </p>
                          )}
                          {!isSkipped && (
                            <Input
                              value={row.selectedEmail}
                              onChange={(e) => handleInputChange(row.supplierId, e.target.value)}
                              placeholder="supplier@example.com (primary recipient)"
                              disabled={loading}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Attachments section */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            <label className="text-sm font-medium">Email Attachments</label>
          </div>
          <div className="rounded-md border p-3 space-y-2">
            {/* PO PDF - always attached */}
            <div className="flex items-center gap-2 text-sm">
              <Checkbox checked disabled />
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Purchase Order PDF</span>
              <Badge variant="secondary" className="text-[10px]">Always attached</Badge>
            </div>
            {/* Uploaded attachments */}
            {attachments.map((att) => (
              <div key={att.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selectedAttachmentIds.has(att.id)}
                  onCheckedChange={(checked) => {
                    setSelectedAttachmentIds((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(att.id);
                      else next.delete(att.id);
                      return next;
                    });
                  }}
                  disabled={loading}
                />
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate flex-1">{att.original_name || 'Attachment'}</span>
                {att.file_size && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {att.file_size < 1024 * 1024
                      ? `${(att.file_size / 1024).toFixed(0)} KB`
                      : `${(att.file_size / (1024 * 1024)).toFixed(1)} MB`}
                  </span>
                )}
              </div>
            ))}
            {attachments.length === 0 && (
              <p className="text-xs text-muted-foreground">No additional attachments uploaded to this PO.</p>
            )}
          </div>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {hasMissing && (
            <p className="text-sm text-destructive">
              Please select at least one email for every supplier.
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

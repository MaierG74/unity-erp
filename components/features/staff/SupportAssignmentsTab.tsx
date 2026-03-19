'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, XCircle } from 'lucide-react';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';
import { fetchActiveStaff } from '@/lib/queries/factoryFloor';
import { fetchSupportLinks, type SupportLink } from '@/lib/queries/staffSupport';
import { useSupportLinks } from '@/hooks/use-support-links';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function SupportAssignmentsTab() {
  const { user } = useAuth();
  const orgId = getOrgId(user);
  const { create: createMutation, update: updateMutation, deactivate: deactivateMutation } = useSupportLinks();

  // State for dialogs
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<SupportLink | null>(null);

  // Form state
  const [primaryStaffId, setPrimaryStaffId] = useState('');
  const [supportStaffId, setSupportStaffId] = useState('');
  const [costSharePct, setCostSharePct] = useState('100');
  const [editCostSharePct, setEditCostSharePct] = useState('');

  // Queries
  const { data: links = [], isLoading } = useQuery({
    queryKey: ['support-links'],
    queryFn: fetchSupportLinks,
  });

  const { data: staffOptions = [] } = useQuery({
    queryKey: ['active-staff'],
    queryFn: fetchActiveStaff,
  });

  function resetAddForm() {
    setAddOpen(false);
    setPrimaryStaffId('');
    setSupportStaffId('');
    setCostSharePct('100');
  }

  function handleAdd() {
    if (!primaryStaffId || !supportStaffId || !orgId) return;
    const pct = parseFloat(costSharePct);
    if (isNaN(pct) || pct <= 0 || pct > 100) {
      toast.error('Cost share must be between 0 and 100');
      return;
    }
    if (primaryStaffId === supportStaffId) {
      toast.error('Primary and support staff must be different');
      return;
    }
    createMutation.mutate({
      primaryStaffId: parseInt(primaryStaffId),
      supportStaffId: parseInt(supportStaffId),
      costSharePct: pct,
      orgId,
    }, { onSuccess: resetAddForm });
  }

  function handleEdit() {
    if (!editingLink) return;
    const pct = parseFloat(editCostSharePct);
    if (isNaN(pct) || pct <= 0 || pct > 100) {
      toast.error('Cost share must be between 0 and 100');
      return;
    }
    updateMutation.mutate({ linkId: editingLink.link_id, pct }, {
      onSuccess: () => { setEditOpen(false); setEditingLink(null); },
    });
  }

  function openEdit(link: SupportLink) {
    setEditingLink(link);
    setEditCostSharePct(String(link.cost_share_pct));
    setEditOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Active Support Assignments</h3>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Link
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading support links...</p>
      ) : links.length === 0 ? (
        <p className="text-muted-foreground">No active support assignments.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Primary Worker</TableHead>
                <TableHead>Support Employee</TableHead>
                <TableHead className="text-right">Cost Share %</TableHead>
                <TableHead>Since</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => (
                <TableRow key={link.link_id}>
                  <TableCell>{link.primary_staff_name}</TableCell>
                  <TableCell>{link.support_staff_name}</TableCell>
                  <TableCell className="text-right">{link.cost_share_pct}%</TableCell>
                  <TableCell>{link.effective_from}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(link)}
                        title="Edit cost share"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deactivateMutation.mutate(link.link_id)}
                        title="Deactivate link"
                      >
                        <XCircle className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Link Dialog */}
      <Dialog open={addOpen} onOpenChange={(open) => { if (!open) resetAddForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Support Link</DialogTitle>
            <DialogDescription>
              Link a support employee to a primary worker. The support cost will be deducted from
              the primary worker&apos;s piecework at payroll time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Primary Worker</Label>
              <Select value={primaryStaffId} onValueChange={setPrimaryStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select primary worker" />
                </SelectTrigger>
                <SelectContent>
                  {staffOptions.map((s) => (
                    <SelectItem key={s.staff_id} value={String(s.staff_id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Support Employee</Label>
              <Select value={supportStaffId} onValueChange={setSupportStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select support employee" />
                </SelectTrigger>
                <SelectContent>
                  {staffOptions.map((s) => (
                    <SelectItem key={s.staff_id} value={String(s.staff_id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cost Share %</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={costSharePct}
                onChange={(e) => setCostSharePct(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetAddForm}>
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={!primaryStaffId || !supportStaffId || !orgId || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Link Dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { if (!open) { setEditOpen(false); setEditingLink(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Cost Share</DialogTitle>
            <DialogDescription>
              Update the cost share percentage for {editingLink?.support_staff_name} supporting{' '}
              {editingLink?.primary_staff_name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Cost Share %</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={editCostSharePct}
                onChange={(e) => setEditCostSharePct(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditOpen(false); setEditingLink(null); }}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

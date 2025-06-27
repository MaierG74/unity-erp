'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { StaffEditDialog } from './StaffEditDialog';

export function StaffTable() {
  const queryClient = useQueryClient();
  const [inlineEdits, setInlineEdits] = useState<Record<number, Partial<Record<string, any>>>>({});

  const handleInlineChange = (id: number, field: string, value: any) => {
    setInlineEdits(edits => ({ ...edits, [id]: { ...edits[id], [field]: value } }));
  };

  const handleInlineSave = (id: number, field: string) => {
    const val = inlineEdits[id]?.[field];
    if (val !== undefined) {
      updateMutation.mutate({ id, field, value: field === 'hourly_rate' ? parseFloat(val) : val });
      setInlineEdits(edits => {
        const { [id]: rowEdits, ...rest } = edits;
        if (!rowEdits) return rest;
        const { [field]: _, ...remaining } = rowEdits;
        if (Object.keys(remaining).length) rest[id] = remaining;
        return rest;
      });
    }
  };
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all'|'current'>('all');
  const [activeFilter, setActiveFilter] = useState<'all'|'active'|'inactive'>('all');
  const [sortField, setSortField] = useState<'first_name'|'last_name'>('first_name');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');
  const [editStaff, setEditStaff] = useState<any>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: staff = [] } = useQuery({
    queryKey: ['staff', { search, statusFilter, activeFilter, sortField, sortDir }],
    queryFn: async () => {
      let builder = supabase.from('staff').select('*');
      if (search) {
        const q = `%${search}%`;
        builder = builder.or(`first_name.ilike.${q},last_name.ilike.${q},phone.ilike.${q},job_description.ilike.${q}`);
      }
      if (statusFilter === 'current') builder = builder.eq('current_staff', true);
      if (activeFilter === 'active') builder = builder.eq('is_active', true);
      if (activeFilter === 'inactive') builder = builder.eq('is_active', false);
      builder = builder.order(sortField, { ascending: sortDir==='asc' });
      const { data, error } = await builder;
      if (error) throw error;
      return data || [];
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, field, value }: any) => {
      const { error } = await supabase.from('staff').update({ [field]: value }).eq('staff_id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });

  const onToggle = (id: number, field: string, value: boolean) => {
    updateMutation.mutate({ id, field, value });
  };

  const openEdit = (staff: any) => {
    setEditStaff(staff);
    setDialogOpen(true);
  };

  return (
    <>
      <div className="flex gap-2 mb-4">
        <Input
          placeholder="Search name/phone"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Select value={statusFilter} onValueChange={(v: 'all' | 'current') => setStatusFilter(v)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All staff</SelectItem>
            <SelectItem value="current">Current only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={activeFilter} onValueChange={(v: 'all' | 'active' | 'inactive') => setActiveFilter(v)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead onClick={() => {
              const dir = sortField==='first_name' && sortDir==='asc' ? 'desc' : 'asc';
              setSortField('first_name'); setSortDir(dir);
            }} className="cursor-pointer">First Name</TableHead>
            <TableHead onClick={() => {
              const dir = sortField==='last_name' && sortDir==='asc' ? 'desc' : 'asc';
              setSortField('last_name'); setSortDir(dir);
            }} className="cursor-pointer">Last Name</TableHead>
            <TableHead>Job Description</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Rate</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Current</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {staff.map(row => (
            <TableRow key={row.staff_id}>
              <TableCell>
  <Input
    value={inlineEdits[row.staff_id]?.first_name ?? row.first_name}
    className="w-32"
    onChange={e => handleInlineChange(row.staff_id, 'first_name', e.target.value)}
    onBlur={() => handleInlineSave(row.staff_id, 'first_name')}
    onKeyDown={e => e.key === 'Enter' && handleInlineSave(row.staff_id, 'first_name')}
  />
</TableCell>
              <TableCell>
  <Input
    value={inlineEdits[row.staff_id]?.last_name ?? row.last_name}
    className="w-32"
    onChange={e => handleInlineChange(row.staff_id, 'last_name', e.target.value)}
    onBlur={() => handleInlineSave(row.staff_id, 'last_name')}
    onKeyDown={e => e.key === 'Enter' && handleInlineSave(row.staff_id, 'last_name')}
  />
</TableCell>
              <TableCell>
  <Input
    value={inlineEdits[row.staff_id]?.job_description ?? (row.job_description|| '')}
    className="w-40"
    onChange={e => handleInlineChange(row.staff_id, 'job_description', e.target.value)}
    onBlur={() => handleInlineSave(row.staff_id, 'job_description')}
    onKeyDown={e => e.key === 'Enter' && handleInlineSave(row.staff_id, 'job_description')}
  />
</TableCell>
              <TableCell>
  <Input
    value={inlineEdits[row.staff_id]?.phone ?? (row.phone|| '')}
    className="w-32"
    onChange={e => handleInlineChange(row.staff_id, 'phone', e.target.value)}
    onBlur={() => handleInlineSave(row.staff_id, 'phone')}
    onKeyDown={e => e.key === 'Enter' && handleInlineSave(row.staff_id, 'phone')}
  />
</TableCell>
              <TableCell>
               <Input
                 value={inlineEdits[row.staff_id]?.hourly_rate ?? row.hourly_rate?.toString()}
                 className="w-20"
                 onChange={e => handleInlineChange(row.staff_id, 'hourly_rate', e.target.value)}
                 onBlur={() => handleInlineSave(row.staff_id, 'hourly_rate')}
                 onKeyDown={e => e.key === 'Enter' && handleInlineSave(row.staff_id, 'hourly_rate')}
               />
             </TableCell>
              <TableCell>
                <Switch
                  className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-destructive"
                  checked={row.is_active}
                  onCheckedChange={val => onToggle(row.staff_id, 'is_active', val)}
                />
              </TableCell>
              <TableCell>
                <Switch
                  className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-destructive"
                  checked={row.current_staff}
                  onCheckedChange={val => onToggle(row.staff_id, 'current_staff', val)}
                />
              </TableCell>
              <TableCell className="text-right">
                <Button size="icon" variant="outline" onClick={() => openEdit(row)}>Edit</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <StaffEditDialog
        staff={editStaff}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}

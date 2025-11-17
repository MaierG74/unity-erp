'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
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
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { StaffEditDialog } from './StaffEditDialog';
import { Badge } from '@/components/ui/badge';
import { Check, X } from 'lucide-react';

export function StaffTable() {
  const queryClient = useQueryClient();
  const [inlineEdits, setInlineEdits] = useState<Record<number, Partial<Record<string, any>>>>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'current'>('all');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [sortField, setSortField] = useState<'first_name' | 'last_name'>('first_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [editStaff, setEditStaff] = useState<any>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Fetch staff list
  const { data: staff = [] } = useQuery({
  queryKey: ['staff', search, statusFilter, activeFilter, sortField, sortDir],
  queryFn: async () => {
    let builder = supabase.from('staff').select('*');
    if (search) {
      const searchPattern = `%${search}%`;
      builder = builder.or(`first_name.ilike.${searchPattern},last_name.ilike.${searchPattern},phone.ilike.${searchPattern},job_description.ilike.${searchPattern}`);
    }
    if (statusFilter === 'current') builder = builder.eq('current_staff', true);
    if (activeFilter === 'active') builder = builder.eq('is_active', true);
    if (activeFilter === 'inactive') builder = builder.eq('is_active', false);
    builder = builder.order(sortField, { ascending: sortDir === 'asc' });
    const { data, error } = await builder;
    if (error) {
      console.error('Staff query error:', error);
      throw error;
    }
    return data || [];
  },
});

  // Fetch facial registration IDs
  const { data: registeredStaffIds = [] } = useQuery({
  queryKey: ['facialProfiles'],
  queryFn: async () => {
    try {
      const { data, error } = await supabase.rpc('get_facial_profiles_for_active_staff');
      if (error) {
        console.error('RPC error:', error);
        // Return empty array if RPC fails (function might not exist)
        return [];
      }
      return (data as any[]).map((p) => p.staff_id);
    } catch (err) {
      console.error('Facial profiles fetch error:', err);
      return [];
    }
  },
  retry: false,
});

  // Mutation for updates
  const updateMutation = useMutation({
  mutationFn: async ({ id, field, value }: any) => {
    const { error } = await supabase.from('staff').update({ [field]: value }).eq('staff_id', id);
    if (error) throw error;
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
});

  const handleInlineChange = (id: number, field: string, value: any) => {
    setInlineEdits((e) => ({ ...e, [id]: { ...e[id], [field]: value } }));
  };

  const handleInlineSave = (id: number, field: string) => {
    const val = inlineEdits[id]?.[field];
    if (val !== undefined) {
      updateMutation.mutate({ id, field, value: field === 'hourly_rate' ? parseFloat(val) : val });
      setInlineEdits((e) => {
        const { [id]: removed, ...rest } = e;
        if (!removed) return rest;
        const { [field]: _, ...rem } = removed;
        if (Object.keys(rem).length) rest[id] = rem;
        return rest;
      });
    }
  };

  const onToggle = (id: number, field: string, value: boolean) => updateMutation.mutate({ id, field, value });
  const openEdit = (s: any) => { setEditStaff(s); setDialogOpen(true); };

  return (
    <>
      <div className="flex gap-2 mb-4">
        <Input placeholder="Search name/phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All staff</SelectItem>
            <SelectItem value="current">Current only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={activeFilter} onValueChange={(v) => setActiveFilter(v)}>
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
            <TableHead className="cursor-pointer" onClick={() => { const dir = sortField === 'first_name' && sortDir === 'asc' ? 'desc' : 'asc'; setSortField('first_name'); setSortDir(dir); }}>First Name</TableHead>
            <TableHead className="cursor-pointer" onClick={() => { const dir = sortField === 'last_name' && sortDir === 'asc' ? 'desc' : 'asc'; setSortField('last_name'); setSortDir(dir); }}>Last Name</TableHead>
            <TableHead>Job Description</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Rate</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Face Reg</TableHead>
            <TableHead>Current</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {staff.map((row) => (
            <TableRow key={row.staff_id}>
              <TableCell><Input className="w-32" value={inlineEdits[row.staff_id]?.first_name ?? row.first_name} onChange={(e) => handleInlineChange(row.staff_id, 'first_name', e.target.value)} onBlur={() => handleInlineSave(row.staff_id, 'first_name')} onKeyDown={(e) => e.key==='Enter'&&handleInlineSave(row.staff_id,'first_name')} /></TableCell>
              <TableCell><Input className="w-32" value={inlineEdits[row.staff_id]?.last_name ?? row.last_name} onChange={(e) => handleInlineChange(row.staff_id, 'last_name', e.target.value)} onBlur={() => handleInlineSave(row.staff_id, 'last_name')} onKeyDown={(e) => e.key==='Enter'&&handleInlineSave(row.staff_id,'last_name')} /></TableCell>
              <TableCell><Input className="w-40" value={inlineEdits[row.staff_id]?.job_description ?? (row.job_description||'')} onChange={(e) => handleInlineChange(row.staff_id, 'job_description', e.target.value)} onBlur={() => handleInlineSave(row.staff_id, 'job_description')} onKeyDown={(e) => e.key==='Enter'&&handleInlineSave(row.staff_id,'job_description')} /></TableCell>
              <TableCell><Input className="w-32" value={inlineEdits[row.staff_id]?.phone ?? (row.phone||'')} onChange={(e) => handleInlineChange(row.staff_id, 'phone', e.target.value)} onBlur={() => handleInlineSave(row.staff_id, 'phone')} onKeyDown={(e) => e.key==='Enter'&&handleInlineSave(row.staff_id,'phone')} /></TableCell>
              <TableCell><Input className="w-20" value={inlineEdits[row.staff_id]?.hourly_rate ?? row.hourly_rate?.toString()} onChange={(e) => handleInlineChange(row.staff_id, 'hourly_rate', e.target.value)} onBlur={() => handleInlineSave(row.staff_id, 'hourly_rate')} onKeyDown={(e) => e.key==='Enter'&&handleInlineSave(row.staff_id,'hourly_rate')} /></TableCell>
              <TableCell><Switch checked={row.is_active} onCheckedChange={(v)=>onToggle(row.staff_id,'is_active',v)} className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-destructive" /></TableCell>
              <TableCell className="text-center">
  {registeredStaffIds.includes(row.staff_id) ? (
    <Check className="text-green-500 w-4 h-4" />
  ) : (
    <X className="text-red-500 w-4 h-4" />
  )}
</TableCell>
              <TableCell><Switch checked={row.current_staff} onCheckedChange={(v)=>onToggle(row.staff_id,'current_staff',v)} className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-destructive" /></TableCell>
              <TableCell className="text-right"><Button size="icon" variant="outline" onClick={()=>openEdit(row)}>Edit</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <StaffEditDialog staff={editStaff} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

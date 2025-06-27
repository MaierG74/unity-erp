'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface StaffEditDialogProps {
  staff: {
    staff_id: number;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    job_description: string | null;
    hourly_rate: number;
    is_active: boolean;
    current_staff: boolean;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StaffEditDialog({ staff, open, onOpenChange }: StaffEditDialogProps) {
  const [form, setForm] = useState({
    staff_id: null,
    first_name: '', last_name: '', email: '', phone: '', job_description: '', hourly_rate: '',
    is_active: true, current_staff: true,
  });
  const queryClient = useQueryClient();

  useEffect(() => {
    if (staff) {
      setForm({
        staff_id: staff.staff_id,
        first_name: staff.first_name || '',
        last_name: staff.last_name || '',
        email: staff.email || '',
        phone: staff.phone || '',
        job_description: staff.job_description || '',
        hourly_rate: staff.hourly_rate?.toString() || '',
        is_active: staff.is_active,
        current_staff: staff.current_staff,
      });
    }
  }, [staff]);

  const mutation = useMutation<void, Error, typeof form>({
    mutationFn: async (data) => {
      if (data.staff_id) {
        const { error } = await supabase.from('staff').update({
          first_name: data.first_name,
          last_name: data.last_name,
          email: data.email,
          phone: data.phone,
          job_description: data.job_description,
          hourly_rate: parseFloat(data.hourly_rate),
          is_active: data.is_active,
          current_staff: data.current_staff,
        }).eq('staff_id', data.staff_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('staff').insert({
          first_name: data.first_name,
          last_name: data.last_name,
          email: data.email,
          phone: data.phone,
          job_description: data.job_description,
          hourly_rate: parseFloat(data.hourly_rate),
          is_active: data.is_active,
          current_staff: data.current_staff,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      onOpenChange(false);
    }
  });

  const handleSave = () => {
    mutation.mutate({ ...form, hourly_rate: form.hourly_rate });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form.staff_id ? 'Edit Staff Member' : 'Add Staff Member'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>First Name</Label>
              <Input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
            </div>
            <div>
              <Label>Last Name</Label>
              <Input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Job Description</Label>
            <Input value={form.job_description} onChange={e => setForm(f => ({ ...f, job_description: e.target.value }))} />
          </div>
          <div>
            <Label>Hourly Rate</Label>
            <Input value={form.hourly_rate} onChange={e => setForm(f => ({ ...f, hourly_rate: e.target.value }))} />
          </div>
          <div className="flex items-center gap-4">
            <Switch checked={form.is_active} onCheckedChange={val => setForm(f => ({ ...f, is_active: val }))} />
            <Label>Active</Label>
            <Switch checked={form.current_staff} onCheckedChange={val => setForm(f => ({ ...f, current_staff: val }))} />
            <Label>Current Staff</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

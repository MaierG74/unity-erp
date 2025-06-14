'use client';

import { supabase } from '@/lib/supabase';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit, Trash2, Eye } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/components/ui/use-toast';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { StaffViewModal } from './StaffViewModal';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

type Staff = {
  staff_id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  job_description: string | null;
  hourly_rate: number;
  is_active: boolean;
  current_staff: boolean;
  date_of_birth?: string | null;
  hire_date?: string | null;
  address?: string | null;
  weekly_hours?: number | null;
  tax_number?: string | null;
  bank_account_image_urls?: string[];
  id_document_urls?: string[];
  airtable_id?: string | null;
};

export function StaffList() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [viewStaff, setViewStaff] = useState<Staff | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [deleteStaff, setDeleteStaff] = useState<Staff | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  // Fetch staff data using React Query
  const { data: staff = [], isLoading, error } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .order('last_name', { ascending: true });

      if (error) {
        throw error;
      }

      return data || [];
    },
  });

  // Delete staff mutation
  const deleteStaffMutation = useMutation({
    mutationFn: async (staffId: number) => {
      const { error } = await supabase
        .from('staff')
        .delete()
        .eq('staff_id', staffId);

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast({
        title: 'Success',
        children: <p>Staff member deleted successfully</p>,
      });
      setIsDeleteDialogOpen(false);
    },
    onError: (error: any) => {
      console.error('Error deleting staff:', error);
      toast({
        title: 'Error',
        children: <p>Failed to delete staff member: {error.message}</p>,
        variant: 'destructive',
      });
    },
  });

  const handleViewStaff = (staff: Staff) => {
    setViewStaff(staff);
    setIsViewModalOpen(true);
  };

  const handleDeleteStaff = (staff: Staff) => {
    setDeleteStaff(staff);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (deleteStaff) {
      deleteStaffMutation.mutate(deleteStaff.staff_id);
    }
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading staff data...</div>;
  }

  if (error) {
    return (
      <div className="text-center py-8 text-destructive">
        <p>Error: {(error as Error).message}</p>
        <Button onClick={() => queryClient.invalidateQueries({ queryKey: ['staff'] })} className="mt-4">
          Retry
        </Button>
      </div>
    );
  }

  if (staff.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No staff members found.</p>
        <Button asChild className="mt-4">
          <Link href="/staff/new">Add Staff Member</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Job Description</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Hourly Rate</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {staff.map((staffMember) => (
            <TableRow key={staffMember.staff_id}>
              <TableCell className="font-medium">
                {staffMember.first_name} {staffMember.last_name}
              </TableCell>
              <TableCell>{staffMember.job_description || 'N/A'}</TableCell>
              <TableCell>{staffMember.phone || 'N/A'}</TableCell>
              <TableCell>{staffMember.email || 'N/A'}</TableCell>
              <TableCell>R{Number(staffMember.hourly_rate).toFixed(2)}</TableCell>
              <TableCell>
                {staffMember.is_active ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="outline">Inactive</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button 
                    variant="outline" 
                    size="icon" 
                    onClick={() => handleViewStaff(staffMember)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" asChild>
                    <Link href={`/staff/${staffMember.staff_id}/edit`}>
                      <Edit className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleDeleteStaff(staffMember)}
                    disabled={deleteStaffMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* View Staff Modal */}
      <StaffViewModal 
        staff={viewStaff} 
        open={isViewModalOpen} 
        onOpenChange={setIsViewModalOpen} 
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={confirmDelete}
        isDeleting={deleteStaffMutation.isPending}
        staffName={deleteStaff ? `${deleteStaff.first_name} ${deleteStaff.last_name}` : ''}
      />
    </div>
  );
} 
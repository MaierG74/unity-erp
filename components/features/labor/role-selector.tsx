'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Plus, Loader2, Users } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

export interface LaborRole {
  role_id: number;
  name: string;
  description: string | null;
  color: string | null;
  created_at: string;
}

interface RoleSelectorProps {
  value?: string | number | null;
  onChange: (roleId: string | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  allowClear?: boolean;
  showAddOption?: boolean;
}

export function RoleSelector({
  value,
  onChange,
  placeholder = 'Select role',
  className,
  disabled = false,
  allowClear = true,
  showAddOption = true,
}: RoleSelectorProps) {
  const [isAddRoleOpen, setIsAddRoleOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#6366f1'); // Default indigo

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch roles
  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['laborRoles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_roles')
        .select('*')
        .order('name');

      if (error) throw error;
      return data as LaborRole[];
    },
  });

  // Add role mutation
  const addRole = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('labor_roles')
        .insert({
          name: newRoleName.trim(),
          description: newRoleDescription.trim() || null,
          color: newRoleColor,
        })
        .select()
        .single();

      if (error) throw error;
      return data as LaborRole;
    },
    onSuccess: (newRole) => {
      queryClient.invalidateQueries({ queryKey: ['laborRoles'] });
      // Auto-select the newly created role
      onChange(newRole.role_id.toString());
      setIsAddRoleOpen(false);
      setNewRoleName('');
      setNewRoleDescription('');
      setNewRoleColor('#6366f1');
      toast({
        title: 'Role created',
        description: `"${newRole.name}" has been added`,
      });
    },
    onError: (error: any) => {
      if (error.code === '23505') {
        toast({
          title: 'Role exists',
          description: 'A role with this name already exists',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Error',
          description: 'Failed to create role',
          variant: 'destructive',
        });
      }
      console.error('Error creating role:', error);
    },
  });

  const handleValueChange = (newValue: string) => {
    if (newValue === '_add_new') {
      setIsAddRoleOpen(true);
    } else if (newValue === '_none') {
      onChange(null);
    } else {
      onChange(newValue);
    }
  };

  const handleAddRole = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    addRole.mutate();
  };

  // Convert value to string for Select component
  const stringValue = value ? value.toString() : '';

  return (
    <>
      <Select
        value={stringValue || '_none'}
        onValueChange={handleValueChange}
        disabled={disabled || isLoading}
      >
        <SelectTrigger className={cn('h-9', className)}>
          <SelectValue placeholder={placeholder}>
            {isLoading ? (
              <span className="text-muted-foreground">Loading...</span>
            ) : stringValue ? (
              <span className="flex items-center gap-2">
                {roles.find(r => r.role_id.toString() === stringValue)?.color && (
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: roles.find(r => r.role_id.toString() === stringValue)?.color || undefined }}
                  />
                )}
                {roles.find(r => r.role_id.toString() === stringValue)?.name || placeholder}
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allowClear && (
            <SelectItem value="_none" className="text-muted-foreground">
              No role assigned
            </SelectItem>
          )}

          {roles.map((role) => (
            <SelectItem key={role.role_id} value={role.role_id.toString()}>
              <span className="flex items-center gap-2">
                {role.color && (
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: role.color }}
                  />
                )}
                {role.name}
              </span>
            </SelectItem>
          ))}

          {showAddOption && (
            <>
              <div className="my-1 h-px bg-border" />
              <SelectItem value="_add_new" className="text-primary font-medium">
                <span className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add new role...
                </span>
              </SelectItem>
            </>
          )}
        </SelectContent>
      </Select>

      {/* Add Role Dialog */}
      <Dialog open={isAddRoleOpen} onOpenChange={setIsAddRoleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Add New Role
            </DialogTitle>
            <DialogDescription>
              Create a new labor role for job assignments
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddRole} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="roleName">Role Name</Label>
              <Input
                id="roleName"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="e.g., Assembler, Welder, Painter"
                className="h-9"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="roleDescription">Description (optional)</Label>
              <Textarea
                id="roleDescription"
                value={newRoleDescription}
                onChange={(e) => setNewRoleDescription(e.target.value)}
                placeholder="Brief description of this role..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="roleColor">Color</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  id="roleColor"
                  value={newRoleColor}
                  onChange={(e) => setNewRoleColor(e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded border bg-transparent"
                />
                <Input
                  value={newRoleColor}
                  onChange={(e) => setNewRoleColor(e.target.value)}
                  placeholder="#6366f1"
                  className="h-9 w-28 font-mono text-sm"
                />
                <span className="text-sm text-muted-foreground">
                  For visual distinction
                </span>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setIsAddRoleOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-9"
                disabled={!newRoleName.trim() || addRole.isPending}
              >
                {addRole.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Role
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Hook to fetch roles for use in other components
export function useLaborRoles() {
  return useQuery({
    queryKey: ['laborRoles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_roles')
        .select('*')
        .order('name');

      if (error) throw error;
      return data as LaborRole[];
    },
  });
}

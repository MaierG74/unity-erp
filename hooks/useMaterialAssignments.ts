'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { toast } from 'sonner';
import type { AggregateResponse } from '@/lib/orders/cutting-plan-types';
import type {
  MaterialAssignments,
  MaterialAssignment,
  BackerDefault,
  PartRole,
} from '@/lib/orders/material-assignment-types';
import {
  findAssignment,
  upsertAssignment,
  bulkAssign,
  roleFingerprint,
} from '@/lib/orders/material-assignment-types';

const EMPTY: MaterialAssignments = { version: 1, assignments: [], backer_default: null };
const DEBOUNCE_MS = 800;

export function useMaterialAssignments(orderId: number) {
  const queryClient = useQueryClient();
  const [localAssignments, setLocalAssignments] = useState<MaterialAssignments | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Promise<void> | null>(null);

  const query = useQuery({
    queryKey: ['material-assignments', orderId],
    queryFn: async (): Promise<MaterialAssignments | null> => {
      const res = await authorizedFetch(`/api/orders/${orderId}/material-assignments`);
      if (!res.ok) throw new Error('Failed to load material assignments');
      const data = await res.json();
      return data ?? null;
    },
  });

  const assignments = localAssignments ?? query.data ?? EMPTY;

  const doSave = useCallback(
    async (next: MaterialAssignments) => {
      const res = await authorizedFetch(`/api/orders/${orderId}/material-assignments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || 'Failed to save material assignments');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['material-assignments', orderId] });
      queryClient.invalidateQueries({ queryKey: ['order-cutting-plan', orderId] });
    },
    [orderId, queryClient],
  );

  const save = useCallback(
    (next: MaterialAssignments) => {
      setLocalAssignments(next);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      pendingSaveRef.current = new Promise<void>((resolve) => {
        saveTimerRef.current = setTimeout(async () => {
          await doSave(next);
          pendingSaveRef.current = null;
          resolve();
        }, DEBOUNCE_MS);
      });
    },
    [doSave],
  );

  const flush = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (localAssignments) {
      await doSave(localAssignments);
      pendingSaveRef.current = null;
    }
  }, [localAssignments, doSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const assign = useCallback(
    (boardType: string, partName: string, lengthMm: number, widthMm: number, componentId: number, componentName: string) => {
      const next: MaterialAssignments = {
        ...assignments,
        assignments: upsertAssignment(assignments.assignments, {
          board_type: boardType,
          part_name: partName,
          length_mm: lengthMm,
          width_mm: widthMm,
          component_id: componentId,
          component_name: componentName,
        }),
      };
      save(next);
    },
    [assignments, save],
  );

  const assignBulk = useCallback(
    (
      roles: Array<{ board_type: string; part_name: string; length_mm: number; width_mm: number }>,
      componentId: number,
      componentName: string,
    ) => {
      const next: MaterialAssignments = {
        ...assignments,
        assignments: bulkAssign(assignments.assignments, roles, componentId, componentName),
      };
      save(next);
    },
    [assignments, save],
  );

  const setBackerDefault = useCallback(
    (backer: BackerDefault | null) => {
      const next: MaterialAssignments = { ...assignments, backer_default: backer };
      save(next);
    },
    [assignments, save],
  );

  const buildPartRoles = useCallback(
    (agg: AggregateResponse): PartRole[] => {
      const map = new Map<string, PartRole>();
      for (const group of agg.material_groups) {
        for (const part of group.parts) {
          const fp = roleFingerprint(group.board_type, part.name, part.length_mm, part.width_mm);
          const existing = map.get(fp);
          const match = findAssignment(
            assignments.assignments,
            group.board_type,
            part.name,
            part.length_mm,
            part.width_mm,
          );
          if (existing) {
            existing.total_quantity += part.quantity;
            if (!existing.product_names.includes(part.product_name)) {
              existing.product_names.push(part.product_name);
            }
          } else {
            map.set(fp, {
              board_type: group.board_type,
              part_name: part.name,
              length_mm: part.length_mm,
              width_mm: part.width_mm,
              total_quantity: part.quantity,
              product_names: [part.product_name],
              assigned_component_id: match?.component_id ?? null,
              assigned_component_name: match?.component_name ?? null,
            });
          }
        }
      }
      return Array.from(map.values());
    },
    [assignments],
  );

  const isComplete = useCallback(
    (roles: PartRole[]): boolean => roles.every((r) => r.assigned_component_id != null),
    [],
  );

  return {
    assignments,
    isLoading: query.isLoading,
    assign,
    assignBulk,
    setBackerDefault,
    buildPartRoles,
    isComplete,
    flush,
  };
}

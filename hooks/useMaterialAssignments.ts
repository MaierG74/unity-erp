'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { toast } from 'sonner';
import type {
  MaterialAssignments,
  MaterialAssignment,
  BackerDefault,
  EdgingDefault,
  EdgingOverride,
} from '@/lib/orders/material-assignment-types';
import {
  upsertAssignment,
  bulkAssign,
} from '@/lib/orders/material-assignment-types';

const EMPTY: MaterialAssignments = { version: 1, assignments: [], backer_default: null, edging_defaults: [], edging_overrides: [] };
const DEBOUNCE_MS = 800;

export function useMaterialAssignments(orderId: number) {
  const queryClient = useQueryClient();
  const [localAssignments, setLocalAssignments] = useState<MaterialAssignments | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Promise<void> | null>(null);
  const pendingPayloadRef = useRef<MaterialAssignments | null>(null);

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
        const msg = body.error || 'Failed to save material assignments';
        toast.error(msg);
        throw new Error(msg);
      }
      queryClient.invalidateQueries({ queryKey: ['material-assignments', orderId] });
      queryClient.invalidateQueries({ queryKey: ['order-cutting-plan', orderId] });
    },
    [orderId, queryClient],
  );

  const save = useCallback(
    (next: MaterialAssignments) => {
      setLocalAssignments(next);
      pendingPayloadRef.current = next;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        if (pendingPayloadRef.current) {
          try {
            await doSave(pendingPayloadRef.current);
            pendingPayloadRef.current = null;
          } catch {
            // doSave already toasts; keep pendingPayloadRef so flush retries
          }
        }
      }, DEBOUNCE_MS);
    },
    [doSave],
  );

  /**
   * Flush pending save immediately. Throws if save fails — callers
   * (e.g., generate) should abort on failure.
   */
  const flush = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (pendingPayloadRef.current) {
      await doSave(pendingPayloadRef.current); // throws on failure
      pendingPayloadRef.current = null; // only clear on success
    }
  }, [doSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (pendingPayloadRef.current) {
        doSave(pendingPayloadRef.current).catch(() => {});
      }
    };
  }, [doSave]);

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

  const setEdgingDefault = useCallback(
    (boardComponentId: number, edgingComponentId: number, edgingComponentName: string) => {
      const current = assignments.edging_defaults ?? [];
      const idx = current.findIndex((ed) => ed.board_component_id === boardComponentId);
      const entry: EdgingDefault = {
        board_component_id: boardComponentId,
        edging_component_id: edgingComponentId,
        edging_component_name: edgingComponentName,
      };
      const next: EdgingDefault[] =
        idx >= 0
          ? current.map((ed, i) => (i === idx ? entry : ed))
          : [...current, entry];
      save({ ...assignments, edging_defaults: next });
    },
    [assignments, save],
  );

  const setEdgingOverride = useCallback(
    (
      boardType: string,
      partName: string,
      lengthMm: number,
      widthMm: number,
      edgingComponentId: number,
      edgingComponentName: string,
    ) => {
      const current = assignments.edging_overrides ?? [];
      const idx = current.findIndex(
        (eo) =>
          eo.board_type === boardType &&
          eo.part_name === partName &&
          eo.length_mm === lengthMm &&
          eo.width_mm === widthMm,
      );
      const entry: EdgingOverride = {
        board_type: boardType,
        part_name: partName,
        length_mm: lengthMm,
        width_mm: widthMm,
        edging_component_id: edgingComponentId,
        edging_component_name: edgingComponentName,
      };
      const next: EdgingOverride[] =
        idx >= 0
          ? current.map((eo, i) => (i === idx ? entry : eo))
          : [...current, entry];
      save({ ...assignments, edging_overrides: next });
    },
    [assignments, save],
  );

  return {
    assignments,
    isLoading: query.isLoading,
    assign,
    assignBulk,
    setBackerDefault,
    setEdgingDefault,
    setEdgingOverride,
    flush,
  };
}

'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { parseThicknessFromDescription, parseSheetThickness } from '@/lib/cutlist/boardCalculator';

/** Board-category IDs (primary boards) */
const PRIMARY_BOARD_CATEGORY_IDS = [75, 3, 14]; // Melamine, MDF, Plywood
/**
 * Backer-category IDs.
 * In practice ~90% of backers are Super-White Melamine; MDF is the remainder.
 * Plywood (category 14) is excluded — it is used for chair seats and backs,
 * not as a cabinet backer. The cutlist flow is for desks, cupboards, and
 * pedestals; chair work does not pass through the backer picker.
 */
const BACKER_CATEGORY_IDS = [75, 3]; // Melamine, MDF
/** Edging category ID */
const EDGING_CATEGORY_ID = 39;

export type BoardComponent = {
  component_id: number;
  internal_code: string;
  description: string;
  category_id: number;
  parsed_thickness_mm: number | null;
};

/**
 * Fetch all active board components. Cached globally — boards don't change often.
 */
export function useBoardComponents() {
  return useQuery({
    queryKey: ['board-components'],
    queryFn: async (): Promise<BoardComponent[]> => {
      const { data, error } = await supabase
        .from('components')
        .select('component_id, internal_code, description, category_id')
        .in('category_id', PRIMARY_BOARD_CATEGORY_IDS)
        .eq('is_active', true)
        .order('internal_code');

      if (error) throw new Error(error.message);

      return (data ?? []).map((c) => ({
        component_id: c.component_id,
        internal_code: c.internal_code ?? '',
        description: c.description ?? '',
        category_id: c.category_id,
        parsed_thickness_mm: parseThicknessFromDescription(c.description ?? ''),
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

const BACKER_CATEGORY_SET = new Set(BACKER_CATEGORY_IDS);

/**
 * Backer board components (MDF, Plywood) — derived from the primary query.
 * No extra network request; backers vary widely (3mm, 6mm, 9mm) so no thickness filter.
 */
export function useBackerComponents() {
  const { data, ...rest } = useBoardComponents();
  const backerData = useMemo(
    () => data?.filter((b) => BACKER_CATEGORY_SET.has(b.category_id)),
    [data],
  );
  return { data: backerData, ...rest };
}

/**
 * Fetch active edging components (category 39).
 * Reuses BoardComponent type — edging components have
 * parsed_thickness_mm from their description (e.g., "16mm" PVC).
 */
export function useEdgingComponents() {
  return useQuery({
    queryKey: ['edging-components'],
    queryFn: async (): Promise<BoardComponent[]> => {
      const { data, error } = await supabase
        .from('components')
        .select('component_id, internal_code, description, category_id')
        .eq('category_id', EDGING_CATEGORY_ID)
        .eq('is_active', true)
        .order('internal_code');

      if (error) throw new Error(error.message);

      return (data ?? []).map((c) => ({
        component_id: c.component_id,
        internal_code: c.internal_code ?? '',
        description: c.description ?? '',
        category_id: c.category_id,
        parsed_thickness_mm: parseThicknessFromDescription(c.description ?? ''),
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Filter board components to those matching a board_type's sheet thickness.
 * "16mm" → 16, "32mm-both" → 16 (half), "32mm-backer" → 16 (half).
 */
export function filterByBoardType(
  boards: BoardComponent[],
  boardType: string,
): BoardComponent[] {
  const targetThickness = parseSheetThickness(boardType);
  return boards.filter((b) => b.parsed_thickness_mm === targetThickness);
}

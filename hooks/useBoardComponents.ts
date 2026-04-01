'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { parseThicknessFromDescription, parseSheetThickness } from '@/lib/cutlist/boardCalculator';

/** Board-category IDs (primary boards) */
const PRIMARY_BOARD_CATEGORY_IDS = [75, 3, 14]; // Melamine, MDF, Plywood
/** Backer-category IDs (typically MDF, Plywood — thinner sheets) */
const BACKER_CATEGORY_IDS = [3, 14]; // MDF, Plywood

export type BoardComponent = {
  component_id: number;
  internal_code: string;
  description: string;
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
        .select('component_id, internal_code, description')
        .in('category_id', PRIMARY_BOARD_CATEGORY_IDS)
        .eq('is_active', true)
        .order('internal_code');

      if (error) throw new Error(error.message);

      return (data ?? []).map((c) => ({
        component_id: c.component_id,
        internal_code: c.internal_code ?? '',
        description: c.description ?? '',
        parsed_thickness_mm: parseThicknessFromDescription(c.description ?? ''),
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch backer board components (MDF, Plywood). No thickness filtering —
 * backers vary widely (3mm, 6mm, 9mm) and users should see all options.
 */
export function useBackerComponents() {
  return useQuery({
    queryKey: ['backer-components'],
    queryFn: async (): Promise<BoardComponent[]> => {
      const { data, error } = await supabase
        .from('components')
        .select('component_id, internal_code, description')
        .in('category_id', BACKER_CATEGORY_IDS)
        .eq('is_active', true)
        .order('internal_code');

      if (error) throw new Error(error.message);

      return (data ?? []).map((c) => ({
        component_id: c.component_id,
        internal_code: c.internal_code ?? '',
        description: c.description ?? '',
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

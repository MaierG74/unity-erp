'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface JobCategory {
  category_id: number;
  name: string;
  description: string | null;
  current_hourly_rate: number;
  parent_category_id: number | null;
}

export function useCategoryTree() {
  const { data: allCategories = [], isLoading } = useQuery({
    queryKey: ['jobCategories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_categories')
        .select('*')
        .order('name');
      if (error) throw error;
      return (data ?? []) as JobCategory[];
    },
  });

  const { parentCategories, childrenByParent } = useMemo(() => {
    const parents: JobCategory[] = [];
    const children = new Map<number, JobCategory[]>();

    for (const cat of allCategories) {
      if (cat.parent_category_id === null) {
        parents.push(cat);
      } else {
        const list = children.get(cat.parent_category_id) || [];
        list.push(cat);
        children.set(cat.parent_category_id, list);
      }
    }

    return { parentCategories: parents, childrenByParent: children };
  }, [allCategories]);

  /** Get subcategory IDs for a parent (useful for filtering) */
  const getSubcategoryIds = (parentId: number): number[] => {
    return (childrenByParent.get(parentId) || []).map(c => c.category_id);
  };

  return {
    allCategories,
    parentCategories,
    childrenByParent,
    getSubcategoryIds,
    isLoading,
  };
}

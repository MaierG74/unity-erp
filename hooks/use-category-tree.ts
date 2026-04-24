'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchJobCategories,
  type JobCategoryWithRate,
} from '@/lib/client/job-categories';

export type JobCategory = JobCategoryWithRate;

export function useCategoryTree() {
  const { data: allCategories = [], isLoading } = useQuery({
    queryKey: ['jobCategories'],
    queryFn: fetchJobCategories,
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

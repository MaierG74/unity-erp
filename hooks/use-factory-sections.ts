'use client';

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  fetchAllSections,
  fetchJobCategories,
  createSection,
  updateSection,
  deleteSection,
  type SectionInsert,
  type SectionUpdate,
} from '@/lib/queries/factoryFloor';

const SECTIONS_KEY = ['factory-sections-all'];
const CATEGORIES_KEY = ['job-categories'];
const FLOOR_KEY = ['factory-floor'];

export function useFactorySections() {
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: SECTIONS_KEY });
    queryClient.invalidateQueries({ queryKey: FLOOR_KEY });
  };

  const sectionsQuery = useQuery({
    queryKey: SECTIONS_KEY,
    queryFn: fetchAllSections,
  });

  const categoriesQuery = useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: fetchJobCategories,
  });

  const createMutation = useMutation({
    mutationFn: (section: SectionInsert) => createSection(section),
    onSuccess: invalidateAll,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: SectionUpdate }) =>
      updateSection(id, updates),
    onSuccess: invalidateAll,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSection(id),
    onSuccess: invalidateAll,
  });

  return {
    sections: sectionsQuery.data ?? [],
    categories: categoriesQuery.data ?? [],
    isLoading: sectionsQuery.isLoading || categoriesQuery.isLoading,
    create: createMutation.mutateAsync,
    update: updateMutation.mutateAsync,
    remove: deleteMutation.mutateAsync,
    isMutating: createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
  };
}

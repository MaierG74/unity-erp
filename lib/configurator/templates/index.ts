import { cupboardTemplate } from './cupboard';
import type { FurnitureTemplate } from './types';

export const TEMPLATES: Record<string, FurnitureTemplate<any>> = {
  cupboard: cupboardTemplate,
};

export function getTemplate(id: string): FurnitureTemplate<any> | null {
  return TEMPLATES[id] ?? null;
}

export function getTemplateList(): FurnitureTemplate<any>[] {
  return Object.values(TEMPLATES);
}

export { DEFAULT_CUPBOARD_CONFIG } from './types';
export type { CupboardConfig, FurnitureTemplate } from './types';

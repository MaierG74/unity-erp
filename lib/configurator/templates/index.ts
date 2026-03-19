import { cupboardTemplate } from './cupboard';
import { pedestalTemplate } from './pedestal';
import { pigeonholeTemplate } from './pigeonhole';
import type { FurnitureTemplate } from './types';

export const TEMPLATES: Record<string, FurnitureTemplate<any>> = {
  cupboard: cupboardTemplate,
  pedestal: pedestalTemplate,
  pigeonhole: pigeonholeTemplate,
};

export function getTemplate(id: string): FurnitureTemplate<any> | null {
  return TEMPLATES[id] ?? null;
}

export function getTemplateList(): FurnitureTemplate<any>[] {
  return Object.values(TEMPLATES);
}

export { DEFAULT_CUPBOARD_CONFIG, DEFAULT_PEDESTAL_CONFIG, DEFAULT_PIGEONHOLE_CONFIG } from './types';
export type { CupboardConfig, PedestalConfig, PigeonholeConfig, FurnitureTemplate } from './types';

import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { User } from '@supabase/supabase-js'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Extract org_id from a Supabase user's metadata (app_metadata preferred, falls back to user_metadata). */
export function getOrgId(user: User | null): string | null {
  return (user?.app_metadata?.org_id as string) ?? (user?.user_metadata?.org_id as string) ?? null;
}

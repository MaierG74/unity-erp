'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// =============================================================================
// Stat Helper Component
// =============================================================================

interface StatProps {
  label: string;
  value: string;
  unit?: string;
}

/**
 * Displays a single statistic in a card format.
 */
function Stat({ label, value, unit }: StatProps) {
  return (
    <div className="rounded border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">
        {value} {unit ? <span className="font-normal text-muted-foreground">{unit}</span> : null}
      </div>
    </div>
  );
}

function EdgeStat({
  label,
  value,
  popoverContent,
}: {
  label: string;
  value: string;
  popoverContent: React.ReactNode;
}) {
  return (
    <Popover>
      <div className="rounded border bg-card p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">{label}</div>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Show
            </button>
          </PopoverTrigger>
        </div>
        <div className="text-lg font-semibold">{value}</div>
      </div>
      <PopoverContent align="start" sideOffset={6} className="w-64 p-3">
        <div className="text-xs text-muted-foreground space-y-1">{popoverContent}</div>
      </PopoverContent>
    </Popover>
  );
}

// =============================================================================
// ResultsSummary Component
// =============================================================================

export interface ResultsSummaryProps {
  /** Number of primary sheets used (fractional) */
  primarySheetsUsed: number;
  /** Number of primary sheets billable (fractional) */
  primarySheetsBillable: number;
  /** Board utilization percentage (0-100) */
  usedPercent: number;
  /** 16mm edgebanding length in mm */
  edgebanding16mm: number;
  /** 32mm edgebanding length in mm */
  edgebanding32mm: number;
  /** Whether lamination is enabled */
  laminationOn: boolean;
  /** Number of backer sheets used (fractional), only shown when lamination is on */
  backerSheetsUsed?: number;
  /** Number of backer sheets billable (fractional), only shown when lamination is on */
  backerSheetsBillable?: number;
  /** Optional edging breakdown by material */
  edgingBreakdown?: Array<{
    materialId: string;
    name: string;
    thickness_mm: number;
    length_mm: number;
  }>;
  /** Optional default edging names for fallback display */
  defaultEdging16Name?: string | null;
  defaultEdging32Name?: string | null;

  // Optional snapshot status
  /** Whether the snapshot is currently loading */
  isLoading?: boolean;
  /** Whether the snapshot is currently saving */
  isSaving?: boolean;
  /** Timestamp of last save (ISO string) */
  lastSavedAt?: string | null;
  /** Error message from snapshot operations */
  error?: string | null;
}

/**
 * Displays a summary of cutlist calculation results including:
 * - Sheets used and billable
 * - Board utilization percentage
 * - Edgebanding totals (16mm and 32mm)
 * - Lamination status
 * - Optional backer sheet stats when lamination is enabled
 * - Optional snapshot save status
 */
export function ResultsSummary({
  primarySheetsUsed,
  primarySheetsBillable,
  usedPercent,
  edgebanding16mm,
  edgebanding32mm,
  laminationOn,
  backerSheetsUsed,
  backerSheetsBillable,
  edgingBreakdown,
  defaultEdging16Name,
  defaultEdging32Name,
  isLoading,
  isSaving,
  lastSavedAt,
  error,
}: ResultsSummaryProps) {
  // Show backer stats only when lamination is on and backer values are provided
  const showBackerStats = laminationOn && backerSheetsUsed !== undefined && backerSheetsBillable !== undefined;

  // Format edgebanding as meters (divide by 1000, show 2 decimals)
  const edgebanding16mFormatted = (edgebanding16mm / 1000).toFixed(2);
  const edgebanding32mFormatted = (edgebanding32mm / 1000).toFixed(2);
  const edgingGroups = React.useMemo(() => {
    if (!edgingBreakdown || edgingBreakdown.length === 0) return [];
    const grouped = new Map<number, Array<{ name: string; length_mm: number }>>();
    for (const entry of edgingBreakdown) {
      const list = grouped.get(entry.thickness_mm) ?? [];
      list.push({ name: entry.name, length_mm: entry.length_mm });
      grouped.set(entry.thickness_mm, list);
    }
    return Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([thickness, entries]) => ({
        thickness,
        entries: entries.sort((a, b) => b.length_mm - a.length_mm),
      }));
  }, [edgingBreakdown]);

  return (
    <div className="space-y-2">
      {/* Stats Grid */}
      <div
        className={cn(
          'grid grid-cols-2 gap-3',
          showBackerStats ? 'md:grid-cols-6' : 'md:grid-cols-5'
        )}
      >
        <Stat label="Sheets used" value={primarySheetsUsed.toFixed(3)} />
        <Stat label="Billable sheets" value={primarySheetsBillable.toFixed(3)} />
        <Stat label="Board used %" value={`${usedPercent.toFixed(1)}%`} />
        <EdgeStat
          label="Edge 16mm"
          value={`${edgebanding16mFormatted}m`}
          popoverContent={
            edgingGroups.some((group) => group.thickness === 16)
              ? edgingGroups
                  .filter((group) => group.thickness === 16)
                  .flatMap((group) =>
                    group.entries.map((entry) => (
                      <div key={`edge16-${entry.name}`} className="flex items-center justify-between">
                        <span>{entry.name}</span>
                        <span className="text-foreground">
                          {(entry.length_mm / 1000).toFixed(2)}m
                        </span>
                      </div>
                    ))
                  )
              : edgebanding16mm > 0
                ? (
                    <div className="flex items-center justify-between">
                      <span>{defaultEdging16Name || 'Default 16mm edging'}</span>
                      <span className="text-foreground">{edgebanding16mFormatted}m</span>
                    </div>
                  )
                : 'No 16mm edging for this layout.'
          }
        />
        <EdgeStat
          label="Edge 32mm"
          value={`${edgebanding32mFormatted}m`}
          popoverContent={
            edgingGroups.some((group) => group.thickness === 32)
              ? edgingGroups
                  .filter((group) => group.thickness === 32)
                  .flatMap((group) =>
                    group.entries.map((entry) => (
                      <div key={`edge32-${entry.name}`} className="flex items-center justify-between">
                        <span>{entry.name}</span>
                        <span className="text-foreground">
                          {(entry.length_mm / 1000).toFixed(2)}m
                        </span>
                      </div>
                    ))
                  )
              : edgebanding32mm > 0
                ? (
                    <div className="flex items-center justify-between">
                      <span>{defaultEdging32Name || 'Default 32mm edging'}</span>
                      <span className="text-foreground">{edgebanding32mFormatted}m</span>
                    </div>
                  )
                : 'No 32mm edging for this layout.'
          }
        />
        <Stat label="Lamination" value={laminationOn ? 'On' : 'Off'} />
        {showBackerStats && (
          <>
            <Stat label="Backer sheets" value={backerSheetsUsed!.toFixed(3)} />
            <Stat label="Billable backer" value={backerSheetsBillable!.toFixed(3)} />
          </>
        )}
      </div>

      {(isLoading || isSaving || lastSavedAt || error) && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>
            {isLoading
              ? 'Loading saved snapshot...'
              : lastSavedAt
                ? `Last saved ${new Date(lastSavedAt).toLocaleString()}`
                : 'No saved snapshot yet'}
            {error ? ` - Save issue: ${error}` : ''}
          </div>
          <div>{isSaving ? 'Saving...' : null}</div>
        </div>
      )}
    </div>
  );
}

export default ResultsSummary;

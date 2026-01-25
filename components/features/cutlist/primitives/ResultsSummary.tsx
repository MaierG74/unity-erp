'use client';

import { cn } from '@/lib/utils';

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
        <Stat label="Edge 16mm" value={`${edgebanding16mFormatted}m`} />
        <Stat label="Edge 32mm" value={`${edgebanding32mFormatted}m`} />
        <Stat label="Lamination" value={laminationOn ? 'On' : 'Off'} />
        {showBackerStats && (
          <>
            <Stat label="Backer sheets" value={backerSheetsUsed!.toFixed(3)} />
            <Stat label="Billable backer" value={backerSheetsBillable!.toFixed(3)} />
          </>
        )}
      </div>

      {/* Snapshot Status */}
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
    </div>
  );
}

export default ResultsSummary;

'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileSpreadsheet, AlertCircle, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { parseCSVContent } from '@/lib/cutlist/csvParser';
import type { CutlistPart } from '@/lib/cutlist/types';

export interface CSVDropzoneProps {
  /** Called when parts are successfully imported from the CSV */
  onPartsImported: (parts: CutlistPart[]) => void;
  /** Called when an error occurs during parsing */
  onError?: (error: string) => void;
  /** Additional class names for the dropzone container */
  className?: string;
  /** If true, shows a compact button that expands to full dropzone */
  collapsible?: boolean;
  /** Label for the collapsed button */
  buttonLabel?: string;
}

/**
 * A drag-and-drop zone for importing SketchUp CSV cutlist files.
 * Parses the CSV and converts valid rows into CutlistPart objects.
 */
export function CSVDropzone({
  onPartsImported,
  onError,
  className,
  collapsible = false,
  buttonLabel = 'Import CSV'
}: CSVDropzoneProps) {
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(!collapsible);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      // Clear previous error
      setError(null);

      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        if (!content) {
          const errorMsg = 'Failed to read file content';
          setError(errorMsg);
          onError?.(errorMsg);
          return;
        }

        const parsed = parseCSVContent(content);

        // Check for parsing errors
        if (parsed.errors.length > 0) {
          const errorMsg = parsed.errors.join('; ');
          setError(errorMsg);
          onError?.(errorMsg);
          return;
        }

        // Filter to valid rows and convert to CutlistPart format
        const newParts: CutlistPart[] = parsed.sheetGoodsRows
          .filter((row) => row.validation.valid)
          .map((row, index) => ({
            id: `csv-${Date.now()}-${index}`,
            name: row.designation || `Part ${index + 1}`,
            length_mm: row.length_mm,
            width_mm: row.width_mm,
            quantity: row.quantity,
            grain: 'length' as const,
            band_edges: {
              top: Boolean(row.edgeLength1?.trim()),
              bottom: Boolean(row.edgeLength2?.trim()),
              right: Boolean(row.edgeWidth1?.trim()),
              left: Boolean(row.edgeWidth2?.trim()),
            },
            material_label: row.materialName || undefined,
          }));

        if (newParts.length === 0) {
          const errorMsg = 'No valid parts found in CSV file';
          setError(errorMsg);
          onError?.(errorMsg);
          return;
        }

        onPartsImported(newParts);
      };

      reader.onerror = () => {
        const errorMsg = 'Error reading file';
        setError(errorMsg);
        onError?.(errorMsg);
      };

      reader.readAsText(file);
    },
    [onPartsImported, onError]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'text/plain': ['.txt', '.csv'],
    },
    multiple: false,
  });

  // Collapsed state - just show a button
  if (collapsible && !isExpanded) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsExpanded(true)}
        className={cn('gap-2', className)}
      >
        <Upload className="h-4 w-4" />
        {buttonLabel}
      </Button>
    );
  }

  return (
    <div className={cn('relative', className)}>
      {collapsible && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-6 w-6 z-10"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(false);
            setError(null);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
      <div
        {...getRootProps()}
        className={cn(
          'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
          isDragActive
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50',
          error && 'border-destructive/50'
        )}
      >
        <input {...getInputProps()} />
        {error ? (
          <>
            <AlertCircle className="h-10 w-10 mx-auto text-destructive mb-3" />
            <p className="text-sm font-medium text-destructive">{error}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Click or drop another file to try again
            </p>
          </>
        ) : (
          <>
            <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">
              {isDragActive ? 'Drop the CSV file here' : 'Drop a SketchUp CSV file here'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
          </>
        )}
      </div>
    </div>
  );
}

export default CSVDropzone;

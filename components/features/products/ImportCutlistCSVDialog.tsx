'use client';

import { useState, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabase';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  X,
  Loader2,
} from 'lucide-react';
import {
  parseCSVContent,
  rowToCutlistDimensions,
  formatDimensionsDisplay,
  formatEdgesDisplay,
  type ParsedCSVRow,
  type ParsedCSVResult,
} from '@/lib/cutlist/csvParser';

interface ImportCutlistCSVDialogProps {
  productId: number;
  onApplied?: () => void;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  showTriggerButton?: boolean;
}

export default function ImportCutlistCSVDialog({
  productId,
  onApplied,
  open,
  onOpenChange,
  showTriggerButton = true,
}: ImportCutlistCSVDialogProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const controlled = typeof open === 'boolean';
  const actualOpen = controlled ? (open as boolean) : localOpen;
  const setOpenState = (v: boolean) => (controlled ? onOpenChange?.(v) : setLocalOpen(v));

  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedCSVResult | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const { toast } = useToast();

  // Reset state when dialog closes
  const handleClose = useCallback(() => {
    setOpenState(false);
    setFile(null);
    setParsedData(null);
    setSelectedRows(new Set());
    setParseError(null);
  }, [setOpenState]);

  // Handle file drop/select
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const csvFile = acceptedFiles[0];
    if (!csvFile) return;

    setFile(csvFile);
    setParseError(null);

    try {
      const content = await csvFile.text();
      const result = parseCSVContent(content);

      if (result.errors.length > 0) {
        setParseError(result.errors.join('; '));
      }

      setParsedData(result);

      // Pre-select valid Sheet Goods rows
      const validRowIndices = result.sheetGoodsRows
        .filter((row) => row.validation.valid)
        .map((row) => row.rowIndex);
      setSelectedRows(new Set(validRowIndices));
    } catch (err) {
      console.error('CSV parse error:', err);
      setParseError('Failed to parse CSV file');
      setParsedData(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'text/plain': ['.csv', '.txt'],
      'application/vnd.ms-excel': ['.csv'],
    },
    multiple: false,
    noClick: false,
  });

  // Row selection handlers
  const toggleRow = useCallback((rowIndex: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        next.add(rowIndex);
      }
      return next;
    });
  }, []);

  const selectAllValid = useCallback(() => {
    if (!parsedData) return;
    const validIndices = parsedData.sheetGoodsRows
      .filter((row) => row.validation.valid)
      .map((row) => row.rowIndex);
    setSelectedRows(new Set(validIndices));
  }, [parsedData]);

  const deselectAll = useCallback(() => {
    setSelectedRows(new Set());
  }, []);

  // Count selected valid rows
  const selectedValidCount = useMemo(() => {
    if (!parsedData) return 0;
    return parsedData.sheetGoodsRows.filter(
      (row) => row.validation.valid && selectedRows.has(row.rowIndex)
    ).length;
  }, [parsedData, selectedRows]);

  // Import handler
  const handleImport = useCallback(async () => {
    if (!parsedData || selectedRows.size === 0) return;

    const rowsToImport = parsedData.sheetGoodsRows.filter(
      (row) => row.validation.valid && selectedRows.has(row.rowIndex)
    );

    if (rowsToImport.length === 0) {
      toast({
        title: 'No valid rows selected',
        description: 'Please select at least one valid row to import.',
        variant: 'destructive',
      });
      return;
    }

    setImporting(true);

    try {
      // Build insert payload
      const insertData = rowsToImport.map((row) => ({
        product_id: productId,
        component_id: null,
        quantity_required: row.quantity,
        is_cutlist_item: true,
        cutlist_category: row.tags?.trim() || null,
        cutlist_dimensions: rowToCutlistDimensions(row),
      }));

      const { error } = await supabase.from('billofmaterials').insert(insertData);

      if (error) throw error;

      toast({
        title: 'Import successful',
        description: `Imported ${rowsToImport.length} cutlist item${rowsToImport.length !== 1 ? 's' : ''}.`,
      });

      handleClose();
      onApplied?.();
    } catch (err) {
      console.error('Import failed:', err);
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'An error occurred during import.',
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
    }
  }, [parsedData, selectedRows, productId, toast, handleClose, onApplied]);

  // Render validation icon
  const ValidationIcon = ({ row }: { row: ParsedCSVRow }) => {
    if (!row.validation.valid) {
      return (
        <div className="flex items-center gap-1 text-destructive" title={row.validation.errors.join(', ')}>
          <AlertCircle className="h-4 w-4" />
        </div>
      );
    }
    if (row.validation.warnings.length > 0) {
      return (
        <div className="flex items-center gap-1 text-yellow-500" title={row.validation.warnings.join(', ')}>
          <AlertTriangle className="h-4 w-4" />
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1 text-green-500">
        <CheckCircle2 className="h-4 w-4" />
      </div>
    );
  };

  return (
    <>
      {showTriggerButton && (
        <Button variant="outline" onClick={() => setOpenState(true)}>
          <Upload className="h-4 w-4 mr-2" />
          Import CSV
        </Button>
      )}

      {actualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
          <div className="relative bg-background border rounded-md shadow-xl w-[1000px] max-h-[85vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h2 className="text-lg font-semibold">Import Cutlist from CSV</h2>
                <p className="text-sm text-muted-foreground">
                  Import panels from a SketchUp cutlist export
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={handleClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {/* File Upload Zone */}
              {!parsedData && (
                <div
                  {...getRootProps()}
                  className={`
                    border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
                    transition-colors duration-200
                    ${isDragActive ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}
                  `}
                >
                  <input {...getInputProps()} />
                  <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  {isDragActive ? (
                    <p className="text-lg">Drop your CSV file here...</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-lg">Drag and drop a CSV file here, or click to select</p>
                      <p className="text-sm text-muted-foreground">
                        Supports SketchUp cutlist exports (semicolon or comma delimited)
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Parse Error */}
              {parseError && (
                <div className="bg-destructive/10 border border-destructive rounded-md p-3 flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-destructive">Parse Error</p>
                    <p className="text-sm text-muted-foreground">{parseError}</p>
                  </div>
                </div>
              )}

              {/* Parsed Data Preview */}
              {parsedData && (
                <>
                  {/* File Info & Actions */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{file?.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {parsedData.sheetGoodsRows.length} panel{parsedData.sheetGoodsRows.length !== 1 ? 's' : ''} found
                          {parsedData.allRows.length !== parsedData.sheetGoodsRows.length && (
                            <span className="ml-1">
                              ({parsedData.allRows.length - parsedData.sheetGoodsRows.length} edge banding rows filtered)
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={selectAllValid}>
                        Select All Valid
                      </Button>
                      <Button variant="outline" size="sm" onClick={deselectAll}>
                        Deselect All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFile(null);
                          setParsedData(null);
                          setSelectedRows(new Set());
                          setParseError(null);
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>

                  {/* Warnings */}
                  {parsedData.warnings.length > 0 && (
                    <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-md p-3">
                      <p className="text-sm text-yellow-600 dark:text-yellow-400">
                        {parsedData.warnings.join('; ')}
                      </p>
                    </div>
                  )}

                  {/* Preview Table */}
                  <div className="rounded-md border overflow-hidden">
                    <div className="overflow-auto max-h-[400px]">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr className="text-left">
                            <th className="p-3 w-10"></th>
                            <th className="p-3 w-10">Status</th>
                            <th className="p-3">Designation</th>
                            <th className="p-3">Dimensions (L x W x T)</th>
                            <th className="p-3">Material</th>
                            <th className="p-3 w-16 text-center">Qty</th>
                            <th className="p-3 w-20">Edges</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedData.sheetGoodsRows.length === 0 ? (
                            <tr>
                              <td className="p-4 text-muted-foreground text-center" colSpan={7}>
                                No panels found in CSV
                              </td>
                            </tr>
                          ) : (
                            parsedData.sheetGoodsRows.map((row) => (
                              <tr
                                key={row.rowIndex}
                                className={`border-t ${
                                  selectedRows.has(row.rowIndex) ? 'bg-accent' : ''
                                } ${!row.validation.valid ? 'opacity-60' : ''}`}
                              >
                                <td className="p-3">
                                  <Checkbox
                                    checked={selectedRows.has(row.rowIndex)}
                                    onCheckedChange={() => toggleRow(row.rowIndex)}
                                    disabled={!row.validation.valid}
                                  />
                                </td>
                                <td className="p-3">
                                  <ValidationIcon row={row} />
                                </td>
                                <td className="p-3 font-medium">
                                  {row.designation || <span className="text-muted-foreground">-</span>}
                                </td>
                                <td className="p-3 font-mono text-xs">
                                  {formatDimensionsDisplay(row)}
                                </td>
                                <td className="p-3">
                                  {row.materialName || <span className="text-muted-foreground">-</span>}
                                </td>
                                <td className="p-3 text-center">{row.quantity}</td>
                                <td className="p-3 font-mono text-xs">{formatEdgesDisplay(row)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Legend */}
                  <div className="flex items-center gap-6 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      <span>Valid</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-yellow-500" />
                      <span>Warning (missing optional data)</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 text-destructive" />
                      <span>Error (cannot import)</span>
                    </div>
                    <div className="ml-auto">
                      Edges: T=Top, R=Right, B=Bottom, L=Left
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-4 border-t bg-muted/30">
              <div className="text-sm text-muted-foreground">
                {parsedData && (
                  <>
                    {selectedValidCount} of {parsedData.sheetGoodsRows.filter((r) => r.validation.valid).length} valid rows selected
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={handleClose} disabled={importing}>
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={!parsedData || selectedValidCount === 0 || importing}
                >
                  {importing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>Import {selectedValidCount > 0 ? `${selectedValidCount} Item${selectedValidCount !== 1 ? 's' : ''}` : ''}</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

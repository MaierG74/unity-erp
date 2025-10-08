'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, BarChart3, Info } from 'lucide-react';
import CutlistTool, { type CutlistSummary } from '@/components/features/cutlist/CutlistTool';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const sheetFormatter = new Intl.NumberFormat('en-ZA', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

const meterFormatter = new Intl.NumberFormat('en-ZA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyFormatter = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatSheets = (value: number) => sheetFormatter.format(Number.isFinite(value) ? value : 0);
const formatMeters = (value: number) => `${meterFormatter.format(Number.isFinite(value) ? value : 0)} m`;
const formatCurrency = (value: number) => currencyFormatter.format(Number.isFinite(value) ? value : 0);

type SummaryStatProps = {
  label: string;
  value: string;
};

function SummaryStat({ label, value }: SummaryStatProps) {
  return (
    <div className="rounded border bg-muted/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

export default function CutlistPage() {
  const [summary, setSummary] = React.useState<CutlistSummary | null>(null);
  const [snapshotOpen, setSnapshotOpen] = React.useState(false);
  const [tipsOpen, setTipsOpen] = React.useState(false);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <div>
          <h1 className="text-3xl font-semibold text-foreground">Cutlist Calculator</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
            Run quick board calculations without touching Quotes. Use the familiar cutlist inputs and switch to the Costing tab to
            pick your melamine, backer, and edging directly alongside the layout tools.
          </p>
        </div>
      </div>

      <Card className="relative">
        <CardHeader className="pb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Layout & Inputs</CardTitle>
              <CardDescription>
                Parts, stock, results, and costing all live in one place. Costing values are remembered for the next session so your
                standard backer board is ready to go.
              </CardDescription>
            </div>
            <div className="flex gap-2 self-end lg:self-auto">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => setSnapshotOpen(true)}
                title="Show usage snapshot"
              >
                <BarChart3 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => setTipsOpen(true)}
                title="Show material tips"
              >
                <Info className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <CutlistTool
            onSummaryChange={setSummary}
            persistCostingDefaultsKey="cutlist-standalone-costing"
            enableMaterialPalette
          />
        </CardContent>
      </Card>

      <Dialog open={snapshotOpen} onOpenChange={setSnapshotOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Usage Snapshot</DialogTitle>
            <DialogDescription>Latest layout totals at a glance.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {summary ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={summary.laminationOn ? 'success' : 'outline'}>
                    {summary.laminationOn ? 'Lamination On' : 'No Lamination'}
                  </Badge>
                  <Badge variant="secondary">{formatSheets(summary.primarySheetsBillable)} billable sheets</Badge>
                  {summary.materials && summary.materials.length > 0 && (
                    <Badge variant="outline">{formatCurrency(summary.materials.reduce((sum, mat) => sum + mat.totalCost, 0))} total</Badge>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SummaryStat
                    label="Primary sheets (used)"
                    value={`${formatSheets(summary.primarySheetsUsed)} sheets`}
                  />
                  <SummaryStat
                    label="Primary sheets (billable)"
                    value={`${formatSheets(summary.primarySheetsBillable)} sheets`}
                  />
                  {summary.laminationOn && (
                    <SummaryStat
                      label="Backer sheets (billable)"
                      value={`${formatSheets(summary.backerSheetsBillable)} sheets`}
                    />
                  )}
                  <SummaryStat
                    label="Edgebanding 16mm"
                    value={formatMeters(summary.edgebanding16mm / 1000)}
                  />
                  <SummaryStat
                    label="Edgebanding 32mm"
                    value={formatMeters(summary.edgebanding32mm / 1000)}
                  />
                </div>
                {summary.materials && summary.materials.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Materials</div>
                    <div className="space-y-2">
                      {summary.materials.map((mat) => (
                        <div key={mat.materialId} className="rounded-md border p-3 space-y-2">
                          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                            <div className="font-medium text-foreground">{mat.materialName}</div>
                            <div className="text-sm font-semibold text-foreground">{formatCurrency(mat.totalCost)}</div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-muted-foreground">
                            <div>Sheets billable: <span className="text-foreground font-medium">{formatSheets(mat.sheetsBillable)}</span></div>
                            <div>Sheet cost: <span className="text-foreground font-medium">{formatCurrency(mat.sheetCost)}</span></div>
                            <div>Backer cost: <span className="text-foreground font-medium">{formatCurrency(mat.backerCost)}</span></div>
                            <div>Banding 16mm: <span className="text-foreground font-medium">{formatMeters(mat.edgebanding16mm / 1000)}</span></div>
                            <div>16mm cost: <span className="text-foreground font-medium">{formatCurrency(mat.band16Cost)}</span></div>
                            <div>Banding 32mm: <span className="text-foreground font-medium">{formatMeters(mat.edgebanding32mm / 1000)}</span></div>
                            <div>32mm cost: <span className="text-foreground font-medium">{formatCurrency(mat.band32Cost)}</span></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Calculate a layout to see board usage, lamination requirements, and total banding lengths here.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={tipsOpen} onOpenChange={setTipsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Material tips</DialogTitle>
            <DialogDescription>
              Values entered on the Costing tab are saved automatically, so your go-to backer board and edging rates are ready next time you open the calculator.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>Click “Choose…” in the Material column to pull boards directly from the component database or supplier catalog. Each selection creates or updates a palette entry automatically.</p>
            <p>The first material in the list acts as the export default when you send costs back to Quotes. Rearrange or rename it to match your most common board.</p>
            <p>Backer pricing lives in the Backer defaults section. You can override pricing per material later if a project requires a different backer.</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

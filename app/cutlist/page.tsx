'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import CutlistTool, { type CutlistSummary } from '@/components/features/cutlist/CutlistTool';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const sheetFormatter = new Intl.NumberFormat('en-ZA', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

const meterFormatter = new Intl.NumberFormat('en-ZA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatSheets = (value: number) => sheetFormatter.format(Number.isFinite(value) ? value : 0);
const formatMeters = (value: number) => `${meterFormatter.format(Number.isFinite(value) ? value : 0)} m`;

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

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Layout & Inputs</CardTitle>
            <CardDescription>
              Parts, stock, results, and costing all live in one place. Costing values are remembered for the next session so your
              standard backer board is ready to go.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CutlistTool
              onSummaryChange={setSummary}
              persistCostingDefaultsKey="cutlist-standalone-costing"
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Usage Snapshot</CardTitle>
              <CardDescription>Latest layout totals at a glance.</CardDescription>
            </CardHeader>
            <CardContent>
              {summary ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={summary.laminationOn ? 'success' : 'outline'}>
                      {summary.laminationOn ? 'Lamination On' : 'No Lamination'}
                    </Badge>
                    <Badge variant="secondary">{formatSheets(summary.primarySheetsBillable)} billable sheets</Badge>
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
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Calculate a layout to see board usage, lamination requirements, and total banding lengths here.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Material tips</CardTitle>
              <CardDescription>
                Values entered on the Costing tab are saved automatically, so your go-to backer board and edging rates are ready next
                time you open the calculator.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </div>
  );
}

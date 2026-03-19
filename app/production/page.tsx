'use client';

import { Suspense, useCallback, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  Inbox,
  CalendarClock,
  Factory,
  AlertTriangle,
  Plus,
} from 'lucide-react';
import { JobQueueTable } from '@/components/production/job-queue-table';
import { ProductionHeader } from '@/components/production/production-header';
import { ExceptionsTab } from '@/components/production/exceptions-tab';
import { useProductionSummary } from '@/hooks/use-production-summary';
import { useLaborRealtime } from '@/hooks/use-labor-realtime';

const LaborPlanningBoard = dynamic(
  () =>
    import('@/components/production/labor-planning-board').then((m) => ({
      default: m.LaborPlanningBoard,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

const FactoryFloorPage = dynamic(
  () =>
    import('@/components/factory-floor/factory-floor-page').then((m) => ({
      default: m.FactoryFloorPage,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

type ProductionView = 'queue' | 'schedule' | 'floor' | 'exceptions';

const VALID_VIEWS: ProductionView[] = ['queue', 'schedule', 'floor', 'exceptions'];

function TabCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
      {count}
    </span>
  );
}

function ProductionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const summary = useProductionSummary();
  useLaborRealtime();

  const rawView = searchParams?.get('view') ?? 'queue';
  const view: ProductionView = VALID_VIEWS.includes(rawView as ProductionView)
    ? (rawView as ProductionView)
    : 'queue';

  const setView = useCallback(
    (v: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      params.set('view', v);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname],
  );

  // Keyboard shortcuts: 1-4 to switch tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const keyMap: Record<string, ProductionView> = {
        '1': 'queue',
        '2': 'schedule',
        '3': 'floor',
        '4': 'exceptions',
      };
      const target = keyMap[e.key];
      if (target) {
        e.preventDefault();
        setView(target);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setView]);

  return (
    <div className="flex flex-col h-full">
      <ProductionHeader onBadgeClick={setView} />

      <Tabs value={view} onValueChange={setView}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="queue" className="gap-1.5">
              <Inbox className="h-3.5 w-3.5" />
              Queue
              <TabCount count={summary.openJobCards} />
            </TabsTrigger>
            <TabsTrigger value="schedule" className="gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />
              Schedule
            </TabsTrigger>
            <TabsTrigger value="floor" className="gap-1.5">
              <Factory className="h-3.5 w-3.5" />
              Floor
            </TabsTrigger>
            <TabsTrigger value="exceptions" className="gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              Exceptions
              <TabCount count={summary.exceptionsTotal} />
            </TabsTrigger>
          </TabsList>

          {view === 'queue' && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => router.push('/staff/job-cards/new')}
            >
              <Plus className="h-3.5 w-3.5" />
              New Job Card
            </Button>
          )}
        </div>

        <TabsContent value="queue">
          <JobQueueTable showHeader={false} defaultStatusFilter="open" />
        </TabsContent>

        <TabsContent value="schedule" className="mt-0">
          <LaborPlanningBoard heightOffset={170} />
        </TabsContent>

        <TabsContent value="floor">
          <FactoryFloorPage />
        </TabsContent>

        <TabsContent value="exceptions">
          <ExceptionsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ProductionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ProductionContent />
    </Suspense>
  );
}

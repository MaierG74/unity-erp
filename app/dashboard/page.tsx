'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { Factory, Plus, ShoppingBasket } from 'lucide-react';

import { useAuth } from '@/components/common/auth-provider';
import { Button } from '@/components/ui/button';
import { DashboardConfigDrawer } from '@/app/dashboard/DashboardConfigDrawer';
import { DashboardKPICards, useDashboardKPISummary } from '@/app/dashboard/DashboardKPICards';
import { DashboardPurchasingWidget } from '@/app/dashboard/DashboardPurchasingWidget';
import { DashboardQuickActions } from '@/app/dashboard/DashboardQuickActions';
import { DashboardStaffCheckouts } from '@/app/dashboard/DashboardStaffCheckouts';
import { DashboardStats } from '@/app/dashboard/DashboardStats';
import { DashboardTodoWidget } from '@/app/dashboard/DashboardTodoWidget';
import { LowStockAlerts } from '@/app/dashboard/LowStockAlerts';
import { PurchaseActivityChart, OrderStatusDonut } from '@/app/dashboard/DashboardCharts';
import { RecentActivityChart } from '@/app/dashboard/RecentActivityChart';
import { type DashboardPresetId, type DashboardWidgetId } from '@/app/dashboard/dashboard-config';
import { useDashboardPreferences } from '@/hooks/use-dashboard-preferences';

const HEADER_ACTIONS: Record<
  DashboardPresetId,
  { label: string; href: string; icon: typeof Plus }
> = {
  purchasing_clerk: {
    label: 'New Purchase Order',
    href: '/purchasing/purchase-orders/new',
    icon: ShoppingBasket,
  },
  general_manager: {
    label: 'New Order',
    href: '/orders/new',
    icon: Plus,
  },
  operations_lead: {
    label: 'Open Orders Board',
    href: '/orders',
    icon: Factory,
  },
};

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getUserFirstName(email: string | undefined, metadata?: Record<string, any>) {
  if (metadata?.first_name) return metadata.first_name;
  if (metadata?.full_name) {
    const first = metadata.full_name.split(' ')[0];
    if (first) return first;
  }
  if (!email) return '';
  const local = email.split('@')[0];
  // Capitalize first letter
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function GreetingSummary() {
  const { data } = useDashboardKPISummary();
  if (!data) return null;

  const parts: string[] = [];
  if (data.overdueTasks > 0)
    parts.push(`${data.overdueTasks} overdue task${data.overdueTasks !== 1 ? 's' : ''}`);
  if (data.awaitingReceipt > 0)
    parts.push(`${data.awaitingReceipt} item${data.awaitingReceipt !== 1 ? 's' : ''} awaiting delivery`);
  if (data.lowStockCount > 0)
    parts.push(`${data.lowStockCount} low stock alert${data.lowStockCount !== 1 ? 's' : ''}`);

  if (parts.length === 0) return <span>All clear — nothing urgent right now.</span>;
  return <span>{parts.join(' · ')}</span>;
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const {
    preferences,
    visibleWidgetIds,
    isCustomized,
    isSaving,
    lastSavedAt,
    setPreset,
    toggleWidget,
    resetToPreset,
  } = useDashboardPreferences();

  if (loading) return null;
  if (!user) return null;

  const primaryAction = HEADER_ACTIONS[preferences.presetId];
  const PrimaryActionIcon = primaryAction.icon;
  const showWidget = (widgetId: DashboardWidgetId) =>
    visibleWidgetIds.has(widgetId);

  const firstName = getUserFirstName(user.email, user.user_metadata);
  const todayFormatted = format(new Date(), 'EEEE, d MMMM yyyy');

  return (
    <div className="space-y-5 p-6 pt-5">
      {/* ─── Greeting Header ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            {getGreeting()}, {firstName}
          </h1>
          <p className="text-sm text-muted-foreground">{todayFormatted}</p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            <GreetingSummary />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm">
            <Link href={primaryAction.href}>
              <PrimaryActionIcon className="mr-2 h-4 w-4" />
              {primaryAction.label}
            </Link>
          </Button>
          <DashboardConfigDrawer
            presetId={preferences.presetId}
            visibleWidgetIds={visibleWidgetIds}
            isCustomized={isCustomized}
            isSaving={isSaving}
            lastSavedAt={lastSavedAt}
            onPresetChange={setPreset}
            onToggleWidget={toggleWidget}
            onResetToPreset={resetToPreset}
          />
        </div>
      </div>

      {/* ─── KPI Hero Row ──────────────────────────────────────────────── */}
      <DashboardKPICards />

      {/* ─── Charts Row ────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PurchaseActivityChart />
        <OrderStatusDonut />
      </div>

      {/* ─── Quick Actions Row ─────────────────────────────────────────── */}
      {showWidget('quick_actions') ? (
        <DashboardQuickActions presetId={preferences.presetId} />
      ) : null}

      {/* ─── Stats (Executive) ─────────────────────────────────────────── */}
      {showWidget('stats') ? <DashboardStats /> : null}

      {/* ─── Revenue Chart (legacy, configurable) ──────────────────────── */}
      {showWidget('revenue') ? (
        <div className="grid gap-4 lg:grid-cols-7">
          <RecentActivityChart />
        </div>
      ) : null}

      {/* ─── Operational Widgets ───────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {showWidget('low_stock') ? <LowStockAlerts /> : null}
        {showWidget('purchasing_queue') ? <DashboardPurchasingWidget /> : null}
        {showWidget('todos') ? <DashboardTodoWidget /> : null}
      </div>

      {/* ─── Staff Checkouts ───────────────────────────────────────────── */}
      {showWidget('staff_checkouts') ? <DashboardStaffCheckouts /> : null}
    </div>
  );
}

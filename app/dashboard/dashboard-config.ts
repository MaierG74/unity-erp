export type DashboardWidgetId =
  | 'stats'
  | 'revenue'
  | 'quick_actions'
  | 'low_stock'
  | 'todos'
  | 'purchasing_queue'
  | 'staff_checkouts';

export type DashboardPresetId =
  | 'purchasing_clerk'
  | 'general_manager'
  | 'operations_lead';

export interface DashboardPreferences {
  presetId: DashboardPresetId;
  widgetIds: DashboardWidgetId[];
  updatedAt: string | null;
}

export const DASHBOARD_WIDGET_ORDER: DashboardWidgetId[] = [
  'stats',
  'revenue',
  'quick_actions',
  'low_stock',
  'todos',
  'purchasing_queue',
  'staff_checkouts',
];

export const DASHBOARD_WIDGET_META: Record<
  DashboardWidgetId,
  { label: string; description: string }
> = {
  stats: {
    label: 'Executive stats',
    description: 'High-level order, product, and customer counts.',
  },
  revenue: {
    label: 'Revenue trend',
    description: 'A 30-day revenue overview for commercial visibility.',
  },
  quick_actions: {
    label: 'Quick actions',
    description: 'One-click routes for the most common work in this role.',
  },
  low_stock: {
    label: 'Low stock alerts',
    description: 'Shortages and reorder actions tied to inventory items.',
  },
  todos: {
    label: 'My tasks',
    description: 'Assigned work that needs attention today or this week.',
  },
  purchasing_queue: {
    label: 'Purchasing queue',
    description: 'Pending approvals, receipts, and supplier-order follow-up.',
  },
  staff_checkouts: {
    label: 'Staff check-outs',
    description: 'Attendance exceptions that operations still need to clear.',
  },
};

export const DASHBOARD_PRESETS: Record<
  DashboardPresetId,
  {
    label: string;
    description: string;
    defaultWidgets: DashboardWidgetId[];
  }
> = {
  purchasing_clerk: {
    label: 'Purchasing Clerk',
    description:
      'Prioritizes low stock, incoming purchase work, and assigned tasks over executive rollups.',
    defaultWidgets: ['quick_actions', 'low_stock', 'todos', 'purchasing_queue'],
  },
  general_manager: {
    label: 'General Manager',
    description:
      'Keeps the broader commercial and operational picture visible with action widgets alongside summary metrics.',
    defaultWidgets: [
      'stats',
      'revenue',
      'quick_actions',
      'low_stock',
      'purchasing_queue',
      'staff_checkouts',
    ],
  },
  operations_lead: {
    label: 'Operations Lead',
    description:
      'Balances shop-floor exceptions, shortages, and work coordination without full executive reporting.',
    defaultWidgets: ['stats', 'quick_actions', 'low_stock', 'todos', 'staff_checkouts'],
  },
};

export const DEFAULT_DASHBOARD_PRESET: DashboardPresetId = 'purchasing_clerk';

function orderedUniqueWidgets(widgetIds: DashboardWidgetId[]) {
  const next = new Set(widgetIds);
  const ordered = DASHBOARD_WIDGET_ORDER.filter((widgetId) => next.has(widgetId));
  return ordered.length > 0
    ? ordered
    : [...DASHBOARD_PRESETS[DEFAULT_DASHBOARD_PRESET].defaultWidgets];
}

export function getDefaultDashboardPreferences(
  presetId: DashboardPresetId = DEFAULT_DASHBOARD_PRESET
): DashboardPreferences {
  return {
    presetId,
    widgetIds: [...DASHBOARD_PRESETS[presetId].defaultWidgets],
    updatedAt: null,
  };
}

export function normalizeDashboardPreferences(
  raw: unknown
): DashboardPreferences {
  if (!raw || typeof raw !== 'object') {
    return getDefaultDashboardPreferences();
  }

  const candidate = raw as Partial<DashboardPreferences>;
  const presetId =
    candidate.presetId && candidate.presetId in DASHBOARD_PRESETS
      ? candidate.presetId
      : DEFAULT_DASHBOARD_PRESET;

  const widgetIds = Array.isArray(candidate.widgetIds)
    ? candidate.widgetIds.filter(
        (widgetId): widgetId is DashboardWidgetId =>
          typeof widgetId === 'string' && widgetId in DASHBOARD_WIDGET_META
      )
    : DASHBOARD_PRESETS[presetId].defaultWidgets;

  return {
    presetId,
    widgetIds: orderedUniqueWidgets(widgetIds),
    updatedAt:
      typeof candidate.updatedAt === 'string' ? candidate.updatedAt : null,
  };
}

export function isDashboardPresetCustomized(
  preferences: DashboardPreferences
) {
  const presetDefaults = DASHBOARD_PRESETS[preferences.presetId].defaultWidgets;
  return (
    orderedUniqueWidgets(preferences.widgetIds).join('|') !==
    orderedUniqueWidgets(presetDefaults).join('|')
  );
}

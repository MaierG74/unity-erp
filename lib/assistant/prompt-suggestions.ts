export type AssistantStatus =
  | 'answered'
  | 'welcome'
  | 'tool_pending'
  | 'out_of_scope'
  | 'clarify'
  | 'unknown';

export type AssistantDetailItem = {
  label: string;
  value: string;
};

export type AssistantMetricCardItem = {
  label: string;
  value: string;
  detailTitle?: string;
  details?: AssistantDetailItem[];
};

export type AssistantActionLink = {
  label: string;
  href?: string;
  kind?: 'navigate' | 'preview_order' | 'ask';
  orderId?: number;
  prompt?: string;
};

export type AssistantChartCardPoint = {
  label: string;
  value: number;
};

export type AssistantTableCard = {
  type: 'table';
  title: string;
  description?: string;
  metrics?: AssistantMetricCardItem[];
  columns: Array<{
    key: string;
    label: string;
    align?: 'left' | 'right';
  }>;
  rows: Array<Record<string, string>>;
  actions?: AssistantActionLink[];
  rowActions?: Array<AssistantActionLink[]>;
  footer?: string;
};

export type AssistantChartCard = {
  type: 'chart';
  title: string;
  description?: string;
  metrics?: AssistantMetricCardItem[];
  points: AssistantChartCardPoint[];
  details?: AssistantDetailItem[];
  actions?: AssistantActionLink[];
  footer?: string;
};

export type AssistantCard = AssistantTableCard | AssistantChartCard;

export type AssistantReply = {
  status: AssistantStatus;
  message: string;
  suggestions: string[];
  scopeLabel: string;
  card?: AssistantCard;
};

function normalizePath(pathname?: string | null) {
  return (pathname ?? '').trim().toLowerCase();
}

export function getAssistantScope(pathname?: string | null) {
  const path = normalizePath(pathname);

  if (path.startsWith('/inventory')) return 'inventory';
  if (path.startsWith('/purchasing')) return 'purchasing';
  if (path.startsWith('/orders')) return 'orders';
  if (path.startsWith('/quotes')) return 'quotes';
  if (path.startsWith('/products')) return 'products';
  if (path.startsWith('/customers')) return 'customers';
  if (path.startsWith('/suppliers')) return 'suppliers';
  if (path.startsWith('/staff') || path.startsWith('/payroll-review')) return 'staff';
  if (path.startsWith('/cutlist')) return 'cutlist';
  if (path.startsWith('/todos')) return 'todos';
  return 'general';
}

export function getAssistantScopeLabel(pathname?: string | null) {
  switch (getAssistantScope(pathname)) {
    case 'inventory':
      return 'Inventory data assistant';
    case 'purchasing':
      return 'Purchasing data assistant';
    case 'orders':
      return 'Orders data assistant';
    case 'quotes':
      return 'Quotes data assistant';
    case 'products':
      return 'Products data assistant';
    case 'customers':
      return 'Customers data assistant';
    case 'suppliers':
      return 'Suppliers data assistant';
    case 'staff':
      return 'Staff data assistant';
    case 'cutlist':
      return 'Cutlist assistant';
    case 'todos':
      return 'Task assistant';
    default:
      return 'Unity data assistant';
  }
}

export function getAssistantSuggestions(pathname?: string | null): string[] {
  switch (getAssistantScope(pathname)) {
    case 'inventory':
      return [
        'Check stock for a component',
        'Items below reorder level',
        'Which orders need a component',
      ];
    case 'purchasing':
      return [
        'Supplier orders needing follow-up',
        'Late supplier orders',
        'Supplier orders for a component',
      ];
    case 'orders':
      return [
        'Open customer orders',
        'Orders from last 7 days',
        'Orders due this week',
        'Which orders are late',
      ];
    case 'quotes':
      return [
        'Quotes for a customer',
        'Summarize a quote',
        'Draft quotes needing follow-up',
      ];
    case 'products':
      return [
        'Cost of a product',
        'Customer orders for a product',
        'Manufacturing status for a product',
        'Production progress for an order',
      ];
    case 'suppliers':
      return [
        'Open purchase orders for a supplier',
        'Overdue supplier items',
        'Late supplier orders',
      ];
    case 'staff':
      return [
        'Who is clocked in today',
        'Payroll entries needing review',
        'Staff work segments',
      ];
    case 'cutlist':
      return [
        'Parts using the most material',
        'Rows with edge banding',
        'Pre-export checklist',
      ];
    case 'todos':
      return [
        'Overdue tasks',
        'Open follow-ups',
        'Recent task changes',
      ];
    default:
      return [
        'Check stock for a component',
        'Open customer orders',
        'Orders from last 7 days',
        'Which orders are late',
      ];
  }
}

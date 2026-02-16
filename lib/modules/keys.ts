export const MODULE_KEYS = {
  STAFF_TIME_ANALYSIS: 'staff_time_analysis',
  INVENTORY_STOCK_CONTROL: 'inventory_stock_control',
  QUOTING_PROPOSALS: 'quoting_proposals',
  PURCHASING_PURCHASE_ORDERS: 'purchasing_purchase_orders',
  SUPPLIERS_MANAGEMENT: 'suppliers_management',
  PRODUCTS_BOM: 'products_bom',
  ORDERS_FULFILLMENT: 'orders_fulfillment',
  CUSTOMERS_MANAGEMENT: 'customers_management',
  CUTLIST_OPTIMIZER: 'cutlist_optimizer',
  USER_CONTROL_ACCESS: 'user_control_access',
  FURNITURE_CONFIGURATOR: 'furniture_configurator',
} as const;

export type ModuleKey = (typeof MODULE_KEYS)[keyof typeof MODULE_KEYS];

export const ALL_MODULE_KEYS: readonly ModuleKey[] = Object.values(MODULE_KEYS);

const MODULE_KEY_SET: ReadonlySet<string> = new Set(ALL_MODULE_KEYS);

export function isKnownModuleKey(value: string): value is ModuleKey {
  return MODULE_KEY_SET.has(value);
}


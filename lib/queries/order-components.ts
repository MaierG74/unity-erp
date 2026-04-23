import { supabase } from '@/lib/supabase';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import {
  ComponentRequirement,
  ProductRequirement,
  SupplierInfo,
  SupplierOption,
} from '@/types/components';

// ---------------------------------------------------------------------------
// React Query keys
// ---------------------------------------------------------------------------

/**
 * Canonical React Query key for the component-suppliers query used by
 * OrderComponentsDialog. Always coerces orderId to string so invalidators
 * (which may pass number) and the subscriber (which passes string) agree —
 * React Query compares key elements with strict equality.
 */
export const componentSuppliersKey = (orderId: number | string) =>
  ['component-suppliers', String(orderId)] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupplierComponent = {
  component: {
    component_id: number;
    internal_code: string;
    description: string;
  };
  shortfall: number;
  quantity_required: number;
  quantity_on_order: number;
  total_required_all_orders?: number;
  order_count?: number;
  global_apparent_shortfall?: number;
  global_real_shortfall?: number;
  selectedSupplier: SupplierOption;
  supplierOptions: SupplierOption[];
};

export type SupplierGroup = {
  supplier: SupplierInfo;
  components: SupplierComponent[];
};

export type SupplierOrderLinePayload = {
  supplier_component_id: number;
  order_quantity: number;
  component_id: number;
  quantity_for_order: number;
  quantity_for_stock: number;
  customer_order_id: number;
};

export type SupplierOrderCreationSuccess = {
  supplierId: number;
  supplierName: string;
  purchaseOrderId: number;
  supplierOrderIds: number[];
};

export type SupplierOrderCreationFailure = {
  supplierId: number;
  supplierName: string;
  reason: string;
};

export type SupplierOrderCreationSummary = {
  successes: SupplierOrderCreationSuccess[];
};

export class SupplierOrderCreationError extends Error {
  public readonly failures: SupplierOrderCreationFailure[];
  public readonly successes: SupplierOrderCreationSuccess[];

  constructor(failures: SupplierOrderCreationFailure[], successes: SupplierOrderCreationSuccess[]) {
    super('Failed to create purchase orders for one or more suppliers');
    this.name = 'SupplierOrderCreationError';
    this.failures = failures;
    this.successes = successes;
  }
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

// Function to fetch component requirements for an order
export async function fetchOrderComponentRequirements(orderId: number): Promise<ProductRequirement[]> {
  try {
    const { data: orderDetails, error: orderError } = await supabase
      .from('order_details')
      .select(`
        order_detail_id,
        order_id,
        product_id,
        quantity,
        unit_price,
        bom_snapshot,
        product:products(
          product_id,
          name,
          description
        )
      `)
      .eq('order_id', orderId);

    if (orderError) {
      console.error('[components] Failed to fetch order details', orderError);
      throw new Error('Failed to fetch order details');
    }

    if (!orderDetails || orderDetails.length === 0) {
      return [];
    }

    const productIds = Array.from(
      new Set(
        orderDetails
          .map((detail) => detail.product_id)
          .filter((id): id is number => typeof id === 'number' && Number.isFinite(id))
      )
    );

    const [statusResult, historyResult, bomResult] = await Promise.all([
      supabase.rpc('get_detailed_component_status', { p_order_id: orderId }),
      supabase.rpc('get_order_component_history', { p_order_id: orderId }),
      productIds.length > 0
        ? supabase
            .from('billofmaterials')
            .select(`
              product_id,
              component_id,
              quantity_required,
              component:components(
                component_id,
                internal_code,
                description
              )
            `)
            .in('product_id', productIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (bomResult.error) {
      console.error('[components] Failed to fetch bill of materials', bomResult.error);
      throw new Error('Failed to load bill of materials');
    }

    if (statusResult.error) {
      console.error('[components] Failed to fetch component status', statusResult.error);
    }

    if (historyResult.error) {
      console.error('[components] Failed to fetch component history', historyResult.error);
    }

    const componentStatusMap = new Map<number, any>();
    (statusResult.data ?? []).forEach((item: any) => {
      if (item?.component_id) {
        componentStatusMap.set(item.component_id, item);
      }
    });

    const historyMap = new Map<number, any[]>();
    (historyResult.data ?? []).forEach((entry: any) => {
      if (!entry?.component_id) return;
      if (!historyMap.has(entry.component_id)) {
        historyMap.set(entry.component_id, []);
      }
      historyMap.get(entry.component_id)!.push(entry);
    });

    const bomByProduct = new Map<number, any[]>();
    (bomResult.data ?? []).forEach((row: any) => {
      if (!row?.product_id || !row?.component) return;
      if (!bomByProduct.has(row.product_id)) {
        bomByProduct.set(row.product_id, []);
      }
      bomByProduct.get(row.product_id)!.push(row);
    });

    return orderDetails.map((detail) => {
      // Prefer bom_snapshot (frozen at order time) over live product BOM
      const snapshot = Array.isArray((detail as any).bom_snapshot) && (detail as any).bom_snapshot.length > 0
        ? (detail as any).bom_snapshot
        : null;

      const bomRows = snapshot
        ? snapshot.map((entry: any) => ({
            component_id: entry.component_id,
            quantity_required: entry.quantity_required,
            component: {
              component_id: entry.component_id,
              internal_code: entry.component_code,
              description: entry.component_description,
            },
          }))
        : bomByProduct.get(detail.product_id) ?? [];

      const components = bomRows
        .map((bomRow: any) => {
          const componentId = bomRow.component_id;
          const component = bomRow.component;

          if (!componentId || !component) {
            return null;
          }

          const status = componentStatusMap.get(componentId);
          const requiredQuantity = Number(detail.quantity ?? 0) * Number(bomRow.quantity_required ?? 0);
          const quantityInStock = Number(status?.in_stock ?? 0);
          const quantityOnOrder = Number(status?.on_order ?? 0);
          const apparentShortfall = Number(
            status?.apparent_shortfall ?? Math.max(requiredQuantity - quantityInStock, 0)
          );
          const realShortfall = Number(
            status?.real_shortfall ?? Math.max(requiredQuantity - quantityInStock - quantityOnOrder, 0)
          );
          const totalRequiredAllOrders = Number(status?.total_required ?? requiredQuantity);
          const orderCount = Number(status?.order_count ?? 1);
          const globalApparentShortfall = Number(
            status?.global_apparent_shortfall ?? Math.max(totalRequiredAllOrders - quantityInStock, 0)
          );
          const globalRealShortfall = Number(
            status?.global_real_shortfall ?? Math.max(totalRequiredAllOrders - quantityInStock - quantityOnOrder, 0)
          );

          return {
            component_id: componentId,
            internal_code: component.internal_code,
            description: component.description,
            quantity_required: requiredQuantity,
            quantity_in_stock: quantityInStock,
            quantity_on_order: quantityOnOrder,
            apparent_shortfall: apparentShortfall,
            real_shortfall: realShortfall,
            order_breakdown: Array.isArray(status?.order_breakdown) ? status.order_breakdown : [],
            on_order_breakdown: Array.isArray(status?.on_order_breakdown) ? status.on_order_breakdown : [],
            history: historyMap.get(componentId) ?? [],
            total_required_all_orders: totalRequiredAllOrders,
            order_count: orderCount,
            global_apparent_shortfall: globalApparentShortfall,
            global_real_shortfall: globalRealShortfall,
            reserved_this_order: Number(status?.reserved_this_order ?? 0),
            reserved_by_others: Number(status?.reserved_by_others ?? 0),
            supplier_options: [],
            selected_supplier: null,
            draft_po_quantity: Number(status?.draft_po_quantity ?? 0),
            draft_po_breakdown: Array.isArray(status?.draft_po_breakdown) ? status.draft_po_breakdown : [],
          } as ComponentRequirement;
        })
        .filter((comp): comp is ComponentRequirement => Boolean(comp));

      return {
        order_detail_id: detail.order_detail_id,
        product_id: detail.product_id,
        product_name: detail.product?.name || 'Unknown Product',
        order_quantity: detail.quantity,
        components,
      } as ProductRequirement;
    });
  } catch (error) {
    console.error('[components] Error building order component requirements', error);
    throw error;
  }
}

// Function to fetch component suppliers for ordering
export async function fetchComponentSuppliers(orderId: number, includeInStock = false) {
  try {
    const { data: statusData, error: statusError } = await supabase.rpc('get_detailed_component_status', {
      p_order_id: orderId,
    });

    if (statusError) {
      console.error('[suppliers] Failed to load component status', statusError);
      return [];
    }

    const filteredComponents = includeInStock
      ? (statusData ?? []).filter((item: any) => item?.component_id)
      : (statusData ?? []).filter(
          (item: any) =>
            Number(item?.real_shortfall ?? 0) > 0 ||
            Number(item?.global_real_shortfall ?? 0) > 0
        );

    if (filteredComponents.length === 0) {
      return [];
    }

    const componentMetaMap = new Map<number, any>();
    const componentIds: number[] = [];

    filteredComponents.forEach((item: any) => {
      if (!item?.component_id) return;
      componentMetaMap.set(item.component_id, item);
      componentIds.push(item.component_id);
    });

    const { data: supplierComponents, error: supplierError } = await supabase
      .from('suppliercomponents')
      .select(`
        supplier_component_id,
        component_id,
        price,
        supplier:suppliers(
          supplier_id,
          name,
          contact_info
        )
      `)
      .in('component_id', componentIds);

    if (supplierError) {
      console.error('[suppliers] Failed to load supplier components', supplierError);
      return [];
    }

    if (!supplierComponents || supplierComponents.length === 0) {
      return [];
    }

    const supplierIds = Array.from(
      new Set(
        supplierComponents
          .map((sc: any) => sc?.supplier?.supplier_id)
          .filter((id): id is number => typeof id === 'number' && Number.isFinite(id))
      )
    );

    let emailMap = new Map<number, string[]>();
    if (supplierIds.length > 0) {
      const { data: supplierEmails, error: emailError } = await supabase
        .from('supplier_emails')
        .select('supplier_id, email, is_primary')
        .in('supplier_id', supplierIds);

      if (emailError) {
        console.error('[suppliers] Failed to load supplier emails', emailError);
      } else if (supplierEmails) {
        emailMap = supplierEmails.reduce((map, row) => {
          if (!row?.supplier_id || !row?.email) return map;
          if (!map.has(row.supplier_id)) {
            map.set(row.supplier_id, []);
          }
          const list = map.get(row.supplier_id)!;
          if (row.is_primary) {
            list.unshift(row.email);
          } else {
            list.push(row.email);
          }
          return map;
        }, new Map<number, string[]>());
      }
    }

    const groups = new Map<number, SupplierGroup>();

    supplierComponents.forEach((sc: any) => {
      const supplier = sc?.supplier;
      const componentId = sc?.component_id;
      const componentMeta = componentMetaMap.get(componentId);

      if (!supplier || !componentMeta) {
        return;
      }

      const existingGroup = groups.get(supplier.supplier_id);
      const supplierInfo: SupplierInfo = existingGroup?.supplier ?? {
        supplier_id: supplier.supplier_id,
        name: supplier.name,
        contact_person: supplier.contact_info ?? '',
        emails: emailMap.get(supplier.supplier_id) ?? [],
        phone: supplier.contact_info ?? '', // Using contact_info for phone as well since phone column doesn't exist
      };

      const option: SupplierOption = {
        supplier: supplierInfo,
        price: Number(sc.price ?? 0),
        supplier_component_id: sc.supplier_component_id,
      };

      const componentEntry = {
        component: {
          component_id: componentMeta.component_id,
          internal_code: componentMeta.internal_code,
          description: componentMeta.description,
        },
        shortfall: Number(componentMeta.real_shortfall ?? 0),
        quantity_required: Number(componentMeta.order_required ?? 0),
        quantity_on_order: Number(componentMeta.on_order ?? 0),
        total_required_all_orders: Number(
          componentMeta.total_required ?? componentMeta.order_required ?? 0
        ),
        order_count: Number(componentMeta.order_count ?? 1),
        global_apparent_shortfall: Number(componentMeta.global_apparent_shortfall ?? 0),
        global_real_shortfall: Number(componentMeta.global_real_shortfall ?? 0),
        selectedSupplier: option,
        supplierOptions: [option],
      };

      if (!existingGroup) {
        groups.set(supplierInfo.supplier_id, {
          supplier: supplierInfo,
          components: [componentEntry],
        });
        return;
      }

      const existingComponent = existingGroup.components.find(
        (entry) => entry.component.component_id === componentEntry.component.component_id
      );

      if (existingComponent) {
        existingComponent.supplierOptions.push(option);
        if (option.price < existingComponent.selectedSupplier.price) {
          existingComponent.selectedSupplier = option;
        }
      } else {
        existingGroup.components.push(componentEntry);
      }
    });

    return Array.from(groups.values()).sort(
      (a, b) => b.components.length - a.components.length
    );
  } catch (error) {
    console.error('[suppliers] Error assembling supplier options', error);
    return [];
  }
}

// Create purchase orders for selected components
export async function createComponentPurchaseOrders(
  selectedComponents: Record<number, boolean>,
  supplierGroups: SupplierGroup[],
  notes: Record<number, string>,
  orderQuantities: Record<number, number>,
  allocation: Record<number, { forThisOrder: number; forStock: number }>,
  orderId: number
) {
  try {
    // Get the draft status ID
    const { data: statusData, error: statusError } = await supabase
      .from('supplier_order_statuses')
      .select('status_id')
      .eq('status_name', 'Draft')
      .single();

    if (statusError || !statusData) {
      throw new Error('Could not find Draft status in the system');
    }

    const draftStatusId = statusData.status_id;
    const today = new Date().toISOString();
    const purchaseOrderSummaries: SupplierOrderCreationSuccess[] = [];
    const supplierFailures: SupplierOrderCreationFailure[] = [];

    const suppliersToProcess = supplierGroups
      .filter(group =>
        group.components.some(c => selectedComponents[c.selectedSupplier.supplier_component_id])
      )
      .map(group => {
        const selectedComponentsForSupplier = group.components
          .filter(c => selectedComponents[c.selectedSupplier.supplier_component_id]);

        if (selectedComponentsForSupplier.length === 0) {
          return null;
        }

        const lineItems: SupplierOrderLinePayload[] = selectedComponentsForSupplier.map(component => {
          const supplierComponentId = component.selectedSupplier.supplier_component_id;
          const orderQuantity = orderQuantities[supplierComponentId] ?? component.shortfall;
          const componentAllocation = allocation[supplierComponentId] || {
            forThisOrder: Math.min(orderQuantity, component.shortfall),
            forStock: Math.max(0, orderQuantity - component.shortfall)
          };

          return {
            supplier_component_id: supplierComponentId,
            order_quantity: orderQuantity,
            component_id: component.component.component_id,
            quantity_for_order: componentAllocation.forThisOrder,
            quantity_for_stock: componentAllocation.forStock,
            customer_order_id: orderId
          };
        });

        return {
          supplierId: group.supplier.supplier_id,
          supplierName: group.supplier.name,
          note: notes[group.supplier.supplier_id] || '',
          lineItems
        };
      })
      .filter((payload): payload is {
        supplierId: number;
        supplierName: string;
        note: string;
        lineItems: SupplierOrderLinePayload[];
      } => payload !== null);

    for (const payload of suppliersToProcess) {
      try {
        const { data, error: rpcError } = await supabase.rpc('create_purchase_order_with_lines', {
          supplier_id: payload.supplierId,
          line_items: payload.lineItems,
          status_id: draftStatusId,
          order_date: today,
          notes: payload.note
        });

        if (rpcError) {
          throw rpcError;
        }

        const rpcResult = Array.isArray(data) ? data?.[0] : data;

        if (!rpcResult || typeof rpcResult.purchase_order_id !== 'number') {
          throw new Error('Unexpected response when creating purchase order');
        }

        purchaseOrderSummaries.push({
          supplierId: payload.supplierId,
          supplierName: payload.supplierName,
          purchaseOrderId: rpcResult.purchase_order_id,
          supplierOrderIds: rpcResult.supplier_order_ids ?? []
        });
      } catch (rpcError) {
        console.error(
          `[purchase-orders] Failed to create purchase order for supplier ${payload.supplierName}`,
          rpcError
        );

        supplierFailures.push({
          supplierId: payload.supplierId,
          supplierName: payload.supplierName,
          reason: rpcError instanceof Error ? rpcError.message : 'Unknown error'
        });
      }
    }

    if (supplierFailures.length > 0) {
      throw new SupplierOrderCreationError(supplierFailures, purchaseOrderSummaries);
    }

    return {
      successes: purchaseOrderSummaries
    } satisfies SupplierOrderCreationSummary;
  } catch (error) {
    console.error('Error creating purchase orders:', error);
    throw error;
  }
}

export async function reserveOrderComponents(orderId: number) {
  const res = await authorizedFetch(`/api/orders/${orderId}/reserve-components`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to reserve components');
  }
  return res.json();
}

export async function releaseOrderComponents(orderId: number) {
  const res = await authorizedFetch(`/api/orders/${orderId}/release-components`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to release component reservations');
  }
  return res.json();
}

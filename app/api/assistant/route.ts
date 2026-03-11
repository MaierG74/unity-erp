import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  buildDemandCoverageAnswer,
  buildOrdersNeedingItemAnswer,
  detectDemandIntent,
  extractDemandComponentReference,
  getItemDemandSummary,
} from '@/lib/assistant/demand';
import {
  buildProductCostAnswer,
  buildProductCostCard,
  detectProductCostIntent,
  extractProductCostReference,
  getProductCostSummary,
} from '@/lib/assistant/costing';
import {
  buildInventoryAnswer,
  buildInventoryCard,
  buildInventorySearchAnswer,
  buildInventorySearchCard,
  detectInventoryIntent,
  extractComponentReference,
  getInventorySearchSummary,
  getInventoryItemSnapshot,
  shouldUseInventorySearchMode,
} from '@/lib/assistant/inventory';
import {
  buildManufacturingAnswer,
  buildOrderJobCardsAnswer,
  buildOrderJobCardsCard,
  buildManufacturingStatusCard,
  buildManufacturingProgressCard,
  buildManufacturingOrderListAnswer,
  buildOrderManufacturingAnswer,
  buildProductionStaffingCard,
  buildUnassignedProductionWorkCard,
  detectManufacturingFocus,
  detectManufacturingIntent,
  extractManufacturingOrderReference,
  extractManufacturingProductReference,
  getProductionStaffingSummary,
  getUnassignedProductionWorkSummary,
  getOrdersCompletedThisWeekSummary,
  getOrdersInProductionSummary,
  getOrderManufacturingSummary,
  getManufacturingSummary,
  isOrderJobCardAssignmentQuestion,
  isOutstandingOrderJobCardsQuestion,
} from '@/lib/assistant/manufacturing';
import {
  buildLateOrdersAnswer,
  buildLateOrdersCard,
  buildDueThisWeekAnswer,
  buildDueThisWeekCard,
  buildLastCustomerOrderAnswer,
  buildLastCustomerOrderCard,
  buildLowStockAnswer,
  buildLowStockCard,
  buildOpenOrdersAnswer,
  buildOpenOrdersCard,
  buildOrderSearchAnswer,
  buildOrderSearchCard,
  buildProductOpenOrdersAnswer,
  buildProductOpenOrdersCard,
  buildOrderProductsAnswer,
  buildOrderProductsCard,
  buildRecentCustomerOrdersAnswer,
  buildRecentCustomerOrdersCard,
  buildOrdersLast7DaysAnswer,
  buildOrdersLast7DaysCard,
  buildOrderBlockerAnswer,
  buildOrderBlockerCard,
  detectOrderSearchMode,
  detectOperationalIntent,
  extractOrderProductsReference,
  extractProductOpenOrdersReference,
  extractOrderSearchReference,
  extractLatestOrderCustomerReference,
  extractOpenOrdersCustomerReference,
  extractRecentCustomerOrdersCustomerReference,
  extractRecentOrdersCustomerReference,
  extractOrderReference,
  getLastCustomerOrderSummary,
  getLateOrdersSummary,
  getLowStockSummary,
  getOpenCustomerOrdersSummary,
  getOrderSearchSummary,
  getOrderBlockerSummary,
  getOrderProductsSummary,
  getProductOpenOrdersSummary,
  getOrdersLast7DaysSummary,
  getOrdersDueThisWeekSummary,
  resolveOpenOrdersCustomer,
  shouldListOpenOrders,
} from '@/lib/assistant/operational';
import {
  buildLateSupplierOrdersAnswer,
  buildLateSupplierOrdersCard,
  buildNextDeliveryAnswer,
  buildNextDeliveryCard,
  buildSupplierOrdersCard,
  buildSupplierOrdersFollowUpAnswer,
  buildSupplierOrdersFollowUpCard,
  buildSupplierOrdersAnswer,
  detectPurchasingIntent,
  extractPurchasingComponentReference,
  getLateSupplierOrdersSummary,
  getItemNextDeliverySummary,
  getItemSupplierOrdersSummary,
  getSupplierOrdersFollowUpSummary,
} from '@/lib/assistant/purchasing';
import {
  getAssistantScope,
  getAssistantScopeLabel,
  getAssistantSuggestions,
  type AssistantReply,
} from '@/lib/assistant/prompt-suggestions';
import {
  buildAssistantComponentClarifyAnswer,
  buildAssistantComponentClarifyCard,
} from '@/lib/assistant/component-resolver';
import {
  buildAssistantProductClarifyAnswer,
  buildAssistantProductClarifyCard,
} from '@/lib/assistant/product-resolver';
import { classifyAssistantRequestWithModel } from '@/lib/assistant/model-router';
import { getRouteClient } from '@/lib/supabase-route';

const requestSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  pathname: z.string().trim().max(200).optional().nullable(),
  history: z
    .array(
      z.object({
        role: z.enum(['assistant', 'user']),
        content: z.string().trim().min(1).max(2000),
        cardTitle: z.string().trim().max(200).optional().nullable(),
      })
    )
    .max(12)
    .optional(),
  context: z
    .object({
      activeOrder: z
        .object({
          orderId: z.number().int().positive().optional(),
          orderNumber: z.string().trim().max(120).optional().nullable(),
          customerName: z.string().trim().max(160).optional().nullable(),
        })
        .optional()
        .nullable(),
    })
    .optional()
    .nullable(),
});

const outOfScopePattern =
  /\b(weather|temperature|forecast|news|headlines|sports score|president|prime minister|bitcoin|btc|ethereum|eth|stock market|nasdaq|dow jones|movie times|recipe|flight status)\b/i;

const helpPattern = /\b(how do i|where do i|explain this screen|what does this page do)\b/i;

const erpDataPattern =
  /\b(stock|inventory|component|supplier|purchase order|po\b|on order|on hand|reserved|delivery|quote|quotes|customer order|order\b|bom|cutlist|task|todo|clocked in|payroll)\b/i;

function buildReply(
  pathname: string | null | undefined,
  overrides: Omit<AssistantReply, 'scopeLabel' | 'suggestions'> & { suggestions?: string[] }
): AssistantReply {
  return {
    scopeLabel: getAssistantScopeLabel(pathname),
    suggestions: overrides.suggestions ?? getAssistantSuggestions(pathname),
    ...overrides,
  };
}

type AssistantHistoryEntry = NonNullable<z.infer<typeof requestSchema>['history']>[number];

function normalizeConversationText(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function isOpenOrdersListFollowUp(message: string) {
  const normalized = normalizeConversationText(message)
    .toLowerCase()
    .replace(/[?!.,]/g, ' ');

  return (
    /^(?:can you|could you|would you|please)?\s*(?:list|show|display)\b/.test(normalized) &&
    /\b(them|those|the orders?|the open orders?)\b/.test(normalized)
  );
}

function extractOpenOrdersContextFromHistory(history: AssistantHistoryEntry[]) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item.role !== 'assistant') {
      continue;
    }

    const cardTitle = normalizeConversationText(item.cardTitle);
    if (cardTitle) {
      if (/^open customer orders$/i.test(cardTitle)) {
        return { customerRef: null as string | null };
      }

      const titleMatch = cardTitle.match(/^open orders for (.+)$/i);
      if (titleMatch?.[1]) {
        return { customerRef: titleMatch[1].trim() };
      }
    }

    const content = normalizeConversationText(item.content);
    const contentMatch = content.match(/^Open customer orders(?: for (.+?))?:\s*\d+/i);
    if (contentMatch) {
      return { customerRef: contentMatch[1]?.trim() || null };
    }
  }

  return null;
}

function getOpenOrdersFollowUpContext(message: string, history: AssistantHistoryEntry[]) {
  if (!isOpenOrdersListFollowUp(message) || history.length === 0) {
    return null;
  }

  const priorContext = extractOpenOrdersContextFromHistory(history);
  if (!priorContext) {
    return null;
  }

  return {
    customerRef: priorContext.customerRef,
    detailed: true,
  };
}

function getActiveOrderReference(
  context: z.infer<typeof requestSchema>['context'],
  message: string,
  options?: { allowJobCardLanguage?: boolean }
) {
  const normalized = normalizeConversationText(message).toLowerCase();
  const refersToCurrentOrder =
    /\b(this|that)\s+order\b/.test(normalized) ||
    (Boolean(options?.allowJobCardLanguage) &&
      /\b(job cards?|jobcard)\b/.test(normalized) &&
      /\b(owing|outstanding|remaining|left|for this order)\b/.test(normalized));

  if (!refersToCurrentOrder) {
    return null;
  }

  const orderNumber = normalizeConversationText(context?.activeOrder?.orderNumber);
  if (orderNumber) {
    return orderNumber;
  }

  if (context?.activeOrder?.orderId) {
    return String(context.activeOrder.orderId);
  }

  return null;
}

function getSelectedOrderReference(context: z.infer<typeof requestSchema>['context']) {
  const orderNumber = normalizeConversationText(context?.activeOrder?.orderNumber);
  if (orderNumber) {
    return orderNumber;
  }

  if (context?.activeOrder?.orderId) {
    return String(context.activeOrder.orderId);
  }

  return null;
}

function detectActiveOrderFollowUpIntent(
  context: z.infer<typeof requestSchema>['context'],
  message: string
): 'order_products' | 'order_blockers' | 'order_job_cards' | 'order_documents' | null {
  const hasActiveOrder =
    Boolean(context?.activeOrder?.orderId) ||
    normalizeConversationText(context?.activeOrder?.orderNumber).length > 0;
  if (!hasActiveOrder) {
    return null;
  }

  const normalized = normalizeConversationText(message).toLowerCase();
  if (!normalized) {
    return null;
  }

  const hasExplicitOrderReference =
    Boolean(extractOrderReference(normalized)) ||
    Boolean(extractManufacturingOrderReference(normalized)) ||
    Boolean(extractOrderProductsReference(normalized));
  if (hasExplicitOrderReference) {
    return null;
  }

  const refersToActiveOrder =
    /\b(this|that|current|selected|same)\b/.test(normalized) ||
    /\b(it|them)\b/.test(normalized) ||
    !/\border\b/.test(normalized);
  if (!refersToActiveOrder) {
    return null;
  }

  if (
    /\b(open|show|view)\b/.test(normalized) &&
    /\b(documents|document|docs|client docs|customer docs)\b/.test(normalized)
  ) {
    return 'order_documents';
  }

  if (
    isOrderJobCardAssignmentQuestion(normalized) ||
    isOutstandingOrderJobCardsQuestion(normalized) ||
    (/\b(job cards?|jobcard)\b/.test(normalized) &&
      /\b(show|list|what|which|open|attached|owing|remaining|left|are)\b/.test(normalized))
  ) {
    return 'order_job_cards';
  }

  if (
    (/\b(products?|items?)\b/.test(normalized) &&
      /\b(show|list|what|which|open)\b/.test(normalized)) ||
    /\bwhat(?:'s| is) on (?:it|this|that)\b/.test(normalized)
  ) {
    return 'order_products';
  }

  if (
    /\bstill owing\b/.test(normalized) ||
    /\bsupplier parts?\b/.test(normalized) ||
    /\bfrom suppliers?\b/.test(normalized) ||
    /\boutstanding parts?\b/.test(normalized) ||
    /\bdeliver(?:ed|ies|y)\b/.test(normalized) ||
    /\bwhat(?:'s| is) outstanding\b/.test(normalized) ||
    /\bwhat(?:'s| is) left\b/.test(normalized) ||
    /\bwhat(?:'s| is) blocking\b/.test(normalized) ||
    /\bblocking\b/.test(normalized)
  ) {
    return 'order_blockers';
  }

  return null;
}

function shouldPreferProductOpenOrdersRoute(options: {
  message: string;
  pathname: string | null | undefined;
  operationalIntent: ReturnType<typeof detectOperationalIntent>;
  purchasingIntent: ReturnType<typeof detectPurchasingIntent>;
  inventoryIntent: ReturnType<typeof detectInventoryIntent>;
  productRef: string | null;
}) {
  if (!options.productRef || options.productRef.length < 2) {
    return false;
  }

  if (options.operationalIntent === 'product_open_orders') {
    return true;
  }

  const normalized = options.message.toLowerCase();
  const scope = getAssistantScope(options.pathname);
  const mentionsSupplierOrInventory =
    /\b(stock|inventory|component|supplier|supplier orders?|purchase orders?|open po|eta|delivery|incoming|reserved|on hand)\b/.test(
      normalized
    );
  const mentionsCustomerProductOrder =
    /\b(customer orders?|customers ordered|ordered by customers|on order|in order|ordered)\b/.test(
      normalized
    );

  if (!mentionsCustomerProductOrder || mentionsSupplierOrInventory) {
    return false;
  }

  if (scope === 'products') {
    return true;
  }

  return options.inventoryIntent == null;
}

function buildInventoryClarifySuggestions(
  candidates: Array<{ internal_code: string }>,
  intent: 'snapshot' | 'on_hand' | 'on_order' | 'reserved'
) {
  return candidates.map(candidate => {
    switch (intent) {
      case 'on_hand':
        return `How much of ${candidate.internal_code} do we have in stock?`;
      case 'on_order':
        return `How much of ${candidate.internal_code} do we have on order?`;
      case 'reserved':
        return `How much of ${candidate.internal_code} is reserved?`;
      default:
        return `Show stock snapshot for ${candidate.internal_code}`;
    }
  });
}

async function resolveOrdersCustomerOrReply(
  supabase: Parameters<typeof resolveOpenOrdersCustomer>[0],
  pathname: string | null | undefined,
  customerRef: string
) {
  const resolvedCustomer = await resolveOpenOrdersCustomer(supabase, customerRef);

  if (resolvedCustomer.kind === 'ambiguous') {
    return {
      resolvedCustomer: null,
      reply: buildReply(pathname, {
        status: 'clarify',
        message: `I found multiple possible customers for "${customerRef}". Which one did you mean?`,
        suggestions: resolvedCustomer.candidates.map(
          candidate => `How many open orders for ${candidate}?`
        ),
      }),
    };
  }

  if (resolvedCustomer.kind === 'not_found') {
    return {
      resolvedCustomer: null,
      reply: buildReply(pathname, {
        status: 'unknown',
        message: `I don't know. I couldn't find a customer matching "${customerRef}" in open orders.`,
        suggestions: [
          'How many open customer orders do we have?',
          'Which orders are due this week?',
          'Which orders are late?',
        ],
      }),
    };
  }

  return {
    resolvedCustomer,
    reply: null,
  };
}

function getOperationalIntentFromModelAction(
  action: string | null | undefined
): ReturnType<typeof detectOperationalIntent> {
  switch (action) {
    case 'open_orders':
    case 'product_open_orders':
    case 'order_products':
    case 'last_customer_order':
    case 'recent_customer_orders':
    case 'order_search':
    case 'orders_last_7_days':
    case 'orders_due_this_week':
    case 'late_orders':
    case 'low_stock':
    case 'order_blockers':
      return action;
    default:
      return null;
  }
}

function getCostingIntentFromModelAction(action: string | null | undefined) {
  return action === 'product_cost' ? 'product_cost' : null;
}

function getPurchasingIntentFromModelAction(
  action: string | null | undefined
): ReturnType<typeof detectPurchasingIntent> {
  switch (action) {
    case 'supplier_orders_for_item':
    case 'next_delivery_for_item':
    case 'supplier_orders_follow_up':
    case 'late_supplier_orders':
      return action;
    default:
      return null;
  }
}

function getManufacturingIntentFromModelAction(
  action: string | null | undefined
): ReturnType<typeof detectManufacturingIntent> {
  switch (action) {
    case 'manufacturing_status':
    case 'order_job_cards':
    case 'orders_in_production':
    case 'orders_completed_this_week':
    case 'production_staffing':
    case 'unassigned_production_work':
      return action;
    default:
      return null;
  }
}

export async function POST(req: NextRequest) {
  const routeClient = await getRouteClient(req);
  if ('error' in routeClient) {
    return NextResponse.json({ error: routeClient.error }, { status: routeClient.status ?? 401 });
  }

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'A non-empty "message" is required.' }, { status: 400 });
  }

  const { message, pathname, history = [], context } = parsed.data;
  const normalized = message.trim();
  const openOrdersFollowUp = getOpenOrdersFollowUpContext(normalized, history);
  const detectedOperationalIntent = detectOperationalIntent(normalized);
  const explicitOpenOrdersCustomerRef = extractOpenOrdersCustomerReference(normalized);
  const detectedManufacturingIntent = detectManufacturingIntent(normalized);
  const explicitManufacturingOrderRef =
    extractManufacturingOrderReference(normalized) ||
    getActiveOrderReference(context, normalized, { allowJobCardLanguage: true });
  const activeOrderFollowUpIntent = detectActiveOrderFollowUpIntent(context, normalized);
  let modelRoute: Awaited<ReturnType<typeof classifyAssistantRequestWithModel>> = null;
  try {
    modelRoute = await classifyAssistantRequestWithModel(normalized);
  } catch (error) {
    console.error('[assistant] model routing failed, falling back to deterministic routing', error);
  }

  const demandIntent =
    modelRoute?.action === 'orders_needing_item'
      ? 'orders_needing_item'
      : modelRoute?.action === 'demand_coverage'
        ? 'enough_for_open_demand'
        : detectDemandIntent(normalized);
  const inventoryIntent =
    modelRoute?.action === 'inventory_snapshot'
      ? modelRoute.inventory_intent ?? detectInventoryIntent(normalized)
      : detectInventoryIntent(normalized);
  const shouldForceOpenOrdersIntent =
    detectedOperationalIntent === 'open_orders' &&
    Boolean(explicitOpenOrdersCustomerRef || modelRoute?.customer_ref?.trim());
  const activeOrderOperationalIntent =
    activeOrderFollowUpIntent === 'order_products' || activeOrderFollowUpIntent === 'order_blockers'
      ? activeOrderFollowUpIntent
      : null;
  const activeOrderManufacturingIntent =
    activeOrderFollowUpIntent === 'order_job_cards' ? 'order_job_cards' : null;
  const operationalIntent = openOrdersFollowUp
    ? 'open_orders'
    : explicitManufacturingOrderRef && detectedManufacturingIntent
      ? null
      : shouldForceOpenOrdersIntent
        ? 'open_orders'
      : getOperationalIntentFromModelAction(modelRoute?.action) ??
        detectedOperationalIntent ??
        activeOrderOperationalIntent;
  const costingIntent =
    getCostingIntentFromModelAction(modelRoute?.action) ?? detectProductCostIntent(normalized);
  const purchasingIntent =
    getPurchasingIntentFromModelAction(modelRoute?.action) ?? detectPurchasingIntent(normalized);
  const manufacturingIntent =
    activeOrderManufacturingIntent ??
    getManufacturingIntentFromModelAction(modelRoute?.action) ??
    detectedManufacturingIntent;
  const manufacturingFocus = modelRoute?.manufacturing_focus ?? detectManufacturingFocus(normalized);
  const productOpenOrdersRef =
    modelRoute?.product_ref?.trim() || extractProductOpenOrdersReference(normalized);
  const preferProductOpenOrders = shouldPreferProductOpenOrdersRoute({
    message: normalized,
    pathname,
    operationalIntent,
    purchasingIntent,
    inventoryIntent,
    productRef: productOpenOrdersRef,
  });

  let reply: AssistantReply;

  if (/^(hi|hello|hey|help)$/i.test(normalized)) {
    reply = buildReply(pathname, {
      status: 'welcome',
      message:
        'I am a Unity ERP data assistant prototype. Ask about Unity data only. If I cannot verify an answer from trusted data, I will say "I don\'t know."',
    });
  } else if (outOfScopePattern.test(normalized)) {
    reply = buildReply(pathname, {
      status: 'out_of_scope',
      message:
        'That is outside this assistant\'s scope. I only answer questions about Unity ERP data and Unity workflows.',
    });
  } else if (modelRoute?.action === 'out_of_scope') {
    reply = buildReply(pathname, {
      status: 'out_of_scope',
      message:
        'That is outside this assistant\'s scope. I only answer questions about Unity ERP data and Unity workflows.',
    });
  } else if (helpPattern.test(normalized)) {
    reply = buildReply(pathname, {
      status: 'tool_pending',
      message:
        'I understand that as a Unity workflow question, but the documentation/RAG tools are not wired into this prototype yet, so I do not know the verified answer from docs yet.',
      });
  } else if (modelRoute?.action === 'help') {
    reply = buildReply(pathname, {
      status: 'tool_pending',
      message:
        'I understand that as a Unity workflow question, but the documentation/RAG tools are not wired into this prototype yet, so I do not know the verified answer from docs yet.',
    });
  } else if (costingIntent === 'product_cost') {
    const productRef =
      modelRoute?.product_ref?.trim() || extractProductCostReference(normalized);

    if (!productRef || productRef.length < 2) {
      reply = buildReply(pathname, {
        status: 'clarify',
        message:
          'I understood that as a costing question, but I could not tell which product you meant. Rephrase it with a product code or product name.',
        suggestions: [
          'What is the cost of Apollo Highback?',
          'What is the cost of Apollo Heavy Duty?',
          'What is the cost of Apollo Mid Back?',
        ],
      });
      return NextResponse.json(reply);
    }

    try {
      const result = await getProductCostSummary(routeClient.supabase, productRef, {
        origin: req.nextUrl.origin,
        cookieHeader: req.headers.get('cookie'),
        authorizationHeader: req.headers.get('authorization'),
      });

      if (result.kind === 'summary') {
        const productLabel =
          result.product.internal_code?.trim() || result.product.name?.trim() || String(result.product.product_id);

        reply = buildReply(pathname, {
          status: 'answered',
          message: buildProductCostAnswer(result),
          card: buildProductCostCard(result),
          suggestions: [
            `What is the cost of ${productLabel}?`,
            `Has product ${productLabel} been manufactured?`,
            `Show production progress for ${productLabel}`,
          ],
        });
        return NextResponse.json(reply);
      }

      if (result.kind === 'ambiguous') {
        reply = buildReply(pathname, {
          status: 'clarify',
          message: buildProductCostAnswer(result),
          suggestions: result.candidates.map(candidate =>
            `What is the cost of ${candidate.internal_code ?? candidate.name ?? `product ${candidate.product_id}`}?`
          ),
        });
        return NextResponse.json(reply);
      }

      reply = buildReply(pathname, {
        status: 'unknown',
        message: buildProductCostAnswer(result),
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] product costing summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the product-costing tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (activeOrderFollowUpIntent === 'order_documents') {
    const activeOrderId = context?.activeOrder?.orderId ?? null;
    const activeOrderNumber = normalizeConversationText(context?.activeOrder?.orderNumber);
    const orderLabel = activeOrderNumber || (activeOrderId ? `Order ${activeOrderId}` : 'this order');

    if (!activeOrderId) {
      reply = buildReply(pathname, {
        status: 'clarify',
        message:
          'I understood that as a document follow-up, but I could not tell which order is currently selected.',
      });
      return NextResponse.json(reply);
    }

    reply = buildReply(pathname, {
      status: 'answered',
      message: `Here are the documents for ${orderLabel}.`,
      actions: [
        {
          label: 'Open documents',
          kind: 'navigate',
          href: `/orders/${activeOrderId}?tab=documents`,
        },
        {
          label: 'Open order',
          kind: 'navigate',
          href: `/orders/${activeOrderId}`,
        },
        {
          label: 'Preview order',
          kind: 'preview_order',
          orderId: activeOrderId,
        },
      ],
      suggestions: [
        `What products are on order ${orderLabel}?`,
        `What job cards are on order ${orderLabel}?`,
        `What is blocking order ${orderLabel}?`,
      ],
    });
      return NextResponse.json(reply);
  } else if (
    (operationalIntent === 'product_open_orders' || preferProductOpenOrders) &&
    activeOrderManufacturingIntent == null &&
    manufacturingIntent !== 'order_job_cards'
  ) {
    const productRef = productOpenOrdersRef;

    if (!productRef || productRef.length < 2) {
      reply = buildReply(pathname, {
        status: 'clarify',
        message:
          'I understood that as a product-order question, but I could not tell which product you meant. Rephrase it with a product code or product name.',
        suggestions: [
          'Do we have any Apollo Highback in order at the moment?',
          'Which customer orders include Apollo Heavy Duty?',
          'Do we have any Apollo Mid Back on order from customers?',
        ],
      });
      return NextResponse.json(reply);
    }

    try {
      const result = await getProductOpenOrdersSummary(routeClient.supabase, productRef);

      if (result.kind === 'summary') {
        const productLabel =
          result.product.name?.trim() || result.product.internal_code?.trim() || `Product ${result.product.product_id}`;

        reply = buildReply(pathname, {
          status: 'answered',
          message: buildProductOpenOrdersAnswer(result),
          card: buildProductOpenOrdersCard(result),
          suggestions: [
            `What is the cost of ${productLabel}?`,
            `Has product ${productLabel} been manufactured?`,
            `Which customer orders include ${productLabel}?`,
          ],
        });
        return NextResponse.json(reply);
      }

      if (result.kind === 'ambiguous') {
        reply = buildReply(pathname, {
          status: 'clarify',
          message: buildAssistantProductClarifyAnswer(result.product_ref, result.candidates),
          card: buildAssistantProductClarifyCard(result.product_ref, result.candidates, {
            buildPrompt: candidate =>
              `Which customer orders include ${candidate.name?.trim() || candidate.internal_code?.trim() || `product ${candidate.product_id}`}?`,
            primaryActionLabel: 'Check customer orders',
            description:
              'I found multiple product matches for this customer-order question. Pick one to see current open customer orders.',
          }),
          suggestions: result.candidates.map(candidate =>
            `Which customer orders include ${candidate.name?.trim() || candidate.internal_code?.trim() || `product ${candidate.product_id}`}?`
          ),
        });
        return NextResponse.json(reply);
      }

      reply = buildReply(pathname, {
        status: 'unknown',
        message: buildProductOpenOrdersAnswer(result),
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] product open orders summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the product open-orders tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (operationalIntent === 'order_products') {
    const selectedOrderRef =
      activeOrderFollowUpIntent === 'order_products' ? getSelectedOrderReference(context) : null;
    const orderRef =
      modelRoute?.order_ref?.trim() ||
      extractOrderProductsReference(normalized) ||
      extractOrderReference(normalized) ||
      selectedOrderRef ||
      getActiveOrderReference(context, normalized);

    if (!orderRef || orderRef.length < 1) {
      reply = buildReply(pathname, {
        status: 'clarify',
        message:
          'I understood that as an order-products question, but I could not tell which order you meant. Rephrase it with an order number.',
      });
      return NextResponse.json(reply);
    }

    try {
      const summary = await getOrderProductsSummary(routeClient.supabase, orderRef);

      if (summary.kind === 'ambiguous') {
        reply = buildReply(pathname, {
          status: 'clarify',
          message: buildOrderProductsAnswer(summary),
          suggestions: summary.candidates.map(candidate =>
            `What products are on order ${candidate.order_number?.trim() || candidate.order_id}?`
          ),
        });
        return NextResponse.json(reply);
      }

      if (summary.kind === 'not_found') {
        reply = buildReply(pathname, {
          status: 'unknown',
          message: buildOrderProductsAnswer(summary),
        });
        return NextResponse.json(reply);
      }

      const orderLabel = summary.order.order_number?.trim() || String(summary.order.order_id);
      reply = buildReply(pathname, {
        status: 'answered',
        message: buildOrderProductsAnswer(summary),
        card: buildOrderProductsCard(summary),
        suggestions: [
          `Show production progress for order ${orderLabel}`,
          `What is blocking order ${orderLabel}?`,
          `Has order ${orderLabel} been manufactured?`,
        ],
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] order products summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the order-products tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (operationalIntent === 'last_customer_order') {
    const customerRef =
      modelRoute?.customer_ref?.trim() || extractLatestOrderCustomerReference(normalized);

    if (!customerRef) {
      reply = buildReply(pathname, {
        status: 'clarify',
        message:
          'I understood that as a latest-order question, but I could not tell which customer you meant.',
      });
      return NextResponse.json(reply);
    }

    try {
      const resolved = await resolveOrdersCustomerOrReply(routeClient.supabase, pathname, customerRef);
      if (resolved.reply) {
        reply = resolved.reply;
        return NextResponse.json(reply);
      }

      const summary = await getLastCustomerOrderSummary(
        routeClient.supabase,
        resolved.resolvedCustomer!.customer_name
      );
      reply = buildReply(pathname, {
        status: summary.latest_order ? 'answered' : 'unknown',
        message: buildLastCustomerOrderAnswer(summary),
        card: buildLastCustomerOrderCard(summary),
        suggestions: summary.latest_order
          ? [
              `Orders from last 7 days for ${resolved.resolvedCustomer!.customer_name}`,
              `How many open orders for ${resolved.resolvedCustomer!.customer_name}?`,
              `Which orders are due this week for ${resolved.resolvedCustomer!.customer_name}?`,
            ]
          : [
              `Orders from last 7 days for ${resolved.resolvedCustomer!.customer_name}`,
              'How many open customer orders do we have?',
              'Which orders are due this week?',
            ],
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] latest customer order summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the latest-order lookup failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (operationalIntent === 'recent_customer_orders') {
    const customerRef =
      modelRoute?.customer_ref?.trim() || extractRecentCustomerOrdersCustomerReference(normalized);

    if (!customerRef) {
      reply = buildReply(pathname, {
        status: 'clarify',
        message:
          'I understood that as a recent-customer-orders question, but I could not tell which customer you meant.',
      });
      return NextResponse.json(reply);
    }

    try {
      const resolved = await resolveOrdersCustomerOrReply(routeClient.supabase, pathname, customerRef);
      if (resolved.reply) {
        reply = resolved.reply;
        return NextResponse.json(reply);
      }

      const summary = await getLastCustomerOrderSummary(
        routeClient.supabase,
        resolved.resolvedCustomer!.customer_name
      );
      reply = buildReply(pathname, {
        status: summary.recent_orders.length > 0 ? 'answered' : 'unknown',
        message: buildRecentCustomerOrdersAnswer(summary),
        card: buildRecentCustomerOrdersCard(summary),
        suggestions: [
          `What was the last order from ${resolved.resolvedCustomer!.customer_name}?`,
          `Orders from last 7 days for ${resolved.resolvedCustomer!.customer_name}`,
          `How many open orders for ${resolved.resolvedCustomer!.customer_name}?`,
        ],
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] recent customer orders summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the recent-customer-orders lookup failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (operationalIntent === 'order_search') {
    const searchRef = modelRoute?.order_ref?.trim() || extractOrderSearchReference(normalized);

    if (!searchRef) {
      reply = buildReply(pathname, {
        status: 'clarify',
        message:
          'I understood that as an order search, but I could not tell what order text to match.',
      });
      return NextResponse.json(reply);
    }

    try {
      const matchMode = detectOrderSearchMode(normalized);
      const summary = await getOrderSearchSummary(routeClient.supabase, searchRef, matchMode);
      reply = buildReply(pathname, {
        status: 'answered',
        message: buildOrderSearchAnswer(summary),
        card: buildOrderSearchCard(summary),
        suggestions: [
          ...(summary.orders[0]?.customer_name?.trim()
            ? [`What was the last order from ${summary.orders[0].customer_name.trim()}?`]
            : []),
          'How many open customer orders do we have?',
          'Which orders are due this week?',
        ],
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] order search failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the order-search tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (operationalIntent === 'open_orders') {
    const customerRef = openOrdersFollowUp
      ? openOrdersFollowUp.customerRef
      : explicitOpenOrdersCustomerRef || modelRoute?.customer_ref?.trim() || extractOpenOrdersCustomerReference(normalized);
    const detailedOpenOrders =
      Boolean(openOrdersFollowUp?.detailed) ||
      shouldListOpenOrders(normalized) ||
      (Boolean(customerRef) && !/\b(how many|count|total|number of|summary|overview)\b/i.test(normalized));

    try {
      if (customerRef) {
        const resolved = await resolveOrdersCustomerOrReply(routeClient.supabase, pathname, customerRef);
        if (resolved.reply) {
          reply = resolved.reply;
          return NextResponse.json(reply);
        }
        const summary = await getOpenCustomerOrdersSummary(
          routeClient.supabase,
          resolved.resolvedCustomer!.customer_name
        );
        reply = buildReply(pathname, {
          status: 'answered',
          message: buildOpenOrdersAnswer(summary, { detailed: detailedOpenOrders }),
          card: buildOpenOrdersCard(summary, { detailed: detailedOpenOrders }),
          suggestions: [
            `How many open orders for ${resolved.resolvedCustomer!.customer_name}?`,
            `Which orders are due this week for ${resolved.resolvedCustomer!.customer_name}?`,
            `Which orders are late for ${resolved.resolvedCustomer!.customer_name}?`,
          ],
        });
        return NextResponse.json(reply);
      }

      const summary = await getOpenCustomerOrdersSummary(routeClient.supabase);
      reply = buildReply(pathname, {
        status: 'answered',
        message: buildOpenOrdersAnswer(summary, { detailed: detailedOpenOrders }),
        card: buildOpenOrdersCard(summary, { detailed: detailedOpenOrders }),
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] open customer orders summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the open customer orders tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (operationalIntent === 'orders_due_this_week') {
    const customerRef = modelRoute?.customer_ref?.trim() || extractOpenOrdersCustomerReference(normalized);

    try {
      if (customerRef) {
        const resolved = await resolveOrdersCustomerOrReply(routeClient.supabase, pathname, customerRef);
        if (resolved.reply) {
          reply = resolved.reply;
          return NextResponse.json(reply);
        }

        const summary = await getOrdersDueThisWeekSummary(
          routeClient.supabase,
          resolved.resolvedCustomer!.customer_name
        );
        reply = buildReply(pathname, {
          status: 'answered',
          message: buildDueThisWeekAnswer(summary),
          card: buildDueThisWeekCard(summary),
          suggestions: [
            `How many open orders for ${resolved.resolvedCustomer!.customer_name}?`,
            `Which orders are late for ${resolved.resolvedCustomer!.customer_name}?`,
            ...(summary.orders[0]?.order_number?.trim()
              ? [`What is blocking order ${summary.orders[0].order_number.trim()}?`]
              : []),
          ],
        });
        return NextResponse.json(reply);
      }

      const summary = await getOrdersDueThisWeekSummary(routeClient.supabase);
      reply = buildReply(pathname, {
        status: 'answered',
        message: buildDueThisWeekAnswer(summary),
        card: buildDueThisWeekCard(summary),
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] orders due this week summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the due-this-week orders tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (operationalIntent === 'late_orders') {
    const customerRef = modelRoute?.customer_ref?.trim() || extractOpenOrdersCustomerReference(normalized);

    try {
      if (customerRef) {
        const resolved = await resolveOrdersCustomerOrReply(routeClient.supabase, pathname, customerRef);
        if (resolved.reply) {
          reply = resolved.reply;
          return NextResponse.json(reply);
        }

        const summary = await getLateOrdersSummary(
          routeClient.supabase,
          resolved.resolvedCustomer!.customer_name
        );
        reply = buildReply(pathname, {
          status: 'answered',
          message: buildLateOrdersAnswer(summary),
          card: buildLateOrdersCard(summary),
          suggestions: [
            `How many open orders for ${resolved.resolvedCustomer!.customer_name}?`,
            `Which orders are due this week for ${resolved.resolvedCustomer!.customer_name}?`,
            summary.late_orders[0]?.order_number?.trim()
              ? `What is blocking order ${summary.late_orders[0].order_number?.trim()}?`
              : 'Which items are below reorder level?',
          ],
        });
        return NextResponse.json(reply);
      }

      const summary = await getLateOrdersSummary(routeClient.supabase);
      reply = buildReply(pathname, {
        status: 'answered',
        message: buildLateOrdersAnswer(summary),
        card: buildLateOrdersCard(summary),
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] late orders summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the late-orders tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (operationalIntent === 'orders_last_7_days') {
    const customerRef =
      modelRoute?.customer_ref?.trim() || extractRecentOrdersCustomerReference(normalized);

    try {
      if (customerRef) {
        const resolved = await resolveOrdersCustomerOrReply(routeClient.supabase, pathname, customerRef);
        if (resolved.reply) {
          reply = resolved.reply;
          return NextResponse.json(reply);
        }

        const summary = await getOrdersLast7DaysSummary(
          routeClient.supabase,
          resolved.resolvedCustomer!.customer_name
        );
        reply = buildReply(pathname, {
          status: 'answered',
          message: buildOrdersLast7DaysAnswer(summary),
          card: buildOrdersLast7DaysCard(summary),
          suggestions: [
            `How many open orders for ${resolved.resolvedCustomer!.customer_name}?`,
            `Which orders are due this week for ${resolved.resolvedCustomer!.customer_name}?`,
            `Which orders are late for ${resolved.resolvedCustomer!.customer_name}?`,
          ],
        });
        return NextResponse.json(reply);
      }

      const summary = await getOrdersLast7DaysSummary(routeClient.supabase);
      reply = buildReply(pathname, {
        status: 'answered',
        message: buildOrdersLast7DaysAnswer(summary),
        card: buildOrdersLast7DaysCard(summary),
        suggestions: [
          'How many open customer orders do we have?',
          'Which orders are due this week?',
          'Which orders are late?',
        ],
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] orders last 7 days summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the recent-orders trend tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (operationalIntent === 'low_stock') {
    try {
      const summary = await getLowStockSummary(routeClient.supabase);
      reply = buildReply(pathname, {
        status: 'answered',
        message: buildLowStockAnswer(summary),
        card: buildLowStockCard(summary),
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] low stock summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the low-stock tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (operationalIntent === 'order_blockers') {
    const selectedOrderRef =
      activeOrderFollowUpIntent === 'order_blockers' ? getSelectedOrderReference(context) : null;
    const orderRef =
      modelRoute?.order_ref?.trim() ||
      extractOrderReference(normalized) ||
      selectedOrderRef ||
      getActiveOrderReference(context, normalized);

    if (!orderRef) {
      reply = buildReply(pathname, {
        status: 'clarify',
        message:
          'I understood that as an order blocker question, but I could not tell which order you meant. Rephrase it with an order number or order id.',
      });
      return NextResponse.json(reply);
    }

    try {
      const summary = await getOrderBlockerSummary(routeClient.supabase, orderRef);

      if (summary.kind === 'ambiguous') {
        reply = buildReply(pathname, {
          status: 'clarify',
          message: buildOrderBlockerAnswer(summary),
          suggestions: summary.candidates.map(candidate =>
            `What is blocking order ${candidate.order_number?.trim() || candidate.order_id}?`
          ),
        });
        return NextResponse.json(reply);
      }

      if (summary.kind === 'not_found') {
        reply = buildReply(pathname, {
          status: 'unknown',
          message: buildOrderBlockerAnswer(summary),
        });
        return NextResponse.json(reply);
      }

      reply = buildReply(pathname, {
        status: 'answered',
        message: buildOrderBlockerAnswer(summary),
        card: buildOrderBlockerCard(summary),
        suggestions: [
          `What is blocking order ${summary.order.order_number?.trim() || summary.order.order_id}?`,
          'Which orders are late?',
          'Which items are below reorder level?',
        ],
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] order blocker summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the order blocker tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (manufacturingIntent === 'order_job_cards') {
    const assignmentFocus = isOrderJobCardAssignmentQuestion(normalized);
    const openOnlyFocus = isOutstandingOrderJobCardsQuestion(normalized) && !assignmentFocus;
    const selectedOrderRef =
      activeOrderManufacturingIntent === 'order_job_cards'
        ? getSelectedOrderReference(context)
        : null;
    const orderRef =
      modelRoute?.order_ref?.trim() ||
      extractManufacturingOrderReference(normalized) ||
      selectedOrderRef ||
      getActiveOrderReference(context, normalized, { allowJobCardLanguage: true });

    if (!orderRef || orderRef.length < 1) {
      reply = buildReply(pathname, {
        status: 'clarify',
        message:
          'I understood that as an order job-cards question, but I could not tell which order you meant. Rephrase it with an order number.',
      });
      return NextResponse.json(reply);
    }

    try {
      const summary = await getOrderManufacturingSummary(routeClient.supabase, orderRef);

      if (summary.kind === 'ambiguous') {
        reply = buildReply(pathname, {
          status: 'clarify',
          message: buildOrderJobCardsAnswer(summary, { assignmentFocus, openOnlyFocus }),
          suggestions: summary.candidates.map(candidate =>
            assignmentFocus
              ? `Have all the job cards been assigned for order ${candidate.order_number?.trim() || candidate.order_id}?`
              : openOnlyFocus
                ? `Do we have outstanding job cards for order ${candidate.order_number?.trim() || candidate.order_id}?`
              : `What job cards are on order ${candidate.order_number?.trim() || candidate.order_id}?`
          ),
        });
        return NextResponse.json(reply);
      }

      if (summary.kind === 'not_found') {
        reply = buildReply(pathname, {
          status: 'unknown',
          message: buildOrderJobCardsAnswer(summary, { assignmentFocus, openOnlyFocus }),
        });
        return NextResponse.json(reply);
      }

      const orderLabel = summary.order.order_number ?? String(summary.order.order_id);
      reply = buildReply(pathname, {
        status: 'answered',
        message: buildOrderJobCardsAnswer(summary, { assignmentFocus, openOnlyFocus }),
        card: buildOrderJobCardsCard(summary, { assignmentFocus, openOnlyFocus }),
        suggestions: assignmentFocus
          ? [
              `What job cards are on order ${orderLabel}?`,
              `What is blocking order ${orderLabel}?`,
              `Show production progress for order ${orderLabel}`,
            ]
          : openOnlyFocus
            ? [
                `Have all the job cards been assigned for order ${orderLabel}?`,
                `What job cards are on order ${orderLabel}?`,
                `What is blocking order ${orderLabel}?`,
              ]
          : [
              `What products are on order ${orderLabel}?`,
              `What is blocking order ${orderLabel}?`,
              `Show production progress for order ${orderLabel}`,
            ],
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] order job cards summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the order job-cards tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (manufacturingIntent === 'manufacturing_status') {
    const orderRef =
      modelRoute?.order_ref?.trim() ||
      extractManufacturingOrderReference(normalized) ||
      (/\border\b|\bpo[-\s]?\d/i.test(normalized) ? extractOrderReference(normalized) : null) ||
      getActiveOrderReference(context, normalized, { allowJobCardLanguage: true });
    const productRef =
      !orderRef ? modelRoute?.product_ref?.trim() || extractManufacturingProductReference(normalized) : null;

    if ((!orderRef || orderRef.length < 2) && (!productRef || productRef.length < 2)) {
      reply = buildReply(pathname, {
        status: 'clarify',
        message:
          'I understood that as a manufacturing question, but I could not tell which product or order you meant. Rephrase it with a product code, product name, or order number.',
      });
      return NextResponse.json(reply);
    }

    try {
      if (orderRef) {
        const summary = await getOrderManufacturingSummary(routeClient.supabase, orderRef);

        if (summary.kind === 'ambiguous') {
          reply = buildReply(pathname, {
            status: 'clarify',
            message: buildOrderManufacturingAnswer(summary),
            suggestions: summary.candidates.map(candidate =>
              `Has order ${candidate.order_number ?? candidate.order_id} been manufactured?`
            ),
          });
          return NextResponse.json(reply);
        }

        if (summary.kind === 'not_found') {
          reply = buildReply(pathname, {
            status: 'unknown',
            message: buildOrderManufacturingAnswer(summary),
          });
          return NextResponse.json(reply);
        }

        const orderLabel = summary.order.order_number ?? String(summary.order.order_id);
        reply = buildReply(pathname, {
          status: 'answered',
          message: buildOrderManufacturingAnswer(summary, { focus: manufacturingFocus }),
          card:
            manufacturingFocus === 'progress'
              ? buildManufacturingProgressCard(summary)
              : buildManufacturingStatusCard(summary, manufacturingFocus),
          suggestions: [
            `Has order ${orderLabel} been manufactured?`,
            `Who completed order ${orderLabel}?`,
            `When was order ${orderLabel} completed?`,
            `Show production progress for order ${orderLabel}`,
          ],
        });
        return NextResponse.json(reply);
      }

      const summary = await getManufacturingSummary(routeClient.supabase, productRef);

      if (summary.kind === 'ambiguous') {
        reply = buildReply(pathname, {
          status: 'clarify',
          message: buildManufacturingAnswer(summary),
          suggestions: summary.candidates.map(candidate =>
            `Has product ${candidate.internal_code ?? candidate.name ?? candidate.product_id} been manufactured?`
          ),
        });
        return NextResponse.json(reply);
      }

      if (summary.kind === 'not_found') {
        reply = buildReply(pathname, {
          status: 'unknown',
          message: buildManufacturingAnswer(summary),
        });
        return NextResponse.json(reply);
      }

      const productLabel = summary.product.internal_code ?? summary.product.name ?? String(summary.product.product_id);
      reply = buildReply(pathname, {
        status: 'answered',
        message: buildManufacturingAnswer(summary, { focus: manufacturingFocus }),
        card:
          manufacturingFocus === 'progress'
            ? buildManufacturingProgressCard(summary)
            : buildManufacturingStatusCard(summary, manufacturingFocus),
        suggestions: [
          `Has product ${productLabel} been manufactured?`,
          `Who manufactured ${productLabel}?`,
          `When was ${productLabel} completed?`,
          `Show production progress for ${productLabel}`,
        ],
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] manufacturing summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the manufacturing-status tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (manufacturingIntent === 'orders_in_production') {
    try {
      const summary = await getOrdersInProductionSummary(routeClient.supabase);
      reply = buildReply(pathname, {
        status: 'answered',
        message: buildManufacturingOrderListAnswer(summary),
        suggestions: [
          'Which orders finished this week?',
          ...(summary.orders[0]?.order_number
            ? [`Has order ${summary.orders[0].order_number} been manufactured?`]
            : []),
          'Which orders are late?',
        ],
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] orders in production summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the orders-in-production tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (manufacturingIntent === 'orders_completed_this_week') {
    try {
      const summary = await getOrdersCompletedThisWeekSummary(routeClient.supabase);
      reply = buildReply(pathname, {
        status: 'answered',
        message: buildManufacturingOrderListAnswer(summary),
        suggestions: [
          'Which orders are still in production?',
          ...(summary.orders[0]?.order_number
            ? [`Who completed order ${summary.orders[0].order_number}?`]
            : []),
          'Which orders are late?',
        ],
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] orders completed this week summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the completed-this-week production tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (manufacturingIntent === 'production_staffing') {
    try {
      const summary = await getProductionStaffingSummary(routeClient.supabase);
      reply = buildReply(pathname, {
        status: 'answered',
        message: buildManufacturingOrderListAnswer(summary),
        card: buildProductionStaffingCard(summary),
        suggestions: [
          'Which orders are still in production?',
          ...(summary.assignments[0]?.orders[0]?.order_number
            ? [`Show production progress for order ${summary.assignments[0].orders[0].order_number}`]
            : []),
          'Which orders finished this week?',
        ],
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] production staffing summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the production-staffing tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (manufacturingIntent === 'unassigned_production_work') {
    try {
      const summary = await getUnassignedProductionWorkSummary(routeClient.supabase);
      reply = buildReply(pathname, {
        status: 'answered',
        message: buildManufacturingOrderListAnswer(summary),
        card: buildUnassignedProductionWorkCard(summary),
        suggestions: [
          'Who is working on orders in production?',
          ...(summary.orders[0]?.order_number
            ? [`Show production progress for order ${summary.orders[0].order_number}`]
            : []),
          'Which orders are still in production?',
        ],
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] unassigned production work summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the unassigned-production-work tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (purchasingIntent === 'supplier_orders_for_item') {
    const componentRef = modelRoute?.component_ref?.trim() || extractPurchasingComponentReference(normalized);

    if (!componentRef || componentRef.length < 2) {
      reply = buildReply(pathname, {
        status: 'clarify',
        message:
          'I understood that as a purchasing question, but I could not tell which component you meant. Rephrase it with a component code or description.',
      });
      return NextResponse.json(reply);
    }

    try {
      const result = await getItemSupplierOrdersSummary(routeClient.supabase, componentRef);

      if (result.kind === 'summary') {
        const code = result.component.internal_code;
        reply = buildReply(pathname, {
          status: 'answered',
          message: buildSupplierOrdersAnswer(result),
          card: buildSupplierOrdersCard(result),
          suggestions: [
            `When is the next delivery for ${code}?`,
            `How much of ${code} do we have on order?`,
            `How much of ${code} do we have in stock?`,
          ],
        });
        return NextResponse.json(reply);
      }

      if (result.kind === 'ambiguous') {
        reply = buildReply(pathname, {
          status: 'clarify',
          message: buildSupplierOrdersAnswer(result),
          card: buildAssistantComponentClarifyCard(result.component_ref, result.candidates, {
            buildPrompt: internalCode => `Which supplier orders include ${internalCode}?`,
            primaryActionLabel: 'Check orders',
            description:
              'I found multiple component matches for this purchasing question. Pick one to see its supplier orders.',
          }),
          suggestions: result.candidates.map(
            candidate => `Which supplier orders include ${candidate.internal_code}?`
          ),
        });
        return NextResponse.json(reply);
      }

      reply = buildReply(pathname, {
        status: 'unknown',
        message: buildSupplierOrdersAnswer(result),
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] supplier orders by item failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the supplier-order lookup tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (purchasingIntent === 'next_delivery_for_item') {
    const componentRef = modelRoute?.component_ref?.trim() || extractPurchasingComponentReference(normalized);

    if (!componentRef || componentRef.length < 2) {
      reply = buildReply(pathname, {
        status: 'clarify',
        message:
          'I understood that as a next-delivery question, but I could not tell which component you meant. Rephrase it with a component code or description.',
      });
      return NextResponse.json(reply);
    }

    try {
      const result = await getItemNextDeliverySummary(routeClient.supabase, componentRef);

      if (result.kind === 'summary') {
        const code = result.component.internal_code;
        reply = buildReply(pathname, {
          status: 'answered',
          message: buildNextDeliveryAnswer(result),
          card: buildNextDeliveryCard(result),
          suggestions: [
            `Which supplier orders include ${code}?`,
            `How much of ${code} do we have on order?`,
            `How much of ${code} do we have in stock?`,
          ],
        });
        return NextResponse.json(reply);
      }

      if (result.kind === 'ambiguous') {
        reply = buildReply(pathname, {
          status: 'clarify',
          message: buildNextDeliveryAnswer(result),
          card: buildAssistantComponentClarifyCard(result.component_ref, result.candidates, {
            buildPrompt: internalCode => `When is the next delivery for ${internalCode}?`,
            primaryActionLabel: 'Check delivery',
            description:
              'I found multiple component matches for this delivery question. Pick one to see the verified ETA state.',
          }),
          suggestions: result.candidates.map(
            candidate => `When is the next delivery for ${candidate.internal_code}?`
          ),
        });
        return NextResponse.json(reply);
      }

      const componentCode =
        result.kind === 'not_found' ? null : result.component.internal_code;

      reply = buildReply(pathname, {
        status: result.kind === 'not_found' ? 'unknown' : 'answered',
        message: buildNextDeliveryAnswer(result),
        card: buildNextDeliveryCard(result),
        suggestions:
          componentCode == null
            ? undefined
            : [
                `Which supplier orders include ${componentCode}?`,
                `How much of ${componentCode} do we have on order?`,
                `How much of ${componentCode} do we have in stock?`,
              ],
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] next delivery by item failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the next-delivery lookup tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (purchasingIntent === 'supplier_orders_follow_up') {
    try {
      const summary = await getSupplierOrdersFollowUpSummary(routeClient.supabase);
      reply = buildReply(pathname, {
        status: 'answered',
        message: buildSupplierOrdersFollowUpAnswer(summary),
        card: buildSupplierOrdersFollowUpCard(summary),
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] supplier follow-up summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the supplier follow-up tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (purchasingIntent === 'late_supplier_orders') {
    try {
      const summary = await getLateSupplierOrdersSummary(routeClient.supabase);
      reply = buildReply(pathname, {
        status: summary.kind === 'no_eta_data' ? 'unknown' : 'answered',
        message: buildLateSupplierOrdersAnswer(summary),
        card: buildLateSupplierOrdersCard(summary),
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] late supplier orders summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the late supplier orders tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (demandIntent) {
    const componentRef = modelRoute?.component_ref?.trim() || extractDemandComponentReference(normalized);

    if (!componentRef || componentRef.length < 2) {
      reply = buildReply(pathname, {
        status: 'clarify',
        message:
          'I understood that as a component demand question, but I could not tell which component you meant. Rephrase it with a component code or description.',
      });
      return NextResponse.json(reply);
    }

    try {
      const result = await getItemDemandSummary(routeClient.supabase, componentRef);

      if (result.kind === 'summary') {
        const code = result.component.internal_code;
        reply = buildReply(pathname, {
          status: 'answered',
          message:
            demandIntent === 'orders_needing_item'
              ? buildOrdersNeedingItemAnswer(result)
              : buildDemandCoverageAnswer(result),
          suggestions: [
            `Which customer orders need ${code}?`,
            `Do we have enough ${code} for open demand?`,
            `How much of ${code} is reserved?`,
          ],
        });
        return NextResponse.json(reply);
      }

      if (result.kind === 'ambiguous') {
        reply = buildReply(pathname, {
          status: 'clarify',
          message:
            demandIntent === 'orders_needing_item'
              ? buildOrdersNeedingItemAnswer(result)
              : buildDemandCoverageAnswer(result),
          card: buildAssistantComponentClarifyCard(result.component_ref, result.candidates, {
            buildPrompt: internalCode =>
              demandIntent === 'orders_needing_item'
                ? `Which customer orders need ${internalCode}?`
                : `Do we have enough ${internalCode} for open demand?`,
            primaryActionLabel:
              demandIntent === 'orders_needing_item' ? 'Check demand' : 'Check coverage',
            description:
              demandIntent === 'orders_needing_item'
                ? 'I found multiple component matches. Pick one to see which orders need it.'
                : 'I found multiple component matches. Pick one to see whether open demand is covered.',
          }),
          suggestions: result.candidates.map(candidate =>
            demandIntent === 'orders_needing_item'
              ? `Which customer orders need ${candidate.internal_code}?`
              : `Do we have enough ${candidate.internal_code} for open demand?`
          ),
        });
        return NextResponse.json(reply);
      }

      const componentCode =
        result.kind === 'not_found' ? null : result.component.internal_code;
      reply = buildReply(pathname, {
        status: result.kind === 'not_found' ? 'unknown' : 'answered',
        message:
          demandIntent === 'orders_needing_item'
            ? buildOrdersNeedingItemAnswer(result)
            : buildDemandCoverageAnswer(result),
        suggestions:
          componentCode == null
            ? undefined
            : [
                `Which customer orders need ${componentCode}?`,
                `Do we have enough ${componentCode} for open demand?`,
                `How much of ${componentCode} is reserved?`,
              ],
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] item demand summary failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the component demand tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (inventoryIntent) {
    const extractedComponentRef = extractComponentReference(normalized);
    const modelComponentRef =
      modelRoute?.component_ref?.trim() || modelRoute?.product_ref?.trim() || '';
    const componentRef = shouldUseInventorySearchMode(extractedComponentRef)
      ? extractedComponentRef
      : modelComponentRef || extractedComponentRef;

    if (!componentRef || componentRef.length < 2) {
      reply = buildReply(pathname, {
        status: 'clarify',
        message:
          'I understood that as an inventory question, but I could not tell which component you meant. Rephrase it with a component code or description.',
      });
      return NextResponse.json(reply);
    }

    try {
      if (shouldUseInventorySearchMode(componentRef)) {
        const searchSummary = await getInventorySearchSummary(routeClient.supabase, componentRef);

        if (searchSummary && searchSummary.matches.length > 1) {
          reply = buildReply(pathname, {
            status: 'clarify',
            message: buildInventorySearchAnswer(searchSummary),
            card: buildInventorySearchCard(searchSummary, inventoryIntent),
            suggestions: searchSummary.matches
              .slice(0, 3)
              .map(match => buildInventoryClarifySuggestions([{ internal_code: match.internal_code }], inventoryIntent)[0]),
          });
          return NextResponse.json(reply);
        }
      }

      const result = await getInventoryItemSnapshot(routeClient.supabase, componentRef);

      if (result.kind === 'snapshot') {
        const code = result.snapshot.component.internal_code;
        reply = buildReply(pathname, {
          status: 'answered',
          message: buildInventoryAnswer(result.snapshot, inventoryIntent),
          card: buildInventoryCard(result.snapshot, inventoryIntent),
          suggestions: [
            `How much of ${code} do we have in stock?`,
            `How much of ${code} do we have on order?`,
            `How much of ${code} is reserved?`,
          ],
        });
        return NextResponse.json(reply);
      }

      if (result.kind === 'ambiguous') {
        reply = buildReply(pathname, {
          status: 'clarify',
          message: buildAssistantComponentClarifyAnswer(result.component_ref, result.candidates),
          card: buildAssistantComponentClarifyCard(result.component_ref, result.candidates, {
            buildPrompt: internalCode =>
              inventoryIntent === 'on_order'
                ? `How much of ${internalCode} do we have on order?`
                : inventoryIntent === 'reserved'
                  ? `How much of ${internalCode} is reserved?`
                  : `How much of ${internalCode} do we have in stock?`,
            primaryActionLabel:
              inventoryIntent === 'on_order'
                ? 'Check on order'
                : inventoryIntent === 'reserved'
                  ? 'Check reserved'
                  : 'Check stock',
            description:
              'I found multiple exact component matches for this inventory question. Pick one to continue.',
          }),
          suggestions: buildInventoryClarifySuggestions(result.candidates, inventoryIntent),
        });
        return NextResponse.json(reply);
      }

      reply = buildReply(pathname, {
        status: 'unknown',
        message: `I don't know. I couldn't find a component matching "${result.component_ref}" in Unity.`,
      });
      return NextResponse.json(reply);
    } catch (error) {
      console.error('[assistant] inventory snapshot failed', error);
      reply = buildReply(pathname, {
        status: 'unknown',
        message:
          'I don\'t know right now because the inventory snapshot tool failed. I am not going to guess.',
      });
      return NextResponse.json(reply);
    }
  } else if (erpDataPattern.test(normalized)) {
    reply = buildReply(pathname, {
      status: 'tool_pending',
      message:
        'I understand that as a Unity ERP data question, but the live data tools are not connected in this first cut yet, so I do not know the verified answer yet. This shell is intentionally refusing to guess.',
    });
  } else {
    reply = buildReply(pathname, {
      status: 'unknown',
      message:
        'I don\'t know. This prototype only supports Unity ERP operational questions, and it currently has no live tool to verify that request.',
    });
  }

  return NextResponse.json(reply);
}

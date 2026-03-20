import { z } from 'zod';

export const assistantModelRouteSchema = z.object({
  action: z.enum([
    'product_cost',
    'product_open_orders',
    'open_orders',
    'order_products',
    'last_customer_order',
    'recent_customer_orders',
    'order_search',
    'orders_last_7_days',
    'orders_due_this_week',
    'late_orders',
    'low_stock',
    'order_blockers',
    'manufacturing_status',
    'order_job_cards',
    'orders_in_production',
    'orders_completed_this_week',
    'production_staffing',
    'unassigned_production_work',
    'supplier_orders_for_item',
    'next_delivery_for_item',
    'supplier_orders_follow_up',
    'late_supplier_orders',
    'orders_needing_item',
    'demand_coverage',
    'inventory_snapshot',
    'help',
    'out_of_scope',
    'unknown',
  ]),
  inventory_intent: z.enum(['snapshot', 'on_hand', 'on_order', 'reserved']).nullable().optional(),
  component_ref: z.string().trim().max(160).nullable().optional(),
  order_ref: z.string().trim().max(120).nullable().optional(),
  customer_ref: z.string().trim().max(160).nullable().optional(),
  product_ref: z.string().trim().max(160).nullable().optional(),
  manufacturing_focus: z
    .enum(['status', 'who', 'when', 'in_production', 'progress'])
    .nullable()
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type AssistantModelRoute = z.infer<typeof assistantModelRouteSchema>;

export type AssistantModelRouterHistoryEntry = {
  role: 'assistant' | 'user';
  content: string;
  cardTitle?: string | null;
};

export type AssistantModelRouterContext = {
  activeOrder?: {
    orderId?: number;
    orderNumber?: string | null;
    customerName?: string | null;
  } | null;
} | null;

type AssistantModelRouterRequest = {
  message: string;
  history?: AssistantModelRouterHistoryEntry[];
  context?: AssistantModelRouterContext;
};

type AssistantModelProvider = 'openai' | 'openclaw';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENCLAW_RESPONSES_URL = 'http://127.0.0.1:18789/v1/responses';
const OPENAI_MODEL = process.env.OPENAI_ASSISTANT_MODEL?.trim() || 'gpt-5.4-mini';

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

function normalizeResponsesUrl(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  return normalized.endsWith('/v1/responses')
    ? normalized
    : `${trimTrailingSlashes(normalized)}/v1/responses`;
}

function getModelProvider(): AssistantModelProvider {
  return process.env.OPENAI_ASSISTANT_PROVIDER?.trim().toLowerCase() === 'openclaw'
    ? 'openclaw'
    : 'openai';
}

function getModelRouterConfig() {
  const provider = getModelProvider();
  const assistantBaseUrl = normalizeResponsesUrl(
    process.env.OPENAI_ASSISTANT_BASE_URL ?? process.env.OPENAI_ASSISTANT_RESPONSES_URL
  );
  const openClawBaseUrl = normalizeResponsesUrl(
    process.env.OPENCLAW_BASE_URL ?? process.env.OPENCLAW_RESPONSES_URL
  );
  const url =
    assistantBaseUrl ??
    (provider === 'openclaw' ? openClawBaseUrl ?? OPENCLAW_RESPONSES_URL : OPENAI_RESPONSES_URL);
  const apiKey =
    process.env.OPENAI_ASSISTANT_API_KEY?.trim() ||
    (provider === 'openclaw' ? process.env.OPENCLAW_API_KEY?.trim() : '') ||
    process.env.OPENAI_API_KEY?.trim() ||
    null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (provider === 'openclaw') {
    const agentId = process.env.OPENCLAW_AGENT_ID?.trim();
    const sessionKey = process.env.OPENCLAW_SESSION_KEY?.trim();

    if (agentId) {
      headers['x-openclaw-agent-id'] = agentId;
    }

    if (sessionKey) {
      headers['x-openclaw-session-key'] = sessionKey;
    }
  }

  return {
    provider,
    url,
    apiKey,
    headers,
    model: provider === 'openclaw' ? OPENAI_MODEL || 'openclaw' : OPENAI_MODEL,
  };
}
function buildRoutingInstructions() {
  return [
    'You are a request router for the Unity ERP assistant.',
    'Return only compact JSON on a single line.',
    'Do not answer the user. Do not invent business data.',
    'Choose exactly one action from the enum.',
    `Allowed action values: ${assistantModelRouteSchema.shape.action.options.join(', ')}.`,
    'Allowed inventory_intent values: snapshot, on_hand, on_order, reserved, or null.',
    'Your JSON must use exactly these keys: action, inventory_intent, component_ref, order_ref, customer_ref, product_ref, manufacturing_focus, confidence.',
    'Use null for missing refs.',
    'Allowed manufacturing_focus values: status, who, when, in_production, progress, or null.',
    'Use order_blockers for questions about whether an order has all components, what is blocking an order, whether components are available for an order, or whether an order is covered.',
    'Use manufacturing_status for questions about whether a product or order has been manufactured, who made it, when it was completed, or whether it is in production.',
    'When using manufacturing_status, set manufacturing_focus to status, who, when, in_production, or progress based on the user question.',
    'Questions about job cards owing, outstanding job cards, remaining job cards, or production left on an order should use manufacturing_status with manufacturing_focus set to progress.',
    'Use order_job_cards for questions that ask to show, list, or inspect the job cards attached to a specific order.',
    'Use order_job_cards for questions about whether the job cards on an order are assigned, unassigned, or still need issuing to staff.',
    'Use orders_in_production for list questions about which orders are still in production or currently being made.',
    'Use orders_completed_this_week for list questions about which orders finished or were completed this week.',
    'Use production_staffing for questions about who is working on orders in production, which staff are assigned to active production work, or who is currently making orders.',
    'Use unassigned_production_work for questions about unassigned production job cards, orders with unassigned work, or what needs assignment in production.',
    'Use product_cost for questions about the cost, costing, cost breakdown, or top cost drivers of a product.',
    'Use product_open_orders for questions about whether a manufactured product is currently on customer order, whether any customers have ordered a product, or which customer orders include a product.',
    'If the user is asking for orders for a named customer, keep it in the customer-order lane even if that name could also match a product or component.',
    'Examples of customer-order phrasing that should not become product_open_orders: "What are the latest orders for Qbutton?", "What are the current orders for Office Group?", "Are there any open orders for Typestar?".',
    'If the input includes selected-order context, follow-up phrases like "this order", "show me the products", "what job cards are open here?", or "what is blocking it?" should stay on that selected order unless the current message explicitly names another order or entity.',
    'Use order_products for questions about what products or items are on a specific customer order.',
    'Use open_orders when the user wants an open-order count, summary, or list, optionally for a specific customer, including phrasing like placed by, placed for, for, or from a customer.',
    'Use last_customer_order when the user asks for the last, latest, or most recent single order for a specific customer.',
    'Use recent_customer_orders when the user asks for the last, latest, or recent multiple orders for a specific customer, such as "last orders placed by OneLink".',
    'Use order_search when the user asks which orders start with, contain, or match a piece of order text or a partial order number. Put the search text in order_ref.',
    'Use orders_last_7_days for questions about orders created in the last week, past 7 days, or this week so far, including customer-scoped variants. Do not use last_customer_order for time-period questions like last week or past 7 days.',
    'Use orders_due_this_week for due-this-week order questions, including when they are scoped to a specific customer.',
    'Use late_orders for late or overdue order questions, including when they are scoped to a specific customer.',
    'Use inventory_snapshot for stock / on-hand / on-order / reserved item questions and set inventory_intent accordingly.',
    'For inventory questions, preserve the user\'s component wording in component_ref. Do not silently convert a broad family term like "gas spindle" into a specific internal code such as GTYPIST unless the user explicitly named that exact item.',
    'Use supplier_orders_for_item and next_delivery_for_item only when the user is asking about purchased components or supplier-stock items. Do not use those actions for manufactured finished products that customers order.',
    'Use orders_needing_item and demand_coverage for component demand questions.',
    'Use supplier_orders_follow_up and late_supplier_orders for purchasing-wide supplier questions.',
    'Use help for Unity workflow or documentation questions.',
    'Use out_of_scope for general world knowledge or non-Unity questions.',
    'Use unknown if the request does not clearly map to a supported action.',
    'If the user uses a shortened order number like 1841 instead of PO1841, keep the numeric reference as order_ref.',
    'If a customer name is present in any order-summary question, populate customer_ref.',
    'If a product is present in a product cost or product order question, populate product_ref.',
    'If a product is mentioned in a manufacturing question, populate product_ref.',
    'If an order is mentioned in a manufacturing question, populate order_ref.',
    'If an item or component is present, populate component_ref.',
  ].join(' ');
}

function toSingleLinePreview(value: string | null | undefined, maxLength = 220) {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildRoutingInput(request: AssistantModelRouterRequest) {
  const sections: string[] = [];
  const activeOrder = request.context?.activeOrder;
  const orderNumber = activeOrder?.orderNumber?.trim();
  const customerName = activeOrder?.customerName?.trim();

  if (orderNumber || activeOrder?.orderId) {
    sections.push(
      [
        'Selected order context:',
        orderNumber || `Order ${activeOrder?.orderId}`,
        customerName ? `for ${customerName}` : null,
        '- follow-up words like "this", "that", "here", or "selected order" may refer to this order.',
      ]
        .filter(Boolean)
        .join(' ')
    );
  }

  const recentHistory = (request.history ?? [])
    .slice(-6)
    .map(entry => {
      const preview = toSingleLinePreview(entry.content);
      const cardTitle = entry.cardTitle?.trim();
      const roleLabel = entry.role === 'user' ? 'User' : 'Assistant';

      return cardTitle && entry.role === 'assistant'
        ? `${roleLabel} (${cardTitle}): ${preview}`
        : `${roleLabel}: ${preview}`;
    })
    .filter(Boolean);

  if (recentHistory.length > 0) {
    sections.push(`Recent conversation:\n${recentHistory.join('\n')}`);
  }

  sections.push(`Current user message: ${request.message}`);
  return sections.join('\n\n');
}

function extractOutputText(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as {
    output_text?: unknown;
    output?: Array<{
      type?: unknown;
      content?: Array<{
        type?: unknown;
        text?: unknown;
      }>;
    }>;
  };

  if (typeof candidate.output_text === 'string' && candidate.output_text.trim()) {
    return candidate.output_text.trim();
  }

  if (Array.isArray(candidate.output)) {
    for (const item of candidate.output) {
      if (item?.type !== 'message' || !Array.isArray(item.content)) {
        continue;
      }

      for (const content of item.content) {
        if (content?.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) {
          return content.text.trim();
        }
      }
    }
  }

  return null;
}

function parseModelRoute(outputText: string) {
  try {
    const parsedJson = JSON.parse(outputText);
    const parsed = assistantModelRouteSchema.safeParse(parsedJson);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function classifyAssistantRequestWithModel(
  request: AssistantModelRouterRequest
): Promise<AssistantModelRoute | null> {
  const config = getModelRouterConfig();
  const apiKey = config.apiKey;
  if (!apiKey) {
    return null;
  }

  const response = await fetch(config.url, {
    method: 'POST',
    headers: config.headers,
    body: JSON.stringify({
      model: config.model,
      instructions: buildRoutingInstructions(),
      input: buildRoutingInput(request),
      max_output_tokens: 220,
      reasoning: {
        effort: 'low',
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Model routing request failed (${response.status}): ${errorText.slice(0, 240)}`);
  }

  const payload = await response.json().catch(() => null);
  const outputText = extractOutputText(payload);
  if (!outputText) {
    return null;
  }

  return parseModelRoute(outputText);
}

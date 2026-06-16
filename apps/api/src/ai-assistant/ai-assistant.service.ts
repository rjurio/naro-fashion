import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are an admin assistant for Naro Fashion, a fashion + bridal SaaS for the Tanzania market (TZS currency, EN+SW, multi-tenant).

You help tenant admins manage their store via 22 controlled API tools. You NEVER access the database directly, NEVER scrape the admin UI, and NEVER reveal raw API responses verbatim — you summarise them in plain language.

CAPABILITIES
- Read: products, categories, product sizes, orders, rentals, inventory, low-stock, rental policies, size guides, recycle bin, reports (sales / rental / inventory summary, popular products, pending orders, overdue rentals).
- Draft writes (no approval needed): create_product_draft, add_order_note, create_size_guide_entry, create_size.

OUT OF SCOPE — politely refuse and point at the admin UI:
- publish/archive/restore/update product (approval-gated; needs four-eyes flow in the admin UI)
- order or rental status transitions
- inventory adjustments
- refunds / payment changes
- admin user / role / permission management
- permanent delete
- customer-facing storefront mutations

RESPONSE STYLE
- Be concise. Lead with the result, then the next step.
- Use markdown tables for lists; bullets for details; plain prose for status.
- Format prices as "TSh 350,000" (Tanzania style). Use "region" not "state".
- For drafts created, confirm with the new id, name, and a one-line next step (e.g. "Pricing, images, and variants — finish in the admin UI at /dashboard/products/<id>/edit").
- On errors: explain in plain English what went wrong and what to fix. Don't retry blindly.
- Never reveal: JWT contents, env vars, internal IDs unless asked, other tenants' data.

When the tenant asks a question the tools can't answer, say so clearly and suggest the admin UI route.`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  reply: string;
  toolCalls: Array<{ tool: string; input: any; ok: boolean; error?: string }>;
  iterations: number;
  inputTokens: number;
  outputTokens: number;
}

// 22-tool registry. Each entry maps an Anthropic tool definition to the
// /api/v1/ai/* endpoint that backs it. The `run` function is called with
// the operator's bearer token + tenant id; it fetches the endpoint and
// returns whatever JSON the server gave us (or an error envelope).
//
// We deliberately leave out approval-gated tools (publish/archive/restore/
// update_draft) — those need a different admin to approve via the in-admin
// dashboard. The chat assistant tells the operator to do those there.
interface ToolDef {
  name: string;
  description: string;
  input_schema: any;
  buildUrl: (input: any) => string;
  method?: 'GET' | 'POST';
  body?: (input: any) => any;
}

const API_BASE = process.env.AI_ASSISTANT_API_BASE || 'http://localhost:4000/api/v1';

/**
 * Defence-in-depth URL guard: resolves the path returned by a tool's
 * `buildUrl` against `API_BASE`, parses through WHATWG `URL` so any `..`
 * segments are normalised, and asserts the resolved URL stays inside
 * `/api/v1/ai/` on the same origin.
 *
 * If a tool ever interpolates an attacker-controlled value like
 * `../../admin-users`, Node's `fetch` would happily resolve the result to a
 * non-AI endpoint with the operator's bearer token. This guard throws before
 * the request goes out.
 *
 * Exported for unit testing; see `ai-assistant-url-guard.spec.ts`.
 */
export function assertAiUrlSafe(
  toolPath: string,
  apiBase: string,
  toolName: string,
): URL {
  const url = `${apiBase}${toolPath}`;
  let resolved: URL;
  try {
    resolved = new URL(url);
  } catch {
    throw new Error(`${toolName}: invalid URL`);
  }
  const expectedBase = new URL(apiBase);
  if (
    resolved.origin !== expectedBase.origin ||
    !resolved.pathname.startsWith('/api/v1/ai/')
  ) {
    throw new Error(`${toolName}: blocked non-AI URL ${resolved.pathname}`);
  }
  return resolved;
}

const TOOLS: ToolDef[] = [
  // ---- READ TOOLS (17) ----
  {
    name: 'search_products',
    description: 'Search products by name, SKU, or filter by category/availability/status. Returns paginated list with id, name, sku, basePrice, isActive, category.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term for name or SKU' },
        availabilityMode: { type: 'string', enum: ['PURCHASE_ONLY', 'RENTAL_ONLY', 'BOTH'] },
        isActive: { type: 'boolean', description: 'Filter by active status' },
        limit: { type: 'number', description: 'Max results (default 20, max 100)' },
        page: { type: 'number', description: 'Page number (1-based)' },
      },
    },
    buildUrl: (input) => {
      const q = new URLSearchParams();
      if (input.search) q.set('search', input.search);
      if (input.availabilityMode) q.set('availabilityMode', input.availabilityMode);
      if (typeof input.isActive === 'boolean') q.set('isActive', String(input.isActive));
      if (input.limit) q.set('limit', String(input.limit));
      if (input.page) q.set('page', String(input.page));
      const qs = q.toString();
      return `/ai/products${qs ? '?' + qs : ''}`;
    },
  },
  {
    name: 'get_product',
    description: 'Fetch full details of a single product by id — variants, images, category, pricing, rental settings, 3D model.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Product id (cm...)' } },
      required: ['id'],
    },
    buildUrl: (input) => `/ai/products/${encodeURIComponent(input.id)}`,
  },
  {
    name: 'list_categories',
    description: 'List all categories as a nested tree (parent + children + grandchildren). Use to find categoryId for new products.',
    input_schema: { type: 'object', properties: {} },
    buildUrl: () => '/ai/categories',
  },
  {
    name: 'list_product_sizes',
    description: 'List the centrally-managed size labels (e.g. S/M/L, EU/US sizing) available for products.',
    input_schema: { type: 'object', properties: {} },
    buildUrl: () => '/ai/product-sizes',
  },
  {
    name: 'list_orders',
    description: 'List orders. Filter by status, date range, or search by order number/customer. Returns paginated list.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'],
        },
        search: { type: 'string' },
        from: { type: 'string', description: 'ISO date (YYYY-MM-DD)' },
        to: { type: 'string', description: 'ISO date (YYYY-MM-DD)' },
        limit: { type: 'number' },
        page: { type: 'number' },
      },
    },
    buildUrl: (input) => {
      const q = new URLSearchParams();
      for (const k of ['status', 'search', 'from', 'to', 'limit', 'page'] as const) {
        if (input[k] !== undefined) q.set(k, String(input[k]));
      }
      const qs = q.toString();
      return `/ai/orders${qs ? '?' + qs : ''}`;
    },
  },
  {
    name: 'get_order',
    description: 'Fetch one order in full — items, customer, shipping address, payments, shipment, invoice.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    buildUrl: (input) => `/ai/orders/${encodeURIComponent(input.id)}`,
  },
  {
    name: 'list_rentals',
    description: 'List rental orders. Filter by status (PENDING_ID_VERIFICATION through CLOSED) and date range.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        limit: { type: 'number' },
        page: { type: 'number' },
      },
    },
    buildUrl: (input) => {
      const q = new URLSearchParams();
      for (const k of ['status', 'from', 'to', 'limit', 'page'] as const) {
        if (input[k] !== undefined) q.set(k, String(input[k]));
      }
      const qs = q.toString();
      return `/ai/rentals${qs ? '?' + qs : ''}`;
    },
  },
  {
    name: 'get_rental',
    description: 'Fetch one rental — checklists, wedding details, transport receipt, customer ID verification status.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    buildUrl: (input) => `/ai/rentals/${encodeURIComponent(input.id)}`,
  },
  {
    name: 'get_inventory',
    description: 'Inventory snapshot across products. Use status=low to filter to items at or below minimumStock.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        status: { type: 'string', enum: ['low', 'all'] },
      },
    },
    buildUrl: (input) => {
      const q = new URLSearchParams();
      if (input.search) q.set('search', input.search);
      if (input.status) q.set('status', input.status);
      const qs = q.toString();
      return `/ai/inventory${qs ? '?' + qs : ''}`;
    },
  },
  {
    name: 'low_stock_report',
    description: 'Products at or below their minimumStock threshold. Module-gated by inventory.',
    input_schema: { type: 'object', properties: {} },
    buildUrl: () => '/ai/inventory/low-stock',
  },
  {
    name: 'get_rental_policies',
    description: 'Tenant rental policy: buffer days between rentals, late fee, max duration, down payment %.',
    input_schema: { type: 'object', properties: {} },
    buildUrl: () => '/ai/rental-policies',
  },
  {
    name: 'list_size_guides',
    description: 'List all size guides (including drafts) — markdown content, EN+SW.',
    input_schema: { type: 'object', properties: {} },
    buildUrl: () => '/ai/size-guide',
  },
  {
    name: 'list_recycle_bin',
    description: 'List soft-deleted entities. Pick which type to inspect.',
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: ['Product', 'Category', 'ProductSize', 'SizeGuide'] },
      },
      required: ['entity'],
    },
    buildUrl: (input) => `/ai/recycle-bin?entity=${encodeURIComponent(input.entity)}`,
  },
  {
    name: 'report_sales_summary',
    description: 'Sales summary report — revenue, order count, AOV — over a date range.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'ISO date (YYYY-MM-DD)' },
        to: { type: 'string' },
      },
    },
    buildUrl: (input) => {
      const q = new URLSearchParams();
      if (input.from) q.set('from', input.from);
      if (input.to) q.set('to', input.to);
      const qs = q.toString();
      return `/ai/reports/sales-summary${qs ? '?' + qs : ''}`;
    },
  },
  {
    name: 'report_rental_summary',
    description: 'Rental summary — active, returned, overdue counts + rental revenue.',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
    },
    buildUrl: (input) => {
      const q = new URLSearchParams();
      if (input.from) q.set('from', input.from);
      if (input.to) q.set('to', input.to);
      const qs = q.toString();
      return `/ai/reports/rental-summary${qs ? '?' + qs : ''}`;
    },
  },
  {
    name: 'report_popular_products',
    description: 'Top products by units sold over a date range.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    buildUrl: (input) => {
      const q = new URLSearchParams();
      for (const k of ['from', 'to', 'limit'] as const) {
        if (input[k] !== undefined) q.set(k, String(input[k]));
      }
      const qs = q.toString();
      return `/ai/reports/popular-products${qs ? '?' + qs : ''}`;
    },
  },
  {
    name: 'report_pending_orders',
    description: 'Orders stuck in PENDING for more than 24 hours.',
    input_schema: { type: 'object', properties: {} },
    buildUrl: () => '/ai/reports/pending-orders',
  },
  {
    name: 'report_overdue_rentals',
    description: 'Active rentals past their returnDate that have not yet been marked RETURNED.',
    input_schema: { type: 'object', properties: {} },
    buildUrl: () => '/ai/reports/overdue-rentals',
  },

  // ---- DRAFT WRITE TOOLS (4) — no approval required ----
  {
    name: 'create_product_draft',
    description: 'Create a draft product. Server forces price:0 and isActive:false — operator finishes pricing/images/variants in the admin UI. Required: name, description, categoryId.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        nameSwahili: { type: 'string' },
        description: { type: 'string' },
        descriptionSwahili: { type: 'string' },
        categoryId: { type: 'string', description: 'Get from list_categories' },
        availabilityMode: { type: 'string', enum: ['PURCHASE_ONLY', 'RENTAL_ONLY', 'BOTH'] },
      },
      required: ['name', 'description', 'categoryId'],
    },
    method: 'POST',
    body: (input) => input,
    buildUrl: () => '/ai/products/draft',
  },
  {
    name: 'add_order_note',
    description: 'Append a free-text note to an order. Auto-prefixed with [timestamp — Admin Name]. Non-destructive.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Order id' },
        note: { type: 'string', description: 'Note text' },
      },
      required: ['id', 'note'],
    },
    method: 'POST',
    body: (input) => ({ note: input.note }),
    buildUrl: (input) => `/ai/orders/${encodeURIComponent(input.id)}/notes`,
  },
  {
    name: 'create_size_guide_entry',
    description: 'Create a new size guide as a draft. Server forces isActive:false, isDefault:false — operator publishes via admin UI.',
    input_schema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        name: { type: 'string' },
        nameSwahili: { type: 'string' },
        content: { type: 'string', description: 'Markdown content' },
        contentSwahili: { type: 'string' },
      },
      required: ['slug', 'name', 'content'],
    },
    method: 'POST',
    body: (input) => input,
    buildUrl: () => '/ai/size-guide',
  },
  {
    name: 'create_size',
    description: 'Create a new size label (e.g. "XS", "EU 38"). Centrally managed and reusable across products.',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Display label (e.g. "Medium")' },
        sortOrder: { type: 'number' },
      },
      required: ['label'],
    },
    method: 'POST',
    body: (input) => input,
    buildUrl: () => '/ai/product-sizes',
  },
];

const MAX_ITERATIONS = 10; // hard cap to prevent runaway tool-use loops

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);
  private readonly client: Anthropic | null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — AI assistant endpoint will return 503 until configured.',
      );
      this.client = null;
    } else {
      this.client = new Anthropic({ apiKey });
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async chat(
    messages: ChatMessage[],
    bearerToken: string,
    tenantId: string,
  ): Promise<ChatResponse> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'AI assistant is not configured on this server. Set ANTHROPIC_API_KEY in the API .env and restart.',
      );
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new BadRequestException('messages must be a non-empty array');
    }

    const toolCallsLog: ChatResponse['toolCalls'] = [];
    let iterations = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    // Build the Anthropic-format tool definitions once.
    const anthropicTools = TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));

    // Convert chat history to Anthropic message format.
    const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await this.client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' } as any,
        system: SYSTEM_PROMPT,
        tools: anthropicTools,
        messages: apiMessages,
      });

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;

      // Always append the assistant turn — required by the API on the next request.
      apiMessages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        const reply = response.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n')
          .trim();
        return { reply, toolCalls: toolCallsLog, iterations, inputTokens, outputTokens };
      }

      if (response.stop_reason !== 'tool_use') {
        // refusal, max_tokens, etc. — return whatever text we have.
        const reply = response.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n')
          .trim();
        return {
          reply: reply || `(Stopped: ${response.stop_reason})`,
          toolCalls: toolCallsLog,
          iterations,
          inputTokens,
          outputTokens,
        };
      }

      // Execute each tool_use block and collect results.
      const toolUseBlocks = response.content.filter(
        (b: any) => b.type === 'tool_use',
      ) as Anthropic.ToolUseBlock[];

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const toolDef = TOOLS.find((t) => t.name === block.name);
        if (!toolDef) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Unknown tool: ${block.name}`,
            is_error: true,
          });
          toolCallsLog.push({
            tool: block.name,
            input: block.input,
            ok: false,
            error: 'unknown_tool',
          });
          continue;
        }

        try {
          const result = await this.callApiTool(
            toolDef,
            block.input,
            bearerToken,
            tenantId,
          );
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result).substring(0, 32_000), // bound size
          });
          toolCallsLog.push({ tool: block.name, input: block.input, ok: true });
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Tool call failed: ${errMsg}`,
            is_error: true,
          });
          toolCallsLog.push({
            tool: block.name,
            input: block.input,
            ok: false,
            error: errMsg,
          });
        }
      }

      apiMessages.push({ role: 'user', content: toolResults });
    }

    // Hit iteration cap — return what we have.
    return {
      reply:
        '(Tool-use loop exceeded maximum iterations. The agent was still working when stopped — try asking a more specific question or break the task into smaller steps.)',
      toolCalls: toolCallsLog,
      iterations,
      inputTokens,
      outputTokens,
    };
  }

  private async callApiTool(
    tool: ToolDef,
    input: any,
    bearerToken: string,
    tenantId: string,
  ): Promise<any> {
    const resolved = assertAiUrlSafe(tool.buildUrl(input), API_BASE, tool.name);

    const method = tool.method || 'GET';
    const headers: Record<string, string> = {
      Authorization: `Bearer ${bearerToken}`,
      'X-Tenant-Id': tenantId,
    };
    let body: string | undefined;
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(tool.body ? tool.body(input) : input);
    }

    const resp = await fetch(resolved.toString(), { method, headers, body });
    const text = await resp.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    if (!resp.ok) {
      const msg =
        parsed?.error?.message || parsed?.message || `HTTP ${resp.status}`;
      throw new Error(`${tool.name}: ${msg}`);
    }
    return parsed;
  }
}

# Naro Fashion — AI Agent Tool Definitions

These are the controlled backend tools the Naro Fashion Admin Agent calls. Every tool is exposed under `/api/v1/ai/<group>/<tool>` (planned), runs through `JwtAuthGuard → AdminGuard → TenantInterceptor → permission check → existing service → AuditService → AgentAuditLog`, and returns structured JSON.

> **Status legend**
> - **EXISTS** — the underlying logic is already in `apps/api/src/<module>` and the AI tool just needs a thin `/ai/*` route + permission/audit wiring.
> - **NEW** — needs new service code (small).
> - **MODULE-GATED** — requires `@RequiresModule('<code>')`. Tenants without the module enabled get 403.

> **Common conventions**
> - Auth: `Authorization: Bearer <admin JWT>` mandatory. The agent forwards the operator's token; the agent never holds a token of its own.
> - Tenant: derived from JWT — never sent as a body field.
> - Approval: tools marked `Approval: yes` require `approvalToken` in the request body (see `APPROVAL_WORKFLOW.md`).
> - Validation: class-validator DTOs with `whitelist: true, forbidNonWhitelisted: true` — extra fields = `400`.
> - Errors: NestJS standard `{ statusCode, message, error }`.
> - Pagination: `page` (default 1), `limit` (default 20, max 100). Response: `{ data, meta: { page, limit, total, totalPages } }`.

---

## Permissions used (already seeded in `apps/api/src/permissions/permissions.service.ts`)

The agent inherits whatever permissions the operator's `AdminUser` has via `AdminUserRole → Role → RolePermission`. Tools below name the required permission code.

`products:view`, `products:create`, `products:update`, `products:delete`, `products:manage-inventory`,
`categories:view|create|update|delete`,
`orders:view|update-status|cancel|refund`,
`rentals:view|update-status|manage-checklist`,
`inventory:view|manage`,
`reports:view|export`,
`audit:view`.

Permissions that don't yet exist but the agent needs (Phase 1 work — add to the seed list):
`product-sizes:view|create|update|delete`,
`size-guides:view|update`,
`rental-policies:view|update`,
`recycle-bin:list|restore|permanent-delete`.

---

## Products

### `search_products`
**Status:** EXISTS (wraps `GET /products?search=`)
**Permission:** `products:view`
**Approval:** no
**Endpoint:** `GET /api/v1/ai/products/search`

```ts
type Input = {
  q?: string;                   // free-text on name/sku
  categoryId?: string;
  categorySlug?: string;
  availabilityMode?: 'PURCHASE_ONLY' | 'RENTAL_ONLY' | 'BOTH';
  isActive?: boolean;
  includeDeleted?: boolean;     // requires recycle-bin:list
  page?: number;
  limit?: number;               // max 100
  sortBy?: 'createdAt' | 'name' | 'basePrice';
  sortDir?: 'asc' | 'desc';
};
type Output = {
  data: Array<{
    id: string; name: string; slug: string; sku: string | null;
    basePrice: string; compareAtPrice: string | null;
    availabilityMode: string; isActive: boolean;
    primaryImageUrl: string | null;
    categoryName: string;
    variantCount: number;
    deletedAt: string | null;
  }>;
  meta: { page: number; limit: number; total: number; totalPages: number };
};
```
**Errors:** `400` invalid query, `403` missing `products:view`.

### `get_product`
**Status:** EXISTS (wraps `GET /products/by-id/:id`)
**Permission:** `products:view`
**Approval:** no
**Endpoint:** `GET /api/v1/ai/products/:id`

Returns the full product including variants, images, videos, sizeGuide ref, rental fields, and inventory snapshot.

### `create_product_draft`
**Status:** EXISTS (wraps `POST /products` — but agent route forces `isActive: false`)
**Permission:** `products:create`
**Approval:** no (drafts only)
**Endpoint:** `POST /api/v1/ai/products/draft`

```ts
type Input = {
  name: string;                                 // required
  nameSwahili?: string;
  slug?: string;                                // auto-generated if absent
  description?: string;
  descriptionSwahili?: string;
  categoryId: string;                           // required
  availabilityMode: 'PURCHASE_ONLY' | 'RENTAL_ONLY' | 'BOTH';   // required
  basePrice: number;                            // required, > 0
  compareAtPrice?: number;
  sku?: string;
  // Rental fields — required when availabilityMode is RENTAL_ONLY or BOTH:
  rentalPricePerDay?: number;                   // flat rental price
  latePenaltyPercent?: number;                  // default 10
  rentalDepositAmount?: number;
  rentalDownPaymentPct?: number;                // default 25
  minRentalDays?: number;
  maxRentalDays?: number;
  bufferDaysOverride?: number;
  // Inventory fields:
  purchasePrice?: number;
  minimumStock?: number;                        // default 5
  supplierName?: string;
  supplierContact?: string;
  // Optional 3D model:
  model3dUrl?: string;
  model3dPosterUrl?: string;
};
type Output = {
  id: string; slug: string; isActive: false;    // always false from this tool
  name: string; basePrice: string; categoryId: string;
};
```
**Validation:** unique `(tenantId, slug)` and `(tenantId, sku)`. P2002 → `409 Conflict`.
**Errors:** `400` missing required fields / invalid enum, `403`, `404` categoryId not found, `409` slug/sku collision.

### `update_product`
**Status:** EXISTS (wraps `PATCH /products/:id`) — agent route blocks pricing changes unless approval is supplied
**Permission:** `products:update`
**Approval:** **yes if** `basePrice | compareAtPrice | rentalPricePerDay | rentalDepositAmount | rentalDownPaymentPct | latePenaltyPercent` change. No otherwise.
**Endpoint:** `PATCH /api/v1/ai/products/:id`

Same body shape as `create_product_draft` but every field optional. Cannot set `isActive` here — use `publish_product` / `archive_product`.

### `publish_product`
**Status:** NEW route (agent-only) wrapping `PATCH /products/:id/toggle-active`
**Permission:** `products:update`
**Approval:** **yes**
**Endpoint:** `POST /api/v1/ai/products/:id/publish`
```ts
type Input  = { approvalToken: string };
type Output = { id: string; isActive: true };
```
Pre-flight: product must have ≥ 1 variant with `stock > 0` AND ≥ 1 primary image.

### `archive_product`
**Status:** EXISTS (wraps `DELETE /products/:id` — soft delete)
**Permission:** `products:delete`
**Approval:** **yes**
**Endpoint:** `POST /api/v1/ai/products/:id/archive`
```ts
type Input  = { approvalToken: string };
type Output = { id: string; deletedAt: string };
```

### `delete_product` (permanent)
**Status:** EXISTS (wraps `DELETE /products/:id/permanent`)
**Permission:** `products:delete` + `recycle-bin:permanent-delete`
**Approval:** **yes — fresh token, 60s TTL, no caching**
**Endpoint:** `POST /api/v1/ai/products/:id/permanent-delete`

### `restore_product`
**Status:** EXISTS (wraps `PATCH /products/:id/restore`)
**Permission:** `recycle-bin:restore`
**Approval:** **yes**
**Endpoint:** `POST /api/v1/ai/products/:id/restore`

---

## Categories

### `list_categories`
**Status:** EXISTS (wraps `GET /categories` — public route, but the AI tool routes through the admin guard)
**Permission:** `categories:view`
**Approval:** no
**Endpoint:** `GET /api/v1/ai/categories`

Returns the 3-level nested tree with `_count.products`, `fallbackImageUrl`, `totalProductCount` per node.

### `create_category`
**Status:** EXISTS (wraps `POST /categories`)
**Permission:** `categories:create`
**Approval:** no
**Endpoint:** `POST /api/v1/ai/categories`

```ts
type Input = {
  name: string;
  nameSwahili?: string;
  slug?: string;             // auto-generated if absent
  description?: string;
  parentId?: string | null;  // null = root
  imageUrl?: string;
  sizeGuideId?: string | null;
  sortOrder?: number;
};
```

### `update_category`
**Status:** EXISTS (wraps `PATCH /categories/:id`)
**Permission:** `categories:update`
**Approval:** no
**Endpoint:** `PATCH /api/v1/ai/categories/:id`

### `delete_category` (soft)
**Status:** EXISTS (wraps `DELETE /categories/:id`)
**Permission:** `categories:delete`
**Approval:** **yes**
Pre-flight: refuse if `_count.products > 0` unless `force: true` is supplied AND a fresh approval token is provided. Even then, soft-delete only.

### `restore_category`
**Status:** EXISTS (wraps `PATCH /categories/:id/restore`)
**Permission:** `recycle-bin:restore`
**Approval:** **yes**

---

## Product sizes (`ProductSize` model)

### `list_sizes`
**Status:** EXISTS (wraps `GET /product-sizes`)
**Permission:** `product-sizes:view` (NEW — add to seed)
**Approval:** no

### `create_size`
**Status:** EXISTS (wraps `POST /product-sizes`)
**Permission:** `product-sizes:create`
**Approval:** no
```ts
type Input = { name: string; description?: string; category?: string; sortOrder?: number };
```
**Validation:** `(tenantId, name)` unique → 409 on collision.

### `update_size`, `delete_size` (soft), `restore_size`
**Status:** EXISTS for the first two (`PATCH /product-sizes/:id`, `DELETE /product-sizes/:id`).
**Permission:** `product-sizes:update | delete`
**Approval:** delete = **yes**

---

## Orders

### `list_orders`
**Status:** EXISTS (wraps `GET /orders/admin`)
**Permission:** `orders:view`
**Approval:** no
**Endpoint:** `GET /api/v1/ai/orders`
```ts
type Input = {
  search?: string;
  status?: 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  startDate?: string; endDate?: string;
  page?: number; limit?: number;
};
```

### `get_order`
**Status:** EXISTS (wraps `GET /orders/:id`)
**Permission:** `orders:view`
**Approval:** no

### `update_order_status`
**Status:** EXISTS (wraps `PATCH /orders/:id/status` — but only admins may change to anything other than CANCELLED, already enforced)
**Permission:** `orders:update-status` (and `orders:cancel` for `CANCELLED`)
**Approval:** **yes**
**Endpoint:** `POST /api/v1/ai/orders/:id/status`
```ts
type Input  = { status: OrderStatus; approvalToken: string };
type Output = { id: string; status: OrderStatus; updatedAt: string };
```
**Validation:** the existing transition matrix in `orders.service.ts:updateStatus` is enforced — agent cannot bypass.

### `add_order_note`
**Status:** NEW (small — service method that updates `Order.notes` with append semantics)
**Permission:** `orders:view`
**Approval:** no
**Endpoint:** `POST /api/v1/ai/orders/:id/notes`
```ts
type Input  = { note: string };  // appended with timestamp + adminUser
type Output = { id: string; notes: string };
```

---

## Rentals (MODULE-GATED: `@RequiresModule('rentals')`)

### `list_rentals`
**Status:** EXISTS (wraps `GET /rentals/admin`)
**Permission:** `rentals:view`

### `get_rental`
**Status:** EXISTS (wraps `GET /rentals/:id`)
**Permission:** `rentals:view`

### `get_rental_availability`
**Status:** EXISTS (wraps `GET /rentals/availability/:productId?startDate=&endDate=`)
**Permission:** `rentals:view`
**Approval:** no

### `create_rental`
**Status:** EXISTS (wraps `POST /rentals` — current route accepts customer-issued requests; the AI route reuses the service but supplies `userId` from input rather than the JWT)
**Permission:** `rentals:view` (creating-on-behalf-of-customer is admin-only via the AI tool layer)
**Approval:** no (drafts allowed; status is initialised to `PENDING_ID_VERIFICATION` or `ID_VERIFIED` depending on customer KYC)
**Endpoint:** `POST /api/v1/ai/rentals`
```ts
type Input = {
  userId: string;                       // customer
  productId: string; variantId: string;
  startDate: string; returnDate: string; pickupDate: string; pickupTime?: string;
  weddingDate?: string; weddingLocation?: string; weddingRegion?: string;
  deliveryModality?: 'HAND_PICKED' | 'SHIPPED';
  shippingDate?: string; shippingAddress?: string;
  transportMode?: 'AIR' | 'BUS' | 'TRAIN' | 'COURIER' | 'OTHER';
  notes?: string;
};
```
**Pre-flight:** customer must have name/phone/email/address; product `availabilityMode` ∈ {`RENTAL_ONLY`, `BOTH`}; `get_rental_availability` returns `available: true` (respects buffer); `maxRentalDurationDays` not exceeded.

### `update_rental_status`
**Status:** EXISTS (wraps `PATCH /rentals/:id/status` — already admin-only after PR-1)
**Permission:** `rentals:update-status`
**Approval:** **yes**

### `update_rental_checklist`
**Status:** EXISTS (rental-checklists module — wraps the per-rental check/uncheck endpoint)
**Permission:** `rentals:manage-checklist`
**Approval:** no (item-level toggles are reversible)

### `mark_rental_returned`
**Status:** EXISTS (special case of `update_rental_status` to `RETURNED` — late-fee math runs)
**Permission:** `rentals:update-status`
**Approval:** **yes**
**Endpoint:** `POST /api/v1/ai/rentals/:id/return`
```ts
type Input = { approvalToken: string; actualReturnDate?: string };
type Output = { id: string; status: 'RETURNED'; lateFee: string; daysLate: number };
```

### `record_rental_damage`
**Status:** NEW (small — adds a `RentalDamage` row + optional inventory `DAMAGE` transaction; out of scope for Phase 1, scaffold in Phase 4)
**Permission:** `rentals:update-status` + `inventory:manage`
**Approval:** **yes**
```ts
type Input = {
  rentalId: string;
  severity: 'MINOR' | 'MODERATE' | 'SEVERE' | 'LOST';
  notes: string;
  deductFromDeposit?: boolean;
  deductAmount?: number;
  approvalToken: string;
};
```

---

## Inventory (MODULE-GATED: `@RequiresModule('inventory')`)

### `get_inventory`
**Status:** EXISTS (wraps `GET /inventory`)
**Permission:** `inventory:view`
**Approval:** no
```ts
type Input = { status?: 'low' | 'out' | 'all'; search?: string };
```

### `low_stock_report`
**Status:** EXISTS (wraps `GET /inventory/low-stock`)
**Permission:** `inventory:view`
**Approval:** no

### `inventory_summary` / `valuation`
**Status:** EXISTS (wraps `GET /inventory/valuation`)
**Permission:** `inventory:view`
**Approval:** no

### `adjust_inventory`
**Status:** EXISTS (wraps `POST /inventory/adjust`)
**Permission:** `inventory:manage`
**Approval:** **yes**
**Endpoint:** `POST /api/v1/ai/inventory/adjust`
```ts
type Input = {
  productId: string;
  variantId: string;
  delta: number;                           // can be negative
  reason: 'RESTOCK' | 'ADJUSTMENT' | 'DAMAGE';
  notes?: string;
  approvalToken: string;
};
type Output = {
  variantId: string;
  oldStock: number;
  newStock: number;
  transactionId: string;
};
```
**Validation:** `newStock` cannot go negative; agent must surface the error.

### `reserve_inventory` / `release_inventory`
**Status:** NEW (Phase 4). Not yet present in `inventory.service.ts`. Defer until reservation logic is added — the agent should refuse the request and explain.

---

## Rental policies

Currently a singleton per tenant.

### `get_rental_policies`
**Status:** EXISTS (wraps `GET /rental-policies`)
**Permission:** `rentals:view`

### `create_rental_policy`
**Status:** SKIP — only one policy per tenant. Agent should call `update_rental_policy` instead.

### `update_rental_policy`
**Status:** EXISTS (wraps `PATCH /rental-policies/:id`)
**Permission:** `rental-policies:update` (NEW — add to seed)
**Approval:** **yes**
```ts
type Input = {
  bufferDaysBetweenRentals?: number;
  defaultDownPaymentPct?: number;            // 0–100
  lateFeePerDay?: number;
  maxRentalDurationDays?: number;
  advancePreparationReminderDays?: number;
  approvalToken: string;
};
```

### `delete_rental_policy`
**Status:** SKIP — singleton; instead, set fields back to defaults via `update_rental_policy`.

---

## Size guide

### `get_size_guide` / `list_size_guides`
**Status:** EXISTS (wraps `GET /size-guides`)
**Permission:** `size-guides:view` (NEW — add to seed)

### `create_size_guide_entry`
**Status:** EXISTS (wraps `POST /size-guides`)
**Permission:** `size-guides:update`
**Approval:** no — creates a draft (`isActive: false`)
```ts
type Input = {
  name: string;
  nameSwahili?: string;
  slug?: string;
  content: string;                  // markdown
  contentSwahili?: string;
  pdfUrl?: string;
  pdfUrlSwahili?: string;
  isDefault?: boolean;              // default false
};
```

### `update_size_guide_entry`
**Status:** EXISTS (wraps `PATCH /size-guides/:id`) — but the AI tool stores edits in a `pendingDraft` JSON until publish.
**Permission:** `size-guides:update`
**Approval:** no for draft writes; **yes** for setting `isActive: true` or `isDefault: true`.

### `delete_size_guide_entry`
**Status:** EXISTS (wraps `DELETE /size-guides/:id`)
**Permission:** `size-guides:update`
**Approval:** **yes**

---

## Recycle bin

### `list_deleted_records`
**Status:** EXISTS per-entity (`GET /products/deleted`, `/categories/deleted`, etc.) — AI tool aggregates them
**Permission:** `recycle-bin:list` (NEW — add to seed)
**Approval:** no
```ts
type Input  = { entity: 'Product' | 'Category' | 'Banner' | 'Page' | 'ChecklistTemplate' | 'ExpenseCategory' | 'Role' | 'AdminUser' | 'ProductSize' | 'SizeGuide' | 'ParallaxSection' | 'PaymentMethod'; page?: number; limit?: number; };
type Output = { entity: string; data: Array<{ id: string; label: string; deletedAt: string; deletedBy?: string }>; meta: PaginationMeta; };
```

### `restore_deleted_record`
**Status:** EXISTS per-entity. AI tool dispatches by `entity`.
**Permission:** `recycle-bin:restore`
**Approval:** **yes**

### `permanently_delete_record`
**Status:** EXISTS for products (`DELETE /products/:id/permanent`); other entities NEW (Phase 4). For Phase 1–2 only `Product` is hard-deletable.
**Permission:** `recycle-bin:permanent-delete`
**Approval:** **yes — fresh token, 60s TTL, no reuse, dual-confirm prompt in the agent reply**

---

## Reports (MODULE-GATED: `@RequiresModule('reports')`)

### `sales_summary`
**Status:** EXISTS (wraps `GET /analytics/dashboard` + `GET /reports/financials/summary`)
**Permission:** `reports:view`
**Approval:** no
```ts
type Input  = { range?: '24h' | '7d' | '30d' | '90d'; from?: string; to?: string };
type Output = {
  range: string;
  totalRevenue: string; totalOrders: number;
  avgOrderValue: string;
  ordersByStatus: Record<string, number>;
  comparisonVsPrev: { revenuePct: number; ordersPct: number };
};
```

### `rental_summary`
**Status:** EXISTS (wraps `GET /reports/rentals/by-product`)
**Permission:** `reports:view`

### `inventory_summary`
**Status:** alias of `inventory_summary` above.

### `popular_products_report`
**Status:** EXISTS — re-uses `topProducts` slice from `GET /analytics/dashboard`
**Permission:** `reports:view`

### `pending_orders_report`
**Status:** EXISTS (wraps `GET /orders/admin?status=PENDING`)
**Permission:** `reports:view`

### `overdue_rentals_report`
**Status:** EXISTS (wraps `GET /rentals/overdue`)
**Permission:** `reports:view`

---

## Tool dispatch contract (request/response wrapper)

Every AI tool call goes through a single envelope so the agent can reason about it uniformly:

**Request body**
```json
{
  "tool": "publish_product",
  "input": { "approvalToken": "appr_2026...", "id": "cm123..." },
  "agentSessionId": "as_2026_05_10_a1b2",
  "agentName": "naro-fashion-admin"
}
```

**Response body — success**
```json
{
  "ok": true,
  "tool": "publish_product",
  "output": { "id": "cm123...", "isActive": true },
  "audit": { "id": "audit_...", "loggedAt": "2026-05-10T11:30:00Z" }
}
```

**Response body — needs approval**
```json
{
  "ok": false,
  "error": "approval_required",
  "approvalRequest": {
    "id": "appr_req_...",
    "expiresAt": "2026-05-10T11:35:00Z",
    "summary": "Publish product 'Floral Mermaid Gown' (id cm123, basePrice TZS 850,000)"
  }
}
```

**Response body — error**
```json
{
  "ok": false,
  "error": "validation",
  "message": "categoryId not found",
  "field": "categoryId",
  "tool": "create_product_draft"
}
```

---

## Where new permissions need to be seeded

Add the following codes to `apps/api/src/permissions/permissions.service.ts:PERMISSIONS` and let `OnModuleInit` upsert them on next boot:

```ts
{ code: 'product-sizes:view',     module: 'product-sizes',  action: 'view',     name: 'View Product Sizes' },
{ code: 'product-sizes:create',   module: 'product-sizes',  action: 'create',   name: 'Create Product Sizes' },
{ code: 'product-sizes:update',   module: 'product-sizes',  action: 'update',   name: 'Update Product Sizes' },
{ code: 'product-sizes:delete',   module: 'product-sizes',  action: 'delete',   name: 'Delete Product Sizes' },
{ code: 'size-guides:view',       module: 'size-guides',    action: 'view',     name: 'View Size Guides' },
{ code: 'size-guides:update',     module: 'size-guides',    action: 'update',   name: 'Update Size Guides' },
{ code: 'rental-policies:view',   module: 'rental-policies',action: 'view',     name: 'View Rental Policies' },
{ code: 'rental-policies:update', module: 'rental-policies',action: 'update',   name: 'Update Rental Policies' },
{ code: 'recycle-bin:list',       module: 'recycle-bin',    action: 'list',     name: 'List Recycle Bin' },
{ code: 'recycle-bin:restore',    module: 'recycle-bin',    action: 'restore',  name: 'Restore from Recycle Bin' },
{ code: 'recycle-bin:permanent-delete', module: 'recycle-bin', action: 'permanent-delete', name: 'Permanently Delete from Recycle Bin' },
{ code: 'ai-agent:use',           module: 'ai-agent',       action: 'use',      name: 'Use AI Admin Agent' },
```

Add `ai-agent:use` to the SUPER_ADMIN seed role and ship it disabled-by-default for STAFF/MANAGER until the operator opts in.

import { Prisma } from '@prisma/client';

/**
 * Shared order-lifecycle helpers used by OrdersService (customer/admin
 * cancel) and OrderExpiryCron (auto-cancel of abandoned unpaid orders).
 * Kept as plain functions taking an explicit tenantId + transaction client
 * so the (non-request-scoped) cron can use them without TenantContext.
 */

/** Statuses from which an order may move to CANCELLED. */
export const CANCELLABLE_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING'];

/**
 * paymentStatus values meaning money has been (at least partly) collected
 * and is still held. PARTIALLY_REFUNDED = some, not all, of the collected
 * money went back via POST /orders/:id/refunds — the rest is still held, so a
 * cancel must still go to REFUND_PENDING.
 */
export const MONEY_COLLECTED_PAYMENT_STATUSES = ['PAID', 'PARTIAL', 'PARTIALLY_REFUNDED'];

/**
 * Online-order refund workflow (OrderRefundsService) payment statuses.
 *  - REFUND_PENDING: admin cancelled a paid order; money still to go back.
 *  - PARTIALLY_REFUNDED: part of the collected money refunded on an order
 *    that was NOT cancelled (e.g. partial goodwill refund).
 *  - REFUNDED: every collected shilling refunded (terminal — payments and
 *    gateway settlement never touch a REFUNDED order again).
 * Online `PARTIAL` keeps meaning "partially PAID" (POS reuses PARTIAL for
 * partially refunded sales, but POS sales are refunded from POS, not here).
 */
export const REFUND_PENDING = 'REFUND_PENDING';
export const PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED';
export const REFUNDED = 'REFUNDED';

/** Order paymentStatus values from which an admin may record a refund. */
export const REFUNDABLE_PAYMENT_STATUSES = ['REFUND_PENDING', 'PAID', 'PARTIAL', 'PARTIALLY_REFUNDED'];

/** paymentStatus values meaning nothing has been collected. */
export const UNPAID_PAYMENT_STATUSES = ['PENDING', 'FAILED', 'UNPAID'];

/** Order statuses that count as an "open" order (for the COD cap). */
export const OPEN_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED'];

export const DEFAULT_DELIVERY_FEES: Record<string, number> = {
  standard: 5000,
  express: 15000,
  pickup: 0,
};

/**
 * Server-side delivery fee. Per-tenant override via SiteSetting keys
 * `delivery_fee_standard` / `delivery_fee_express` / `delivery_fee_pickup`;
 * falls back to DEFAULT_DELIVERY_FEES when unset or not a non-negative number.
 */
export async function resolveDeliveryFee(
  db: Pick<Prisma.TransactionClient, 'siteSetting'>,
  tenantId: string,
  method: string,
): Promise<number> {
  const key = (method || 'standard').toLowerCase();
  const fallback = DEFAULT_DELIVERY_FEES[key] ?? DEFAULT_DELIVERY_FEES.standard;
  const row = await db.siteSetting.findFirst({
    where: { tenantId, key: `delivery_fee_${key}` },
    select: { value: true },
  });
  if (!row || row.value == null || String(row.value).trim() === '') return fallback;
  const n = Number(String(row.value).replace(/[, ]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

/**
 * Put an order's reserved stock back. MUST only be called after the caller
 * has won the conditional status flip (updateMany ... count === 1) inside the
 * same transaction — otherwise two concurrent cancels would both restock.
 */
export async function restockOrderItems(
  tx: Prisma.TransactionClient,
  orderId: string,
  tenantId: string,
  note: string,
): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  for (const item of items) {
    const qty = item.quantity - (item.refundedQuantity ?? 0);
    if (qty <= 0) continue;
    const inc = await tx.productVariant.updateMany({
      where: { id: item.variantId, tenantId },
      data: { stock: { increment: qty } },
    });
    if (inc.count === 0) continue;
    const after = await tx.productVariant.findFirst({
      where: { id: item.variantId, tenantId },
      select: { stock: true },
    });
    const quantityAfter = after?.stock ?? 0;
    await tx.inventoryTransaction.create({
      data: {
        tenantId,
        productId: item.productId,
        variantId: item.variantId,
        type: 'ADJUSTMENT',
        quantityBefore: quantityAfter - qty,
        quantityChange: qty,
        quantityAfter,
        note,
        performedBy: null,
      },
    });
  }
}

/**
 * Give back a promo redemption when its order is cancelled (only if a usage
 * row for this order actually existed, so the counter can't be driven below
 * the real number of redemptions).
 */
export async function releasePromoUsage(
  tx: Prisma.TransactionClient,
  order: { id: string; promoCodeId: string | null },
  tenantId: string,
): Promise<void> {
  if (!order.promoCodeId) return;
  const removed = await tx.promoCodeUsage.deleteMany({
    where: { promoCodeId: order.promoCodeId, orderId: order.id },
  });
  if (removed.count > 0) {
    await tx.promoCode.updateMany({
      where: { id: order.promoCodeId, tenantId, usedCount: { gte: removed.count } },
      data: { usedCount: { decrement: removed.count } },
    });
  }
}

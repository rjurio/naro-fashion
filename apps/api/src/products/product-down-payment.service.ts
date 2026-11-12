import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import {
  DEFAULT_DOWN_PAYMENT_PCT,
  effectiveDownPaymentPct,
  shopDownPaymentPct,
} from '../rentals/rental-terms';
import { SetRentalDownPaymentDto } from './dto/set-rental-down-payment.dto';

export const DOWN_PAYMENT_CHANGED = 'DOWN_PAYMENT_CHANGED';
export const PCT_NOT_ALLOWED_WITH_INHERIT = 'PCT_NOT_ALLOWED_WITH_INHERIT';

type Row = { rentalDownPaymentMode: string | null; rentalDownPaymentPct: number | null };
type Policy = { defaultDownPaymentPct: number | null } | null;

/**
 * Per-product down-payment setting (Inherit shop policy / Custom %).
 *
 * Effective values come from rentals/rental-terms.ts, the same function the
 * quote and the booking use, so what the admin sees is what a new booking
 * stores. Changing the setting NEVER touches existing bookings: a booking
 * stores its own amounts when it is created (RentalOrder.downPaymentAmount).
 */
@Injectable()
export class ProductDownPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
  ) {}

  private policy(tenantId: string): Promise<Policy> {
    return this.prisma.rentalPolicy.findFirst({
      where: { tenantId },
      select: { defaultDownPaymentPct: true },
    });
  }

  /** What the admin control shows. */
  describe(row: Row, policy: Policy) {
    const eff = effectiveDownPaymentPct(row.rentalDownPaymentPct, policy?.defaultDownPaymentPct, row.rentalDownPaymentMode);
    const shopPct = shopDownPaymentPct(policy?.defaultDownPaymentPct);
    return {
      mode: (row.rentalDownPaymentMode ?? 'NOT_REVIEWED') as 'INHERIT' | 'CUSTOM' | 'NOT_REVIEWED' | string,
      storedPct: row.rentalDownPaymentPct,
      effectivePct: eff.pct,
      effectiveSource: eff.source,
      shopPct,
      shopPctSource: shopPct === DEFAULT_DOWN_PAYMENT_PCT && policy?.defaultDownPaymentPct == null ? 'default' : 'shop',
      invalidSettings: eff.invalid,
    };
  }

  async get(id: string) {
    const tenantId = this.tenantContext.requireId;
    const row = await this.prisma.product.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { rentalDownPaymentMode: true, rentalDownPaymentPct: true },
    });
    if (!row) throw new NotFoundException('Product not found');
    return this.describe(row, await this.policy(tenantId));
  }

  /** For a product that doesn't exist yet: new products inherit the shop default. */
  async defaults() {
    const tenantId = this.tenantContext.requireId;
    const policy = await this.policy(tenantId);
    return this.describe({ rentalDownPaymentMode: 'INHERIT', rentalDownPaymentPct: null }, policy);
  }

  async set(id: string, dto: SetRentalDownPaymentDto) {
    const tenantId = this.tenantContext.requireId;
    if (dto.mode === 'INHERIT' && dto.pct !== undefined && dto.pct !== null) {
      throw new BadRequestException({
        code: PCT_NOT_ALLOWED_WITH_INHERIT,
        message: 'A percentage can only be set with "Custom". "Inherit" always uses the shop default.',
      });
    }
    const current = await this.prisma.product.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { rentalDownPaymentMode: true, rentalDownPaymentPct: true, updatedAt: true },
    });
    if (!current) throw new NotFoundException('Product not found');
    const policy = await this.policy(tenantId);

    const sawMode = dto.expectedMode === 'NOT_REVIEWED' ? null : dto.expectedMode;
    const sawPct = dto.expectedPct ?? null;
    const changed = () =>
      new ConflictException({
        code: DOWN_PAYMENT_CHANGED,
        message: 'Nothing was saved: this product\'s down-payment setting was changed by someone else. The current setting is now shown.',
        current: this.describe(current, policy),
      });
    if (current.rentalDownPaymentMode !== sawMode || current.rentalDownPaymentPct !== sawPct) throw changed();

    const next: Row = {
      rentalDownPaymentMode: dto.mode,
      rentalDownPaymentPct: dto.mode === 'CUSTOM' ? (dto.pct as number) : null,
    };
    // Compare-and-swap on what the admin saw. updatedAt is kept as it was on
    // purpose: it is the product FORM's version (expectedUpdatedAt), and this
    // setting has its own guard, so saving it must not make an open product
    // form look stale.
    const res = await this.prisma.product.updateMany({
      where: { id, tenantId, deletedAt: null, rentalDownPaymentMode: sawMode, rentalDownPaymentPct: sawPct },
      data: { ...next, updatedAt: current.updatedAt },
    });
    if (res.count !== 1) throw changed();

    const before = this.describe(current, policy);
    const after = this.describe(next, policy);
    await this.auditService.log('UPDATE_DOWN_PAYMENT', 'Product', id, {
      before: { mode: before.mode, pct: before.storedPct, effectivePct: before.effectivePct },
      after: { mode: after.mode, pct: after.storedPct, effectivePct: after.effectivePct },
      note: 'Applies to new bookings only; existing bookings keep their stored amounts.',
    });
    return after;
  }
}

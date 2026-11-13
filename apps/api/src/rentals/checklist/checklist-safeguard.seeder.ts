import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * R3: on every boot, switch the R1 rollback safety switch ON for every shop
 * (RentalHandoverSafeguard.checklistRequired = true). This build enforces the
 * checklist unconditionally; the switch protects a FUTURE rollback to a build
 * without the checklist (R1 / R2 builds refuse every hand-over while it is
 * on). It is the second of three independent protections: the R3 marker
 * table and the database trigger (migration 20261115090000) hold even if this
 * row were missing. Idempotent; never turns anything off; boot never fails.
 * PrismaService-only singleton (request-scoped providers get no lifecycle hooks).
 */
@Injectable()
export class ChecklistSafeguardSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChecklistSafeguardSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
      let switched = 0;
      for (const t of tenants) {
        const row = await this.prisma.rentalHandoverSafeguard.findFirst({ where: { tenantId: t.id } });
        if (row?.checklistRequired) continue;
        const data = { checklistRequired: true, reason: 'R3 mandatory checklist build: switched on at boot', changedById: null, changedAt: new Date() };
        if (row) await this.prisma.rentalHandoverSafeguard.updateMany({ where: { id: row.id, tenantId: t.id }, data });
        else await this.prisma.rentalHandoverSafeguard.create({ data: { tenantId: t.id, ...data } });
        switched++;
      }
      if (switched) this.logger.log(`R3: hand-over safety switch turned ON for ${switched} shop(s).`);
    } catch (err) {
      this.logger.error(`R3: could not turn the hand-over safety switch on: ${(err as Error).message}`);
    }
  }
}

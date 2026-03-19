import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

// Core modules that cannot be disabled — every tenant gets these
const CORE_MODULES = [
  'products', 'categories', 'orders', 'cart', 'wishlist', 'cms', 'auth', 'users', 'shipping',
];

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a tenant by custom domain — used by storefront middleware.
   * Public endpoint, should be fast and cacheable.
   */
  async resolveByDomain(domain: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { domain },
      select: {
        id: true,
        name: true,
        slug: true,
        domain: true,
        status: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException('Store not found');
    }

    if (tenant.status === 'DEACTIVATED') {
      throw new NotFoundException('Store not found');
    }

    return tenant;
  }

  /**
   * Resolve by slug — used for local development fallback.
   */
  async resolveBySlug(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        domain: true,
        status: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException('Store not found');
    }

    return tenant;
  }

  /**
   * Get tenant branding — public, used by storefront layout.
   */
  async getBranding(tenantId: string) {
    const branding = await this.prisma.tenantBranding.findUnique({
      where: { tenantId },
    });

    if (!branding) {
      throw new NotFoundException('Branding not found');
    }

    return branding;
  }

  /**
   * List all tenants — platform admin only.
   */
  async findAll(params?: { status?: string; search?: string }) {
    const where: any = {};
    if (params?.status) where.status = params.status;
    if (params?.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { slug: { contains: params.search, mode: 'insensitive' } },
        { domain: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const tenants = await this.prisma.tenant.findMany({
      where,
      include: {
        branding: { select: { companyName: true, logoUrl: true } },
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'GRACE', 'EXPIRED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { plan: { select: { name: true } } },
        },
        _count: { select: { adminUsers: true, users: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return tenants.map((t) => ({
      ...t,
      currentPlan: t.subscriptions[0]?.plan?.name || null,
      subscriptionStatus: t.subscriptions[0]?.status || null,
      subscriptionEndDate: t.subscriptions[0]?.endDate || null,
      adminCount: t._count.adminUsers,
      customerCount: t._count.users,
    }));
  }

  /**
   * Get tenant detail — platform admin only.
   */
  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        branding: true,
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          include: { plan: true },
        },
        modules: { orderBy: { moduleCode: 'asc' } },
        payments: { orderBy: { createdAt: 'desc' }, take: 10 },
        _count: { select: { adminUsers: true, users: true } },
      },
    });

    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  /**
   * Create a new tenant with branding, modules, and first admin user.
   */
  async create(dto: {
    name: string;
    slug: string;
    domain?: string;
    status?: string;
    trialEndsAt?: Date;
    // First admin user
    adminEmail: string;
    adminFirstName: string;
    adminLastName: string;
    adminPassword: string;
    // Subscription plan
    planId: string;
    billingCycle?: string;
    // Branding
    companyName?: string;
    colorPrimary?: string;
    colorSecondary?: string;
  }) {
    // Check slug uniqueness
    const existing = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException('Slug already in use');

    // Check domain uniqueness if provided
    if (dto.domain) {
      const domainExists = await this.prisma.tenant.findUnique({ where: { domain: dto.domain } });
      if (domainExists) throw new ConflictException('Domain already in use');
    }

    // Check admin email uniqueness (globally unique)
    const emailExists = await this.prisma.adminUser.findUnique({ where: { email: dto.adminEmail } });
    if (emailExists) throw new ConflictException('Admin email already in use');

    // Verify plan exists
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } });
    if (!plan) throw new BadRequestException('Subscription plan not found');

    const passwordHash = await bcrypt.hash(dto.adminPassword, 12);

    // Calculate subscription end date
    const endDate = new Date();
    if (dto.billingCycle === 'YEARLY') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Create tenant
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          domain: dto.domain || null,
          status: dto.status || 'ACTIVE',
          trialEndsAt: dto.trialEndsAt || null,
        },
      });

      // 2. Create branding
      await tx.tenantBranding.create({
        data: {
          tenantId: tenant.id,
          companyName: dto.companyName || dto.name,
          colorPrimary: dto.colorPrimary || '#D4AF37',
          colorSecondary: dto.colorSecondary || '#1A1A1A',
          colorAccent: dto.colorPrimary || '#D4AF37',
        },
      });

      // 3. Create first admin user (SUPER_ADMIN)
      await tx.adminUser.create({
        data: {
          tenantId: tenant.id,
          email: dto.adminEmail,
          passwordHash,
          firstName: dto.adminFirstName,
          lastName: dto.adminLastName,
          role: 'SUPER_ADMIN',
        },
      });

      // 4. Create subscription
      await tx.tenantSubscription.create({
        data: {
          tenantId: tenant.id,
          planId: dto.planId,
          status: dto.status === 'TRIAL' ? 'ACTIVE' : 'ACTIVE',
          billingCycle: dto.billingCycle || 'MONTHLY',
          startDate: new Date(),
          endDate,
        },
      });

      // 5. Create module entries based on plan
      const moduleCodes = plan.enabledModules;
      for (const moduleCode of moduleCodes) {
        await tx.tenantModule.create({
          data: { tenantId: tenant.id, moduleCode, isEnabled: true },
        });
      }

      // 6. Ensure core modules are always enabled
      for (const coreModule of CORE_MODULES) {
        if (!moduleCodes.includes(coreModule)) {
          await tx.tenantModule.upsert({
            where: { tenantId_moduleCode: { tenantId: tenant.id, moduleCode: coreModule } },
            update: { isEnabled: true },
            create: { tenantId: tenant.id, moduleCode: coreModule, isEnabled: true },
          });
        }
      }

      // 7. Seed default rental policy for tenant
      await tx.rentalPolicy.create({
        data: { tenantId: tenant.id },
      });

      return this.findOne(tenant.id);
    });
  }

  /**
   * Update tenant details.
   */
  async update(id: string, data: { name?: string; slug?: string; domain?: string | null }) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    if (data.slug && data.slug !== tenant.slug) {
      const existing = await this.prisma.tenant.findUnique({ where: { slug: data.slug } });
      if (existing) throw new ConflictException('Slug already in use');
    }

    if (data.domain && data.domain !== tenant.domain) {
      const existing = await this.prisma.tenant.findUnique({ where: { domain: data.domain } });
      if (existing) throw new ConflictException('Domain already in use');
    }

    return this.prisma.tenant.update({ where: { id }, data });
  }

  /**
   * Update tenant status (suspend, activate, deactivate).
   */
  async updateStatus(id: string, status: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    return this.prisma.tenant.update({
      where: { id },
      data: { status },
    });
  }

  /**
   * Get modules for a tenant with enabled status.
   */
  async getModules(tenantId: string) {
    return this.prisma.tenantModule.findMany({
      where: { tenantId },
      orderBy: { moduleCode: 'asc' },
    });
  }

  /**
   * Toggle a module for a tenant.
   */
  async toggleModule(tenantId: string, moduleCode: string, isEnabled: boolean) {
    // Prevent disabling core modules
    if (!isEnabled && (CORE_MODULES as readonly string[]).includes(moduleCode)) {
      throw new BadRequestException(`Core module "${moduleCode}" cannot be disabled`);
    }

    return this.prisma.tenantModule.upsert({
      where: { tenantId_moduleCode: { tenantId, moduleCode } },
      update: { isEnabled },
      create: { tenantId, moduleCode, isEnabled },
    });
  }

  /**
   * Update tenant branding.
   */
  async updateBranding(tenantId: string, data: any) {
    return this.prisma.tenantBranding.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, companyName: data.companyName || 'Company', ...data },
    });
  }

  // ============================================================
  // SUBSCRIPTION & BILLING
  // ============================================================

  /**
   * List subscription plans.
   */
  async getPlans() {
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Create a subscription plan.
   */
  async createPlan(data: any) {
    return this.prisma.subscriptionPlan.create({ data });
  }

  /**
   * Update a subscription plan.
   */
  async updatePlan(id: string, data: any) {
    return this.prisma.subscriptionPlan.update({ where: { id }, data });
  }

  /**
   * Subscribe a tenant to a plan.
   */
  async subscribeTenant(tenantId: string, planId: string, billingCycle = 'MONTHLY') {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new BadRequestException('Plan not found');

    const endDate = new Date();
    if (billingCycle === 'YEARLY') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    // Expire any existing active subscription
    await this.prisma.tenantSubscription.updateMany({
      where: { tenantId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });

    // Create new subscription
    const subscription = await this.prisma.tenantSubscription.create({
      data: {
        tenantId,
        planId,
        status: 'ACTIVE',
        billingCycle,
        startDate: new Date(),
        endDate,
      },
    });

    // Update tenant modules based on new plan
    const existingModules = await this.prisma.tenantModule.findMany({ where: { tenantId } });
    const existingModuleCodes = existingModules.map((m) => m.moduleCode);

    for (const moduleCode of plan.enabledModules) {
      if (!existingModuleCodes.includes(moduleCode)) {
        await this.prisma.tenantModule.create({
          data: { tenantId, moduleCode, isEnabled: true },
        });
      } else {
        await this.prisma.tenantModule.update({
          where: { tenantId_moduleCode: { tenantId, moduleCode } },
          data: { isEnabled: true },
        });
      }
    }

    return subscription;
  }

  /**
   * Record a payment for a tenant.
   */
  async recordPayment(tenantId: string, data: {
    amount: number;
    method: string;
    periodStart: Date;
    periodEnd: Date;
    transactionRef?: string;
    notes?: string;
  }) {
    const payment = await this.prisma.tenantPayment.create({
      data: {
        tenantId,
        amount: data.amount,
        method: data.method,
        status: 'COMPLETED',
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        transactionRef: data.transactionRef,
        notes: data.notes,
        paidAt: new Date(),
      },
    });

    // Extend subscription if it was in GRACE or EXPIRED status
    const sub = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId, status: { in: ['GRACE', 'EXPIRED', 'ACTIVE'] } },
      orderBy: { createdAt: 'desc' },
    });

    if (sub && sub.status !== 'ACTIVE') {
      await this.prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { status: 'ACTIVE', endDate: data.periodEnd },
      });

      // Reactivate tenant if suspended
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { status: 'ACTIVE' },
      });
    } else if (sub) {
      // Extend the active subscription end date
      await this.prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { endDate: data.periodEnd },
      });
    }

    return payment;
  }

  /**
   * Get payment history for a tenant.
   */
  async getPayments(tenantId: string) {
    return this.prisma.tenantPayment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get all payments across platform.
   */
  async getAllPayments(params?: { status?: string }) {
    const where: any = {};
    if (params?.status) where.status = params.status;

    return this.prisma.tenantPayment.findMany({
      where,
      include: {
        tenant: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Platform dashboard stats.
   */
  async getPlatformStats() {
    const [totalTenants, activeTenants, trialTenants, suspendedTenants] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.tenant.count({ where: { status: 'TRIAL' } }),
      this.prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
    ]);

    // MRR calculation
    const activeSubscriptions = await this.prisma.tenantSubscription.findMany({
      where: { status: 'ACTIVE' },
      include: { plan: { select: { priceMonthly: true, priceYearly: true } } },
    });

    let mrr = 0;
    for (const sub of activeSubscriptions) {
      if (sub.billingCycle === 'YEARLY' && sub.plan.priceYearly) {
        mrr += Number(sub.plan.priceYearly) / 12;
      } else {
        mrr += Number(sub.plan.priceMonthly);
      }
    }

    // Expiring soon (within 7 days)
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const expiringSoon = await this.prisma.tenantSubscription.count({
      where: {
        status: 'ACTIVE',
        endDate: { lte: sevenDaysFromNow },
      },
    });

    // Recent payments
    const recentPayments = await this.prisma.tenantPayment.findMany({
      where: { status: 'COMPLETED' },
      include: { tenant: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return {
      totalTenants,
      activeTenants,
      trialTenants,
      suspendedTenants,
      mrr: Math.round(mrr),
      expiringSoon,
      recentPayments,
    };
  }
}

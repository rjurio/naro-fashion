import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

@Controller('audit')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  /**
   * GET /audit — Paginated list with filtering.
   */
  @Get()
  async findAll(@Query() query: QueryAuditLogDto) {
    const tenantId = this.tenantContext.requireId;
    const page = query.page ? Math.max(1, parseInt(query.page, 10)) : 1;
    const limit = query.limit ? Math.min(100, Math.max(1, parseInt(query.limit, 10))) : 25;

    const where: any = { tenantId };

    if (query.adminUserId) {
      where.adminUserId = query.adminUserId;
    }
    if (query.entity) {
      where.entity = query.entity;
    }
    if (query.action) {
      where.action = query.action;
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    if (query.search) {
      where.OR = [
        { entity: { contains: query.search, mode: 'insensitive' } },
        { action: { contains: query.search, mode: 'insensitive' } },
        { entityId: { contains: query.search, mode: 'insensitive' } },
        { adminUser: { firstName: { contains: query.search, mode: 'insensitive' } } },
        { adminUser: { lastName: { contains: query.search, mode: 'insensitive' } } },
        { adminUser: { email: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.adminActivityLog.findMany({
        where,
        include: {
          adminUser: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.adminActivityLog.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * GET /audit/filters — Returns distinct entities, actions, and admin users for filter dropdowns.
   */
  @Get('filters')
  async getFilters() {
    const tenantId = this.tenantContext.requireId;

    const [entities, actions, adminUsers] = await Promise.all([
      this.prisma.adminActivityLog.findMany({
        where: { tenantId },
        select: { entity: true },
        distinct: ['entity'],
        orderBy: { entity: 'asc' },
      }),
      this.prisma.adminActivityLog.findMany({
        where: { tenantId },
        select: { action: true },
        distinct: ['action'],
        orderBy: { action: 'asc' },
      }),
      this.prisma.adminActivityLog.findMany({
        where: { tenantId },
        select: {
          adminUserId: true,
          adminUser: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
        distinct: ['adminUserId'],
      }),
    ]);

    return {
      entities: entities.map((e) => e.entity),
      actions: actions.map((a) => a.action),
      adminUsers: adminUsers.map((a) => ({
        id: a.adminUserId,
        firstName: a.adminUser.firstName,
        lastName: a.adminUser.lastName,
        email: a.adminUser.email,
      })),
    };
  }

  /**
   * GET /audit/export — CSV download. Same filters as list but no pagination (max 10000).
   */
  @Get('export')
  async exportCsv(@Query() query: QueryAuditLogDto, @Res() res: Response) {
    const tenantId = this.tenantContext.requireId;

    const where: any = { tenantId };

    if (query.adminUserId) {
      where.adminUserId = query.adminUserId;
    }
    if (query.entity) {
      where.entity = query.entity;
    }
    if (query.action) {
      where.action = query.action;
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    if (query.search) {
      where.OR = [
        { entity: { contains: query.search, mode: 'insensitive' } },
        { action: { contains: query.search, mode: 'insensitive' } },
        { entityId: { contains: query.search, mode: 'insensitive' } },
        { adminUser: { firstName: { contains: query.search, mode: 'insensitive' } } },
        { adminUser: { lastName: { contains: query.search, mode: 'insensitive' } } },
        { adminUser: { email: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const logs = await this.prisma.adminActivityLog.findMany({
      where,
      include: {
        adminUser: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const today = new Date().toISOString().split('T')[0];
    const filename = `audit-log-${today}.csv`;

    // Build CSV
    const header = 'Date,Admin User,Email,Action,Entity,Entity ID,IP Address,Details';
    const rows = logs.map((log) => {
      const date = new Date(log.createdAt).toISOString();
      const adminName = escapeCsv(`${log.adminUser.firstName} ${log.adminUser.lastName}`);
      const email = escapeCsv(log.adminUser.email);
      const action = escapeCsv(log.action);
      const entity = escapeCsv(log.entity);
      const entityId = escapeCsv(log.entityId || '');
      const ipAddress = escapeCsv(log.ipAddress || '');
      const details = escapeCsv(log.details ? JSON.stringify(log.details) : '');
      return `${date},${adminName},${email},${action},${entity},${entityId},${ipAddress},${details}`;
    });

    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(csv);
  }
}

/**
 * Escape a value for CSV output. Wraps in quotes if the value contains
 * commas, quotes, or newlines; doubles any internal quote characters.
 */
function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const PERMISSIONS = [
  // products
  { code: 'products:view', name: 'View Products', module: 'products', action: 'view' },
  { code: 'products:create', name: 'Create Products', module: 'products', action: 'create' },
  { code: 'products:update', name: 'Update Products', module: 'products', action: 'update' },
  { code: 'products:delete', name: 'Delete Products', module: 'products', action: 'delete' },
  { code: 'products:manage-inventory', name: 'Manage Product Inventory', module: 'products', action: 'manage-inventory' },
  // categories
  { code: 'categories:view', name: 'View Categories', module: 'categories', action: 'view' },
  { code: 'categories:create', name: 'Create Categories', module: 'categories', action: 'create' },
  { code: 'categories:update', name: 'Update Categories', module: 'categories', action: 'update' },
  { code: 'categories:delete', name: 'Delete Categories', module: 'categories', action: 'delete' },
  // orders
  { code: 'orders:view', name: 'View Orders', module: 'orders', action: 'view' },
  { code: 'orders:update-status', name: 'Update Order Status', module: 'orders', action: 'update-status' },
  { code: 'orders:cancel', name: 'Cancel Orders', module: 'orders', action: 'cancel' },
  { code: 'orders:refund', name: 'Refund Orders', module: 'orders', action: 'refund' },
  // rentals
  { code: 'rentals:view', name: 'View Rentals', module: 'rentals', action: 'view' },
  { code: 'rentals:update-status', name: 'Update Rental Status', module: 'rentals', action: 'update-status' },
  { code: 'rentals:manage-checklist', name: 'Manage Rental Checklists', module: 'rentals', action: 'manage-checklist' },
  // customers
  { code: 'customers:view', name: 'View Customers', module: 'customers', action: 'view' },
  { code: 'customers:suspend', name: 'Suspend Customers', module: 'customers', action: 'suspend' },
  { code: 'customers:delete', name: 'Delete Customers', module: 'customers', action: 'delete' },
  // reviews
  { code: 'reviews:view', name: 'View Reviews', module: 'reviews', action: 'view' },
  { code: 'reviews:moderate', name: 'Moderate Reviews', module: 'reviews', action: 'moderate' },
  // flash-sales
  { code: 'flash-sales:view', name: 'View Flash Sales', module: 'flash-sales', action: 'view' },
  { code: 'flash-sales:manage', name: 'Manage Flash Sales', module: 'flash-sales', action: 'manage' },
  // cms
  { code: 'cms:view', name: 'View CMS', module: 'cms', action: 'view' },
  { code: 'cms:manage', name: 'Manage CMS', module: 'cms', action: 'manage' },
  // analytics
  { code: 'analytics:view', name: 'View Analytics', module: 'analytics', action: 'view' },
  // inventory
  { code: 'inventory:view', name: 'View Inventory', module: 'inventory', action: 'view' },
  { code: 'inventory:manage', name: 'Manage Inventory', module: 'inventory', action: 'manage' },
  // reports
  { code: 'reports:view', name: 'View Reports', module: 'reports', action: 'view' },
  { code: 'reports:export', name: 'Export Reports', module: 'reports', action: 'export' },
  // expenses
  { code: 'expenses:view', name: 'View Expenses', module: 'expenses', action: 'view' },
  { code: 'expenses:manage', name: 'Manage Expenses', module: 'expenses', action: 'manage' },
  // expense-categories
  { code: 'expense-categories:view', name: 'View Expense Categories', module: 'expense-categories', action: 'view' },
  { code: 'expense-categories:manage', name: 'Manage Expense Categories', module: 'expense-categories', action: 'manage' },
  // admins
  { code: 'admins:view', name: 'View Admin Users', module: 'admins', action: 'view' },
  { code: 'admins:create', name: 'Create Admin Users', module: 'admins', action: 'create' },
  { code: 'admins:update', name: 'Update Admin Users', module: 'admins', action: 'update' },
  { code: 'admins:delete', name: 'Delete Admin Users', module: 'admins', action: 'delete' },
  { code: 'admins:unlock', name: 'Unlock Admin Accounts', module: 'admins', action: 'unlock' },
  // roles
  { code: 'roles:view', name: 'View Roles', module: 'roles', action: 'view' },
  { code: 'roles:manage', name: 'Manage Roles', module: 'roles', action: 'manage' },
  // audit
  { code: 'audit:view', name: 'View Audit Logs', module: 'audit', action: 'view' },
  { code: 'audit:export', name: 'Export Audit Logs', module: 'audit', action: 'export' },
  // settings
  { code: 'settings:manage', name: 'Manage Settings', module: 'settings', action: 'manage' },
];

@Injectable()
export class PermissionsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Seed permissions on startup (upsert by code)
    for (const p of PERMISSIONS) {
      await this.prisma.permission.upsert({
        where: { code: p.code },
        create: p,
        update: { name: p.name, module: p.module, action: p.action },
      });
    }
  }

  async findAll(module?: string) {
    return this.prisma.permission.findMany({
      where: { isActive: true, ...(module ? { module } : {}) },
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
  }

  async getModules() {
    const perms = await this.prisma.permission.findMany({ select: { module: true }, distinct: ['module'] });
    return perms.map(p => p.module).sort();
  }
}

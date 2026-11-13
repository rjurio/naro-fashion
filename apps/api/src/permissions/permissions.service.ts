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
  // National ID review (owner rule 2026-11-12: only authorised staff approve
  // or reject IDs). Not in MANAGER_DEFAULT_GRANTS: existing roles don't get
  // it; SUPER_ADMIN holds every permission. Grant it explicitly.
  { code: 'id-verification:review', name: 'Review National ID Documents', module: 'id-verification', action: 'review' },
  { code: 'rentals:manage-checklist', name: 'Manage Rental Checklists', module: 'rentals', action: 'manage-checklist' },
  // POS rental MVP (walk-in rentals + rental money ledger). Not in
  // MANAGER_DEFAULT_GRANTS: existing roles don't get them; SUPER_ADMIN holds
  // every permission. Grant explicitly per role.
  { code: 'rentals:create', name: 'Create Walk-in Rental Bookings', module: 'rentals', action: 'create' },
  { code: 'rentals:record-payment', name: 'Record Rental Payments', module: 'rentals', action: 'record-payment' },
  { code: 'rentals:release', name: 'Hand Over Rental Items', module: 'rentals', action: 'release' },
  { code: 'rentals:refund-request', name: 'Request Rental Refunds', module: 'rentals', action: 'refund-request' },
  { code: 'refunds:approve', name: 'Approve Refunds (second person)', module: 'payments', action: 'approve-refund' },
  { code: 'rentals:manage-inventory', name: 'Manage Rental Units', module: 'rentals', action: 'manage-inventory' },
  // R2: the independent reviewer who approves a physical count before a product switches to per-gown availability.
  // R1 rollback safety switch (break-glass; never auto-granted).
  { code: 'rentals:handover-safeguard', name: 'Change the Rental Hand-over Safety Switch', module: 'rentals', action: 'handover-safeguard' },
  // LF-2026-11: the independent approver of late-fee waivers (never auto-granted).
  { code: 'rentals:waive-late-fee', name: 'Approve Late-Fee Waivers (second person)', module: 'rentals', action: 'waive-late-fee' },
  { code: 'rentals:approve-unit-tracking', name: 'Approve Gown Counts (second person)', module: 'rentals', action: 'approve-unit-tracking' },
  // R3 mandatory checklist (never auto-granted): record hand-over / return
  // evidence; decide exceptions + discrepancies (a different person); edit
  // the templates future bookings get.
  { code: 'rentals:checklist-verify', name: 'Record Rental Checklist Evidence', module: 'rentals', action: 'checklist-verify' },
  { code: 'rentals:checklist-exception', name: 'Decide Checklist Exceptions and Discrepancies (second person)', module: 'rentals', action: 'checklist-exception' },
  { code: 'rentals:checklist-templates', name: 'Edit Rental Checklist Templates', module: 'rentals', action: 'checklist-templates' },
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
  // product-sizes (AI-agent read scope; create/update/delete inferred from products perms today)
  { code: 'product-sizes:view', name: 'View Product Sizes', module: 'product-sizes', action: 'view' },
  // size-guides
  { code: 'size-guides:view', name: 'View Size Guides', module: 'size-guides', action: 'view' },
  // rental-policies
  { code: 'rental-policies:view', name: 'View Rental Policies', module: 'rental-policies', action: 'view' },
  // Per-product down payment (Inherit shop policy / Custom %). Not auto-granted
  // to MANAGER or STAFF: SUPER_ADMIN has it by design; grant it explicitly.
  { code: 'rental-policies:manage', name: 'Manage Rental Down-Payment Terms', module: 'rental-policies', action: 'manage' },
  // recycle-bin
  { code: 'recycle-bin:list', name: 'List Recycle Bin', module: 'recycle-bin', action: 'list' },
  // ai-agent — required for any /api/v1/ai/* call. Disabled by default for STAFF/MANAGER;
  // operators must grant it explicitly to roles that should use the agent.
  { code: 'ai-agent:use', name: 'Use AI Admin Agent', module: 'ai-agent', action: 'use' },
  // ai-agent scope permissions (Phase 3.0+). NOT yet enforced on Phase 1/2 routes —
  // the AiPermissionGuard reads @RequiresAiPermission() metadata when a route opts
  // in. Seeding now so operators can pre-wire roles before Phase 3.1 enforcement.
  { code: 'ai-agent:read', name: 'AI Agent — Read Tools', module: 'ai-agent', action: 'read' },
  { code: 'ai-agent:write-drafts', name: 'AI Agent — Create Drafts / Notes', module: 'ai-agent', action: 'write-drafts' },
  { code: 'ai-agent:approve', name: 'AI Agent — Approve Risky Actions', module: 'ai-agent', action: 'approve' },
  // Phase 2 write actions (drafts + notes) — currently gated only by ai-agent:use.
  // Per-tool permission enforcement lands with the approval workflow in Phase 3.
  // These codes are seeded so operators can already wire them into roles for the
  // Phase 3 cutover without a redeploy.
  { code: 'orders:add-note', name: 'Add Order Notes', module: 'orders', action: 'add-note' },
  { code: 'size-guides:create', name: 'Create Size Guides', module: 'size-guides', action: 'create' },
  { code: 'product-sizes:create', name: 'Create Product Sizes', module: 'product-sizes', action: 'create' },
  // Fine-grained gates for sensitive money / data-destruction actions
  // (October 2026 review). Applied via @RequiresPermission on the matching
  // controllers; SUPER_ADMIN + platform admins bypass in PermissionGuard.
  { code: 'payments:manage', name: 'Manage Payments (manual confirm / refund)', module: 'payments', action: 'manage' },
  { code: 'payment-methods:manage', name: 'Manage Payment Methods & Gateway Credentials', module: 'payment-methods', action: 'manage' },
  // R1b: a POS refund is now a REQUEST (approval + payout by others).
  { code: 'pos:refund', name: 'Request POS Refunds', module: 'pos', action: 'refund' },
  { code: 'pos:layaway-cancel', name: 'Cancel Layaways (creates a refund request for money paid)', module: 'pos', action: 'layaway-cancel' },
  { code: 'payments:confirm-manual', name: 'Confirm card / mobile-money payments manually (terminal slip / SMS evidence)', module: 'payments', action: 'confirm-manual' },
  { code: 'payments:reverse', name: 'Reverse a manually confirmed payment', module: 'payments', action: 'reverse' },
  { code: 'finance:close', name: 'Close Financial Periods', module: 'finance', action: 'close' },
  { code: 'recycle-bin:purge', name: 'Permanently Purge Recycle Bin Items', module: 'recycle-bin', action: 'purge' },
  { code: 'newsletter:send', name: 'Send Newsletter Campaigns', module: 'newsletter', action: 'send' },
];

/**
 * Default grants for the shared system MANAGER role (tenantId=null,
 * isSystem=true), applied idempotently on every boot (createMany +
 * skipDuplicates — existing grants are never removed, so operator edits that
 * ADD permissions are preserved).
 *
 * Deliberately NOT granted to MANAGER (SUPER_ADMIN-only by default, since
 * SUPER_ADMIN bypasses PermissionGuard): payment-methods:manage (gateway
 * secrets), payments:manage (manual payment confirmation), recycle-bin:purge
 * (irreversible deletion), settings:manage. Tenants that want a manager to
 * hold those must create a custom role. RolesService.MANAGER_EXCLUDED keeps
 * the same codes out of a freshly-seeded MANAGER role.
 */
export const MANAGER_DEFAULT_GRANTS = [
  'pos:refund',
  // P0c: payments:confirm-manual is deliberately NOT a default. Nobody but
  // SUPER_ADMIN gets it automatically: the owner grants it per person
  // (Admin -> Roles) after the POS-user inventory and cashier training.
  'expenses:manage',
  'newsletter:send',
  'customers:suspend',
  'finance:close',
  'reports:view',
  'expense-categories:manage',
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
    await this.seedManagerDefaults();
  }

  /** Idempotently grant MANAGER_DEFAULT_GRANTS to the system MANAGER role, if it exists. */
  async seedManagerDefaults() {
    const manager = await this.prisma.role.findFirst({
      where: { name: 'MANAGER', isSystem: true, tenantId: null },
      select: { id: true },
    });
    if (!manager) return; // RolesService seeds it on first boot (with these codes included)
    const perms = await this.prisma.permission.findMany({
      where: { code: { in: MANAGER_DEFAULT_GRANTS } },
      select: { id: true },
    });
    if (perms.length === 0) return;
    await this.prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: manager.id, permissionId: p.id })),
      skipDuplicates: true,
    });
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

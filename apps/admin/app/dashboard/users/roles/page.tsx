'use client';
import { useState, useEffect, useCallback } from 'react';
import { Shield, Plus, Pencil, Trash2, Key } from 'lucide-react';
import adminApi from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';

export default function RolesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);

  const [roleModal, setRoleModal] = useState<{ open: boolean; role: any | null }>({ open: false, role: null });
  const [roleForm, setRoleForm] = useState({ name: '', description: '' });
  const [roleSaving, setRoleSaving] = useState(false);

  const [permModal, setPermModal] = useState<{ open: boolean; role: any | null }>({ open: false, role: null });
  const [rolePermIds, setRolePermIds] = useState<Set<string>>(new Set());
  const [permSaving, setPermSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesData, permsData, modData] = await Promise.all([
        adminApi.getRoles({ includeDeleted: showDeleted ? 'true' : 'false' }),
        adminApi.getPermissions(),
        adminApi.getPermissionModules(),
      ]);
      setRoles(rolesData);
      setPermissions(permsData);
      setModules(modData);
    } catch {
      toast.error('Failed to load roles and permissions');
    } finally {
      setLoading(false);
    }
  }, [showDeleted]);

  useEffect(() => { loadData(); }, [loadData]);

  const openRoleModal = (role?: any) => {
    setRoleForm(role ? { name: role.name, description: role.description ?? '' } : { name: '', description: '' });
    setRoleModal({ open: true, role: role ?? null });
  };

  const saveRole = async () => {
    if (!roleForm.name && !roleModal.role) return;
    setRoleSaving(true);
    try {
      if (roleModal.role) {
        await adminApi.updateRole(roleModal.role.id, { description: roleForm.description, ...(!roleModal.role.isSystem ? { name: roleForm.name } : {}) });
      } else {
        await adminApi.createRole({ name: roleForm.name, description: roleForm.description });
      }
      toast.success(`Role ${roleModal.role ? 'updated' : 'created'}`);
      setRoleModal({ open: false, role: null });
      loadData();
    } catch (e: any) {
      toast.error(e.message?.includes('409') || e.message?.includes('Conflict') ? 'A role with this name already exists' : 'Failed to save role');
    } finally {
      setRoleSaving(false);
    }
  };

  const deleteRole = async (role: any) => {
    const ok = await confirm({ title: 'Delete Role', message: `Delete "${role.name}"?`, confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await adminApi.deleteRole(role.id);
      toast.success('Role deleted');
      loadData();
    } catch (e: any) {
      toast.error(e.message?.includes('403') ? 'Cannot delete system roles' : 'Failed to delete role');
    }
  };

  const restoreRole = async (role: any) => {
    try {
      await adminApi.restoreRole(role.id);
      toast.success('Role restored');
      loadData();
    } catch {
      toast.error('Failed to restore role');
    }
  };

  const openPermModal = async (role: any) => {
    setPermModal({ open: true, role });
    try {
      const rolePerms = await adminApi.getRolePermissions(role.id);
      setRolePermIds(new Set(rolePerms.map((rp: any) => rp.permissionId)));
    } catch {
      toast.error('Failed to load role permissions');
    }
  };

  const togglePerm = (permId: string) => {
    setRolePermIds(prev => {
      const next = new Set(prev);
      if (next.has(permId)) next.delete(permId); else next.add(permId);
      return next;
    });
  };

  const toggleModule = (module: string) => {
    const modulePerms = permissions.filter(p => p.module === module);
    const allChecked = modulePerms.every(p => rolePermIds.has(p.id));
    setRolePermIds(prev => {
      const next = new Set(prev);
      if (allChecked) modulePerms.forEach(p => next.delete(p.id));
      else modulePerms.forEach(p => next.add(p.id));
      return next;
    });
  };

  const savePermissions = async () => {
    if (!permModal.role) return;
    setPermSaving(true);
    try {
      const currentPerms = await adminApi.getRolePermissions(permModal.role.id);
      const currentIds = new Set(currentPerms.map((rp: any) => rp.permissionId));
      const toAdd = [...rolePermIds].filter(id => !currentIds.has(id));
      const toRemove = [...currentIds].filter(id => !rolePermIds.has(id));
      if (toAdd.length > 0) await adminApi.addRolePermissions(permModal.role.id, toAdd);
      for (const pid of toRemove) await adminApi.removeRolePermission(permModal.role.id, pid);
      toast.success('Permissions saved');
      setPermModal({ open: false, role: null });
      loadData();
    } catch (e: any) {
      toast.error(e.message?.includes('403') ? 'Cannot modify system role permissions' : 'Failed to save permissions');
    } finally {
      setPermSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Roles & Permissions"
        subtitle="Define what each role can do in the system"
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'User Management' }, { label: 'Roles & Permissions' }]}
        actions={
          <button onClick={() => openRoleModal()} className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors">
            <Plus className="w-4 h-4" /> Create Role
          </button>
        }
      />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center px-4 py-3 border-b border-border">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={showDeleted} onChange={e => setShowDeleted(e.target.checked)} className="rounded" />
            Show deleted roles
          </label>
        </div>

        {loading ? <SkeletonTable rows={5} cols={6} /> : roles.length === 0 ? (
          <EmptyState icon={Shield} title="No roles found" actionLabel="Create Role" onAction={() => openRoleModal()} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>{['Name', 'Type', 'Description', 'Permissions', 'Users', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {roles.map((role: any) => (
                  <tr key={role.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${role.deletedAt ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 font-medium">{role.name}</td>
                    <td className="px-4 py-3"><Badge variant={role.isSystem ? 'purple' : 'neutral'}>{role.isSystem ? 'System' : 'Custom'}</Badge></td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">{role.description ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{role._count?.permissions ?? 0}</td>
                    <td className="px-4 py-3 text-muted-foreground">{role._count?.adminUsers ?? 0}</td>
                    <td className="px-4 py-3"><Badge variant={role.isActive ? 'success' : 'neutral'}>{role.isActive ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {!role.deletedAt ? (
                          <>
                            <button onClick={() => openPermModal(role)} className="p-1.5 rounded hover:bg-brand-gold/10 transition-colors text-brand-gold" title="Manage Permissions">
                              <Key className="w-4 h-4" />
                            </button>
                            <button onClick={() => openRoleModal(role)} className="p-1.5 rounded hover:bg-muted transition-colors" title="Edit">
                              <Pencil className="w-4 h-4 text-muted-foreground" />
                            </button>
                            {!role.isSystem && (
                              <button onClick={() => deleteRole(role)} className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900 transition-colors" title="Delete">
                                <Trash2 className="w-4 h-4 text-red-500" />
                              </button>
                            )}
                          </>
                        ) : (
                          <button onClick={() => restoreRole(role)} className="text-xs text-brand-gold hover:underline px-2 py-1">Restore</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Role Modal */}
      <Modal isOpen={roleModal.open} onClose={() => setRoleModal({ open: false, role: null })} title={roleModal.role ? 'Edit Role' : 'Create Role'} size="sm"
        footer={
          <>
            <button onClick={() => setRoleModal({ open: false, role: null })} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors">Cancel</button>
            <button onClick={saveRole} disabled={roleSaving} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors disabled:opacity-50">
              {roleSaving ? 'Saving...' : roleModal.role ? 'Save Changes' : 'Create Role'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {!roleModal.role?.isSystem && (
            <FormField label="Role Name" required hint="Must be unique">
              <input type="text" value={roleForm.name} onChange={e => setRoleForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50" />
            </FormField>
          )}
          <FormField label="Description">
            <textarea value={roleForm.description} onChange={e => setRoleForm(f => ({ ...f, description: e.target.value }))} rows={3}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50 resize-none" />
          </FormField>
          {!roleModal.role && <p className="text-xs text-muted-foreground">You can assign permissions after creating the role.</p>}
        </div>
      </Modal>

      {/* Permission Matrix Modal */}
      <Modal isOpen={permModal.open} onClose={() => setPermModal({ open: false, role: null })} title={`Permissions: ${permModal.role?.name ?? ''}`} size="xl"
        footer={
          <>
            <button onClick={() => setPermModal({ open: false, role: null })} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors">Cancel</button>
            <button onClick={savePermissions} disabled={permSaving} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors disabled:opacity-50">
              {permSaving ? 'Saving...' : 'Save Permissions'}
            </button>
          </>
        }
      >
        <div className="space-y-6">
          {modules.map(module => {
            const modulePerms = permissions.filter(p => p.module === module);
            const allChecked = modulePerms.every(p => rolePermIds.has(p.id));
            return (
              <div key={module}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold capitalize text-foreground">{module.replace(/-/g, ' ')}</h3>
                  <button onClick={() => toggleModule(module)} className="text-xs text-brand-gold hover:underline">
                    {allChecked ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {modulePerms.map(perm => (
                    <label key={perm.id}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors
                        ${rolePermIds.has(perm.id)
                          ? 'bg-brand-gold/10 border-brand-gold/50 text-foreground'
                          : 'bg-background border-border text-muted-foreground hover:bg-muted'}`}
                    >
                      <input type="checkbox" checked={rolePermIds.has(perm.id)} onChange={() => togglePerm(perm.id)} className="rounded accent-[#D4AF37]" />
                      <span className="text-xs leading-tight">{perm.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}

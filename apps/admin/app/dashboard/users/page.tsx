'use client';
import { useState, useEffect, useCallback } from 'react';
import { Users, UserPlus, UserCog, Lock, CheckCircle, XCircle, Search, Trash2 } from 'lucide-react';
import adminApi from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';

export default function AdminUsersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [admins, setAdmins] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [createModal, setCreateModal] = useState(false);
  const [editModal, setEditModal] = useState<{ open: boolean; admin: any | null }>({
    open: false,
    admin: null,
  });
  const [createForm, setCreateForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: 'STAFF',
    roleId: '',
  });
  const [editForm, setEditForm] = useState({ firstName: '', lastName: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [newTempPassword, setNewTempPassword] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [adminData, rolesData] = await Promise.all([
        adminApi.getAdminUsers({ includeDeleted: 'false' }),
        adminApi.getRoles(),
      ]);
      setAdmins(adminData ?? []);
      setRoles(rolesData ?? []);
    } catch {
      toast.error('Failed to load admin users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredAdmins = admins.filter((a) => {
    const matchSearch =
      !search ||
      `${a.firstName} ${a.lastName} ${a.email}`.toLowerCase().includes(search.toLowerCase());
    const matchRole = !roleFilter || a.role === roleFilter;
    return matchSearch && matchRole;
  });

  const totalActive = admins.filter((a) => a.isActive && !a.deletedAt).length;
  const totalInactive = admins.filter((a) => !a.isActive && !a.deletedAt).length;
  const totalLocked = admins.filter(
    (a) => a.lockedUntil && new Date(a.lockedUntil) > new Date()
  ).length;

  const createAdmin = async () => {
    if (!createForm.firstName || !createForm.lastName || !createForm.email) return;
    setSaving(true);
    try {
      const result = await adminApi.createAdminUser({
        ...createForm,
        roleId: createForm.roleId || undefined,
      });
      toast.success(`Admin user created. Temporary password: ${result.temporaryPassword}`);
      setNewTempPassword(result.temporaryPassword);
      load();
    } catch (e: any) {
      toast.error(
        e.message?.includes('409') || e.message?.includes('Conflict')
          ? 'Email already in use'
          : 'Failed to create admin user'
      );
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editModal.admin) return;
    setSaving(true);
    try {
      await adminApi.updateAdminUser(editModal.admin.id, editForm);
      toast.success('Admin user updated');
      setEditModal({ open: false, admin: null });
      load();
    } catch {
      toast.error('Failed to update admin user');
    } finally {
      setSaving(false);
    }
  };

  const toggleAdmin = async (admin: any) => {
    const action = admin.isActive ? 'disable' : 'enable';
    const ok = await confirm({
      title: `${admin.isActive ? 'Disable' : 'Enable'} Admin User`,
      message: `Are you sure you want to ${action} ${admin.firstName} ${admin.lastName}?`,
      confirmLabel: admin.isActive ? 'Disable' : 'Enable',
      variant: admin.isActive ? 'warning' : 'default',
    });
    if (!ok) return;
    try {
      await adminApi.toggleAdminUser(admin.id);
      toast.success(`Admin user ${action}d`);
      load();
    } catch {
      toast.error(`Failed to ${action} admin user`);
    }
  };

  const unlockAdmin = async (admin: any) => {
    try {
      await adminApi.unlockAdminUser(admin.id);
      toast.success(`${admin.firstName} ${admin.lastName} has been unlocked`);
      load();
    } catch {
      toast.error('Failed to unlock account');
    }
  };

  const deleteAdmin = async (admin: any) => {
    const ok = await confirm({
      title: 'Delete Admin User',
      message: `This will permanently delete ${admin.firstName} ${admin.lastName}. This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await adminApi.deleteAdminUser(admin.id);
      toast.success('Admin user deleted');
      load();
    } catch (e: any) {
      toast.error(
        e.message?.includes('403') ? 'You cannot delete this account' : 'Failed to delete admin user'
      );
    }
  };

  const isLocked = (admin: any) =>
    admin.lockedUntil && new Date(admin.lockedUntil) > new Date();

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Admin Users"
        subtitle="Manage staff accounts and access"
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'User Management' },
          { label: 'Admin Users' },
        ]}
        actions={
          <button
            onClick={() => {
              setCreateModal(true);
              setNewTempPassword('');
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors"
          >
            <UserPlus className="w-4 h-4" /> Add Admin User
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Admins', value: admins.length, icon: Users, highlight: false },
          { label: 'Active', value: totalActive, icon: CheckCircle, highlight: false },
          { label: 'Inactive', value: totalInactive, icon: XCircle, highlight: false },
          { label: 'Locked Accounts', value: totalLocked, icon: Lock, highlight: totalLocked > 0 },
        ].map((c) => (
          <div
            key={c.label}
            className={`bg-card border rounded-xl p-4 flex items-start justify-between ${
              c.highlight
                ? 'border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-700'
                : 'border-border'
            }`}
          >
            <div>
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-2xl font-bold mt-1">{c.value}</p>
            </div>
            <c.icon
              className={`w-5 h-5 mt-0.5 ${c.highlight ? 'text-amber-500' : 'text-muted-foreground'}`}
            />
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex gap-3 p-4 border-b border-border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg"
          >
            <option value="">All Roles</option>
            <option value="SUPER_ADMIN">Super Admin</option>
            <option value="MANAGER">Manager</option>
            <option value="STAFF">Staff</option>
          </select>
        </div>

        {loading ? (
          <SkeletonTable rows={5} cols={7} />
        ) : filteredAdmins.length === 0 ? (
          <EmptyState
            icon={UserCog}
            title="No admin users found"
            actionLabel="Add Admin User"
            onAction={() => setCreateModal(true)}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  {['Name', 'Email', 'Role', 'Assigned Roles', 'Status', 'Created', 'Actions'].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredAdmins.map((a: any) => (
                  <tr key={a.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-gold/20 flex items-center justify-center text-xs font-bold text-brand-gold">
                          {a.firstName?.[0]}
                          {a.lastName?.[0]}
                        </div>
                        <span className="font-medium">
                          {a.firstName} {a.lastName}
                        </span>
                        {isLocked(a) && <Lock className="w-3.5 h-3.5 text-amber-500" />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{a.email}</td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          a.role === 'SUPER_ADMIN'
                            ? 'purple'
                            : a.role === 'MANAGER'
                            ? 'info'
                            : 'neutral'
                        }
                      >
                        {a.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(a.roles ?? []).slice(0, 3).map((r: any) => (
                          <Badge key={r.role?.id ?? r.id} variant="gold">
                            {r.role?.name ?? r.name}
                          </Badge>
                        ))}
                        {(a.roles ?? []).length > 3 && (
                          <Badge variant="neutral">+{(a.roles ?? []).length - 3}</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={a.isActive ? 'success' : 'neutral'}>
                        {a.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(a.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditForm({
                              firstName: a.firstName,
                              lastName: a.lastName,
                              email: a.email,
                            });
                            setEditModal({ open: true, admin: a });
                          }}
                          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                          title="Edit"
                        >
                          <UserCog className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => toggleAdmin(a)}
                          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                          title={a.isActive ? 'Disable' : 'Enable'}
                        >
                          {a.isActive ? (
                            <XCircle className="w-4 h-4" />
                          ) : (
                            <CheckCircle className="w-4 h-4" />
                          )}
                        </button>
                        {isLocked(a) && (
                          <button
                            onClick={() => unlockAdmin(a)}
                            className="p-1.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors text-amber-500"
                            title="Unlock account"
                          >
                            <Lock className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => deleteAdmin(a)}
                          className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900 transition-colors text-red-500"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Admin Modal */}
      <Modal
        isOpen={createModal}
        onClose={() => setCreateModal(false)}
        title="Add Admin User"
        size="md"
        footer={
          !newTempPassword ? (
            <>
              <button
                onClick={() => setCreateModal(false)}
                className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createAdmin}
                disabled={saving || !createForm.firstName || !createForm.lastName || !createForm.email}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create Admin User'}
              </button>
            </>
          ) : undefined
        }
      >
        {newTempPassword ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 dark:bg-green-950 dark:border-green-800 rounded-lg p-4">
              <p className="font-medium text-green-800 dark:text-green-300 mb-2">
                Admin user created successfully!
              </p>
              <p className="text-sm text-green-700 dark:text-green-400">
                Temporary password:{' '}
                <code className="font-mono bg-green-100 dark:bg-green-900 px-2 py-0.5 rounded">
                  {newTempPassword}
                </code>
              </p>
              <p className="text-xs text-green-600 dark:text-green-500 mt-1">
                Share this with the user — they should change it on first login.
              </p>
            </div>
            <button
              onClick={() => {
                setCreateModal(false);
                setCreateForm({ firstName: '', lastName: '', email: '', role: 'STAFF', roleId: '' });
                setNewTempPassword('');
              }}
              className="w-full px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="First Name" required>
                <input
                  type="text"
                  value={createForm.firstName}
                  onChange={(e) => setCreateForm((f) => ({ ...f, firstName: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
                />
              </FormField>
              <FormField label="Last Name" required>
                <input
                  type="text"
                  value={createForm.lastName}
                  onChange={(e) => setCreateForm((f) => ({ ...f, lastName: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
                />
              </FormField>
            </div>
            <FormField label="Email Address" required>
              <input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
              />
            </FormField>
            <FormField label="Primary Role" required>
              <select
                value={createForm.role}
                onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
              >
                <option value="STAFF">Staff</option>
                <option value="MANAGER">Manager</option>
                <option value="SUPER_ADMIN">Super Admin</option>
              </select>
            </FormField>
            <FormField label="Assign Role" hint="Optional: assign a granular role">
              <select
                value={createForm.roleId}
                onChange={(e) => setCreateForm((f) => ({ ...f, roleId: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
              >
                <option value="">None</option>
                {roles.map((r: any) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </FormField>
            <p className="text-xs text-muted-foreground">
              A temporary password will be generated and displayed after creation.
            </p>
          </div>
        )}
      </Modal>

      {/* Edit Admin Modal */}
      <Modal
        isOpen={editModal.open}
        onClose={() => setEditModal({ open: false, admin: null })}
        title={`Edit: ${editModal.admin?.firstName} ${editModal.admin?.lastName}`}
        size="md"
        footer={
          <>
            <button
              onClick={() => setEditModal({ open: false, admin: null })}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveEdit}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="First Name">
              <input
                type="text"
                value={editForm.firstName}
                onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
              />
            </FormField>
            <FormField label="Last Name">
              <input
                type="text"
                value={editForm.lastName}
                onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
              />
            </FormField>
          </div>
          <FormField label="Email Address">
            <input
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
            />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}

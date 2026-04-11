'use client';

import { useState, useEffect, useCallback } from 'react';
import { Download, Search, Loader2, ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import adminApi from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';

function getActionBadgeVariant(action: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  switch (action) {
    case 'CREATE':
    case 'RESTORE':
      return 'success';
    case 'UPDATE':
    case 'UPDATE_STATUS':
    case 'TOGGLE_ACTIVE':
      return 'warning';
    case 'DELETE':
    case 'PERMANENT_DELETE':
      return 'error';
    case 'LOGIN_SUCCESS':
      return 'info';
    case 'LOGIN_FAILURE':
      return 'error';
    default:
      return 'neutral';
  }
}

export default function AuditLogPage() {
  const toast = useToast();
  const [logs, setLogs] = useState<any[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Filters
  const [adminUserFilter, setAdminUserFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Filter options from API
  const [filterOptions, setFilterOptions] = useState<{
    entities: string[];
    actions: string[];
    adminUsers: { id: string; firstName: string; lastName: string }[];
  }>({ entities: [], actions: [], adminUsers: [] });

  // Load filter options on mount
  useEffect(() => {
    adminApi.getAuditFilters().then(setFilterOptions).catch(() => {});
  }, []);

  const buildParams = useCallback((): Record<string, string> => {
    const params: Record<string, string> = { page: String(page), limit: '20' };
    if (adminUserFilter) params.adminUserId = adminUserFilter;
    if (entityFilter) params.entity = entityFilter;
    if (actionFilter) params.action = actionFilter;
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    if (search) params.search = search;
    return params;
  }, [page, adminUserFilter, entityFilter, actionFilter, dateFrom, dateTo, search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminApi.getAuditLog(buildParams());
      setLogs(result?.data ?? []);
      setMeta(result?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 0 });
    } catch {
      toast.error('Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [adminUserFilter, entityFilter, actionFilter, dateFrom, dateTo, search]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = buildParams();
      delete params.page;
      delete params.limit;
      const blob = await adminApi.exportAuditLog(params);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Audit log exported successfully');
    } catch {
      toast.error('Failed to export audit log');
    } finally {
      setExporting(false);
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Audit Log"
        subtitle="Track all administrative actions and changes"
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Audit Log' },
        ]}
        actions={
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export CSV
          </button>
        }
      />

      {/* Filter Bar */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex flex-wrap gap-3">
          <select
            value={adminUserFilter}
            onChange={(e) => setAdminUserFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
          >
            <option value="">All Admins</option>
            {filterOptions.adminUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.firstName} {u.lastName}
              </option>
            ))}
          </select>

          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
          >
            <option value="">All Entities</option>
            {filterOptions.entities.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>

          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
          >
            <option value="">All Actions</option>
            {filterOptions.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="From"
            title="Date From"
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="To"
            title="Date To"
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
          />

          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by entity ID, details..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <SkeletonTable rows={8} cols={6} />
        ) : logs.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit log entries found"
            description="Try adjusting your filters or check back later."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30">
                  <tr>
                    {['', 'Date/Time', 'Admin', 'Action', 'Entity', 'Entity ID', 'IP Address'].map(
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
                  {logs.map((log: any) => (
                    <>
                      <tr
                        key={log.id}
                        onClick={() => toggleRow(log.id)}
                        className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3 w-8">
                          {expandedRow === log.id ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-brand-gold/20 flex items-center justify-center text-xs font-bold text-brand-gold">
                              {log.adminUser?.firstName?.[0] ?? '?'}
                              {log.adminUser?.lastName?.[0] ?? ''}
                            </div>
                            <span className="font-medium">
                              {log.adminUser
                                ? `${log.adminUser.firstName} ${log.adminUser.lastName}`
                                : log.adminUserId ?? 'System'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={getActionBadgeVariant(log.action)}>
                            {log.action}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-medium">{log.entity ?? '-'}</td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                          {log.entityId ? log.entityId.slice(0, 8) + '...' : '-'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{log.ipAddress ?? '-'}</td>
                      </tr>
                      {expandedRow === log.id && (
                        <tr key={`${log.id}-details`} className="border-b border-border/50">
                          <td colSpan={7} className="px-4 py-4 bg-muted/10">
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Full Details
                              </p>
                              {log.entityId && (
                                <p className="text-sm">
                                  <span className="text-muted-foreground">Entity ID: </span>
                                  <span className="font-mono">{log.entityId}</span>
                                </p>
                              )}
                              <pre className="text-xs bg-background border border-border rounded-lg p-4 overflow-x-auto max-h-64 overflow-y-auto">
                                {JSON.stringify(log.details ?? log.changes ?? log, null, 2)}
                              </pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Showing {((meta.page - 1) * meta.limit) + 1}
                {' '}-{' '}
                {Math.min(meta.page * meta.limit, meta.total)} of {meta.total} entries
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={meta.page <= 1}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-sm text-muted-foreground">
                  Page {meta.page} of {meta.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                  disabled={meta.page >= meta.totalPages}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

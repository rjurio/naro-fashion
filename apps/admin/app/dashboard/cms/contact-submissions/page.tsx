'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageSquare, Mail, Phone, Clock, Search, Filter,
  CheckCircle2, AlertCircle, XCircle, Eye, Trash2,
  Send, ChevronDown, RefreshCw, X, User,
} from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';

const STATUS_OPTIONS = ['ALL', 'PENDING', 'IN_PROGRESS', 'CLOSED', 'UNATTENDED'];

const statusConfig: Record<string, { label: string; variant: 'warning' | 'info' | 'success' | 'error' | 'neutral' }> = {
  PENDING: { label: 'Pending', variant: 'warning' },
  IN_PROGRESS: { label: 'In Progress', variant: 'info' },
  CLOSED: { label: 'Closed', variant: 'success' },
  UNATTENDED: { label: 'Unattended', variant: 'error' },
};

interface Submission {
  id: string;
  name: string;
  email: string;
  phone?: string;
  subject?: string;
  message: string;
  status: string;
  adminReply?: string;
  repliedAt?: string;
  createdAt: string;
}

export default function ContactSubmissionsPage() {
  const { toast: showToast } = useToast();
  const confirm = useConfirm();

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, inProgress: 0, closed: 0, unattended: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [selected, setSelected] = useState<Submission | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [subs, st] = await Promise.all([
        adminApi.getContactSubmissions(filterStatus === 'ALL' ? undefined : filterStatus),
        adminApi.getContactSubmissionStats(),
      ]);
      setSubmissions(subs);
      setStats(st);
    } catch {
      showToast('Failed to load contact submissions', 'error');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, showToast]);

  useEffect(() => { load(); }, [load]);

  const filtered = submissions.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase()) ||
      (s.subject || '').toLowerCase().includes(search.toLowerCase()) ||
      s.message.toLowerCase().includes(search.toLowerCase()),
  );

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await adminApi.updateContactStatus(id, status);
      showToast('Status updated', 'success');
      if (selected?.id === id) setSelected((prev) => prev ? { ...prev, status } : null);
      load();
    } catch {
      showToast('Failed to update status', 'error');
    }
  };

  const handleReply = async () => {
    if (!selected || !replyText.trim()) return;
    setReplying(true);
    try {
      await adminApi.replyToContact(selected.id, replyText.trim());
      showToast('Reply sent successfully', 'success');
      setReplyText('');
      setSelected((prev) => prev ? { ...prev, adminReply: replyText.trim(), status: 'CLOSED' } : null);
      load();
    } catch {
      showToast('Failed to send reply', 'error');
    } finally {
      setReplying(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ title: 'Delete Submission', message: 'Are you sure you want to permanently delete this submission?' });
    if (!ok) return;
    try {
      await adminApi.deleteContactSubmission(id);
      showToast('Submission deleted', 'success');
      if (selected?.id === id) setSelected(null);
      load();
    } catch {
      showToast('Failed to delete submission', 'error');
    }
  };

  const openDetail = (sub: Submission) => {
    setSelected(sub);
    setReplyText('');
    // Auto-mark PENDING as IN_PROGRESS when opened
    if (sub.status === 'PENDING') {
      handleStatusChange(sub.id, 'IN_PROGRESS');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contact Submissions"
        subtitle="Manage messages submitted through the contact form"
        breadcrumbs={[{ label: 'CMS' }, { label: 'Contact Submissions' }]}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: stats.total, icon: MessageSquare, color: 'text-foreground' },
          { label: 'Pending', value: stats.pending, icon: Clock, color: 'text-amber-500' },
          { label: 'In Progress', value: stats.inProgress, icon: RefreshCw, color: 'text-blue-500' },
          { label: 'Closed', value: stats.closed, icon: CheckCircle2, color: 'text-emerald-500' },
          { label: 'Unattended', value: stats.unattended, icon: AlertCircle, color: 'text-red-500' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
              <span className="text-xs text-muted-foreground">{stat.label}</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name, email, subject..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
          <select
            title="Filter by status"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold-500"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === 'ALL' ? 'All Statuses' : statusConfig[s]?.label || s}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-background text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold-500 border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <MessageSquare className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No contact submissions found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Name / Email</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Subject</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((sub) => (
                  <tr key={sub.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-gold-500/10 flex items-center justify-center shrink-0">
                          <User className="h-4 w-4 text-gold-500" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{sub.name}</p>
                          <p className="text-xs text-muted-foreground">{sub.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-foreground font-medium">{sub.subject || 'General Inquiry'}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1">{sub.message}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(sub.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      <br />
                      {new Date(sub.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3">
                      <StatusDropdown
                        currentStatus={sub.status}
                        onChange={(s) => handleStatusChange(sub.id, s)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openDetail(sub)}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="View & Reply"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(sub.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
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

      {/* Detail Modal */}
      {selected && (
        <Modal
          isOpen={!!selected}
          onClose={() => setSelected(null)}
          title="Contact Submission"
          size="lg"
        >
          <div className="space-y-5">
            {/* Header info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border">
                <User className="h-4 w-4 text-gold-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">From</p>
                  <p className="font-medium text-foreground text-sm">{selected.name}</p>
                  <a href={`mailto:${selected.email}`} className="text-xs text-gold-500 hover:underline">{selected.email}</a>
                  {selected.phone && <p className="text-xs text-muted-foreground mt-0.5">{selected.phone}</p>}
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border">
                <Clock className="h-4 w-4 text-gold-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Received</p>
                  <p className="text-sm text-foreground">
                    {new Date(selected.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(selected.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            </div>

            {/* Subject */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Subject</p>
              <p className="text-sm font-medium text-foreground">{selected.subject || 'General Inquiry'}</p>
            </div>

            {/* Message */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Message</p>
              <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {selected.message}
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center gap-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status:</p>
              <StatusDropdown
                currentStatus={selected.status}
                onChange={(s) => handleStatusChange(selected.id, s)}
              />
            </div>

            {/* Existing reply */}
            {selected.adminReply && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  Your Reply {selected.repliedAt && `— ${new Date(selected.repliedAt).toLocaleDateString('en-GB')}`}
                </p>
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-4 text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {selected.adminReply}
                </div>
              </div>
            )}

            {/* Reply form */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {selected.adminReply ? 'Send Another Reply' : 'Send Reply'}
              </p>
              <textarea
                rows={4}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type your reply to the customer..."
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20 resize-y placeholder:text-muted-foreground/60"
              />
              <div className="flex items-center gap-3 mt-3">
                <button
                  type="button"
                  onClick={handleReply}
                  disabled={!replyText.trim() || replying}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gold-500 text-white text-sm font-medium hover:bg-gold-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {replying ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {replying ? 'Sending...' : 'Send Reply'}
                </button>
                <p className="text-xs text-muted-foreground">
                  Reply will be emailed to {selected.email}
                </p>
              </div>
            </div>

            {/* Delete */}
            <div className="pt-2 border-t border-border flex justify-end">
              <button
                type="button"
                onClick={() => handleDelete(selected.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Delete Submission
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StatusDropdown({ currentStatus, onChange }: { currentStatus: string; onChange: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const config = statusConfig[currentStatus] || { label: currentStatus, variant: 'neutral' as const };

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((v) => !v);
  };

  return (
    <div>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-1.5 text-xs"
      >
        <Badge variant={config.variant}>{config.label}</Badge>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 bg-card border border-border rounded-xl shadow-lg py-1 min-w-[140px]"
            style={{ top: pos.top, left: pos.left }}
          >
            {Object.entries(statusConfig).map(([key, val]) => (
              <button
                key={key}
                type="button"
                onClick={() => { onChange(key); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 flex items-center gap-2 transition-colors"
              >
                <Badge variant={val.variant}>{val.label}</Badge>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

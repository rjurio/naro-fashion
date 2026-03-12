'use client';

import { useState, useEffect } from 'react';
import {
  Search, CalendarClock, AlertTriangle, ClipboardCheck, Loader2,
  ChevronDown, ChevronUp, CheckCircle2, Circle, ClipboardList, Plus,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { adminApi } from '@/lib/api';

interface Rental {
  id: string;
  rentalNumber?: string;
  customer: string;
  item: string;
  startDate: string;
  endDate: string;
  total: string;
  deposit: string;
  status: string;
  idVerified: boolean;
  [key: string]: unknown;
}

interface ChecklistEntry {
  id: string;
  label: string;
  itemType: string;
  isChecked: boolean;
  checkedAt: string | null;
  checkedBy: { id: string; firstName: string; lastName: string } | null;
  notes: string | null;
  sortOrder: number;
}

interface Template {
  id: string;
  name: string;
  isActive: boolean;
  items: { itemType: string }[];
}

type TabKey = 'active' | 'requests' | 'overdue';

const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'active', label: 'Active Rentals', icon: CalendarClock },
  { key: 'requests', label: 'Requests', icon: ClipboardCheck },
  { key: 'overdue', label: 'Overdue', icon: AlertTriangle },
];

function ChecklistSection({ rentalId }: { rentalId: string }) {
  const [entries, setEntries] = useState<ChecklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await adminApi.getRentalChecklist(rentalId);
        setEntries(Array.isArray(data) ? data : []);
      } catch {
        setEntries([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [rentalId]);

  const loadTemplates = async () => {
    if (templates.length > 0) {
      setShowAssign(true);
      return;
    }
    try {
      const data = await adminApi.getActiveChecklistTemplates();
      setTemplates(Array.isArray(data) ? data : []);
      setShowAssign(true);
    } catch {
      setTemplates([]);
      setShowAssign(true);
    }
  };

  const handleAssign = async (templateId: string) => {
    setAssigning(true);
    try {
      const newEntries = await adminApi.assignChecklist(rentalId, templateId);
      setEntries(Array.isArray(newEntries) ? newEntries : []);
      setShowAssign(false);
    } catch (err) {
      console.error('Failed to assign checklist:', err);
      alert('Failed to assign template. It may be inactive or have no items.');
    } finally {
      setAssigning(false);
    }
  };

  const handleToggleItem = async (entry: ChecklistEntry) => {
    try {
      if (entry.isChecked) {
        const updated = await adminApi.uncheckItem(entry.id);
        setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, ...updated } : e)));
      } else {
        const updated = await adminApi.checkItem(entry.id);
        setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, ...updated } : e)));
      }
    } catch (err) {
      console.error('Failed to toggle item:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-brand-gold" />
      </div>
    );
  }

  const dispatchItems = entries.filter((e) => e.itemType === 'DISPATCH');
  const returnItems = entries.filter((e) => e.itemType === 'RETURN');

  const renderGroup = (title: string, items: ChecklistEntry[], color: string) => {
    if (items.length === 0) return null;
    const checked = items.filter((i) => i.isChecked).length;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className={`text-sm font-semibold ${color}`}>{title}</h4>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {checked}/{items.length} completed
          </span>
        </div>
        <div className="w-full bg-[hsl(var(--muted))] rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all ${
              title === 'Dispatch' ? 'bg-blue-500' : 'bg-purple-500'
            }`}
            style={{ width: `${items.length > 0 ? (checked / items.length) * 100 : 0}%` }}
          />
        </div>
        <ul className="space-y-1.5">
          {items.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 group">
              <button
                onClick={() => handleToggleItem(entry)}
                className="mt-0.5 flex-shrink-0"
              >
                {entry.isChecked ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : (
                  <Circle className="w-5 h-5 text-[hsl(var(--muted-foreground))] group-hover:text-brand-gold transition-colors" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${entry.isChecked ? 'line-through text-[hsl(var(--muted-foreground))]' : 'text-[hsl(var(--foreground))]'}`}>
                  {entry.label}
                </span>
                {entry.isChecked && entry.checkedBy && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    by {entry.checkedBy.firstName} {entry.checkedBy.lastName}
                    {entry.checkedAt && ` · ${new Date(entry.checkedAt).toLocaleString()}`}
                  </p>
                )}
                {entry.notes && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))] italic">{entry.notes}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {entries.length === 0 ? (
        <div className="text-center py-4">
          <ClipboardList className="w-8 h-8 mx-auto text-[hsl(var(--muted-foreground))] mb-2" />
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-3">No checklist assigned yet</p>
          <Button onClick={loadTemplates} className="text-sm">
            <Plus className="w-4 h-4" />
            Assign Checklist Template
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {renderGroup('Dispatch', dispatchItems, 'text-blue-600 dark:text-blue-400')}
            {renderGroup('Return', returnItems, 'text-purple-600 dark:text-purple-400')}
          </div>
          <div className="pt-2 border-t border-[hsl(var(--border))]">
            <button
              onClick={loadTemplates}
              className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] underline"
            >
              Assign additional checklist template
            </button>
          </div>
        </>
      )}

      {/* Template selector */}
      {showAssign && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">Select Active Template</h4>
            <button
              onClick={() => setShowAssign(false)}
              className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              Cancel
            </button>
          </div>
          {templates.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No active templates available. Create and activate templates in the Checklists page.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {templates.map((t) => {
                const dispatchCount = (t.items || []).filter((i) => i.itemType === 'DISPATCH').length;
                const returnCount = (t.items || []).filter((i) => i.itemType === 'RETURN').length;
                return (
                  <button
                    key={t.id}
                    onClick={() => handleAssign(t.id)}
                    disabled={assigning}
                    className="flex items-center gap-3 p-3 rounded-lg border border-[hsl(var(--border))] hover:border-brand-gold hover:bg-brand-gold/5 transition-colors text-left"
                  >
                    <ClipboardList className="w-5 h-5 text-brand-gold flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[hsl(var(--foreground))] truncate">{t.name}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        {dispatchCount > 0 && `${dispatchCount} dispatch`}
                        {dispatchCount > 0 && returnCount > 0 && ' · '}
                        {returnCount > 0 && `${returnCount} return`}
                        {dispatchCount === 0 && returnCount === 0 && 'No items'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RentalsPage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRentalId, setExpandedRentalId] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchRentals = async () => {
      try {
        setLoading(true);
        const data = await adminApi.getRentals();
        setRentals(Array.isArray(data) ? data : data?.data || data?.rentals || []);
      } catch (err) {
        console.error('Failed to fetch rentals:', err);
        setRentals([]);
      } finally {
        setLoading(false);
      }
    };
    fetchRentals();
  }, []);

  const handleStatusUpdate = async (rentalId: string, newStatus: string) => {
    try {
      await adminApi.updateRentalStatus(rentalId, newStatus);
      setRentals((prev) =>
        prev.map((r) => (r.id === rentalId ? { ...r, status: newStatus } : r))
      );
    } catch (err) {
      console.error('Failed to update rental status:', err);
    }
  };

  const filteredRentals = rentals.filter((r) => {
    const matchesSearch =
      (r.customer || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.item || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.id || '').toLowerCase().includes(searchQuery.toLowerCase());

    if (activeTab === 'active') return matchesSearch && r.status === 'Active';
    if (activeTab === 'requests') return matchesSearch && r.status === 'Pending';
    if (activeTab === 'overdue') return matchesSearch && r.status === 'Overdue';
    return matchesSearch;
  });

  const activeCounts = {
    active: rentals.filter((r) => r.status === 'Active').length,
    requests: rentals.filter((r) => r.status === 'Pending').length,
    overdue: rentals.filter((r) => r.status === 'Overdue').length,
  };

  const statusColors: Record<string, string> = {
    Active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
    Pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    Overdue: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    Returned: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Rentals</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
          Manage rental bookings, returns, and overdue items
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[hsl(var(--border))]">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-brand-gold text-brand-gold'
                : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--border))]'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            <span
              className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-medium ${
                activeTab === tab.key
                  ? 'bg-brand-gold text-white'
                  : tab.key === 'overdue' && activeCounts.overdue > 0
                    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
              }`}
            >
              {activeCounts[tab.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-[hsl(var(--muted))] rounded-lg px-3 py-2 max-w-sm">
        <Search className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
        <input
          type="text"
          placeholder="Search rentals..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-transparent border-none outline-none text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] w-full"
        />
      </div>

      {/* Rental Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : filteredRentals.length === 0 ? (
        <div className="text-center py-20">
          <CalendarClock className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
          <p className="text-[hsl(var(--muted-foreground))]">No rentals found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRentals.map((rental) => (
            <div
              key={rental.id}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden"
            >
              {/* Rental Row */}
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-[hsl(var(--accent))] transition-colors"
                onClick={() => setExpandedRentalId(expandedRentalId === rental.id ? null : rental.id)}
              >
                <div className="flex items-center gap-6 flex-1 min-w-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">
                      {rental.rentalNumber || rental.id}
                    </p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">{rental.customer}</p>
                  </div>
                  <div className="hidden sm:block min-w-0">
                    <p className="text-sm text-[hsl(var(--foreground))] truncate">{rental.item}</p>
                  </div>
                  <div className="hidden md:block text-xs text-[hsl(var(--muted-foreground))]">
                    {rental.startDate} → {rental.endDate}
                  </div>
                  <div className="hidden lg:block text-sm font-medium text-[hsl(var(--foreground))]">
                    {rental.total}
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${rental.idVerified ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {rental.idVerified ? 'ID ✓' : 'ID ✗'}
                  </span>
                  <select
                    value={rental.status}
                    onChange={(e) => { e.stopPropagation(); handleStatusUpdate(rental.id, e.target.value); }}
                    onClick={(e) => e.stopPropagation()}
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border-none outline-none cursor-pointer ${statusColors[rental.status] || ''}`}
                  >
                    <option value="Active">Active</option>
                    <option value="Pending">Pending</option>
                    <option value="Overdue">Overdue</option>
                    <option value="Returned">Returned</option>
                  </select>
                </div>
                <div className="ml-4 flex-shrink-0">
                  {expandedRentalId === rental.id ? (
                    <ChevronUp className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
                  )}
                </div>
              </div>

              {/* Expanded Checklist Section */}
              {expandedRentalId === rental.id && (
                <div className="border-t border-[hsl(var(--border))] p-5 bg-[hsl(var(--muted))]/30">
                  <div className="flex items-center gap-2 mb-4">
                    <ClipboardList className="w-4 h-4 text-brand-gold" />
                    <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                      Dispatch & Return Checklist
                    </h3>
                  </div>
                  <ChecklistSection rentalId={rental.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

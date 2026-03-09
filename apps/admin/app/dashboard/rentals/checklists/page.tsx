'use client';

import { useState, useEffect } from 'react';
import { Plus, ClipboardList, CheckCircle2, Edit2, Trash2, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import { adminApi } from '@/lib/api';

interface ChecklistItem {
  id: string;
  text: string;
  required: boolean;
}

interface ChecklistTemplate {
  id: string;
  name: string;
  type: 'DISPATCH' | 'RETURN';
  items: ChecklistItem[];
  createdAt: string;
  usageCount: number;
}

export default function ChecklistsPage() {
  const [checklists, setChecklists] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<'ALL' | 'DISPATCH' | 'RETURN'>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchChecklists = async () => {
      try {
        setLoading(true);
        const data = await adminApi.getChecklistTemplates();
        setChecklists(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to fetch checklists:', err);
        setChecklists([]);
      } finally {
        setLoading(false);
      }
    };
    fetchChecklists();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this checklist template?')) return;
    try {
      await adminApi.deleteChecklistTemplate(id);
      setChecklists((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error('Failed to delete checklist:', err);
    }
  };

  const handleCreate = async () => {
    const name = prompt('Template name:');
    if (!name) return;
    const type = prompt('Type (DISPATCH or RETURN):')?.toUpperCase();
    if (type !== 'DISPATCH' && type !== 'RETURN') {
      alert('Type must be DISPATCH or RETURN');
      return;
    }
    try {
      const created = await adminApi.createChecklistTemplate({ name, type, items: [] });
      setChecklists((prev) => [...prev, created]);
    } catch (err) {
      console.error('Failed to create checklist:', err);
    }
  };

  const filtered = checklists.filter(
    (c) => selectedType === 'ALL' || c.type === selectedType
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Checklist Templates</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Manage dispatch and return checklists for rental items
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="w-4 h-4" />
          New Template
        </Button>
      </div>

      {/* Type Filter */}
      <div className="flex gap-2">
        {(['ALL', 'DISPATCH', 'RETURN'] as const).map((type) => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedType === type
                ? 'bg-brand-gold text-white'
                : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]'
            }`}
          >
            {type === 'ALL' ? 'All' : type === 'DISPATCH' ? 'Dispatch' : 'Return'}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : (
        /* Checklist Cards */
        <div className="space-y-4">
          {filtered.map((checklist) => (
            <div
              key={checklist.id}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden"
            >
              {/* Card Header */}
              <div
                className="flex items-center justify-between p-5 cursor-pointer hover:bg-[hsl(var(--accent))] transition-colors"
                onClick={() => setExpandedId(expandedId === checklist.id ? null : checklist.id)}
              >
                <div className="flex items-center gap-4">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${
                    checklist.type === 'DISPATCH'
                      ? 'bg-blue-100 dark:bg-blue-900/30'
                      : 'bg-purple-100 dark:bg-purple-900/30'
                  }`}>
                    <ClipboardList className={`w-5 h-5 ${
                      checklist.type === 'DISPATCH'
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-purple-600 dark:text-purple-400'
                    }`} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[hsl(var(--foreground))]">{checklist.name}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        checklist.type === 'DISPATCH'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                      }`}>
                        {checklist.type}
                      </span>
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        {(checklist.items || []).length} items
                      </span>
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        Used {checklist.usageCount || 0} times
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); }}
                    className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(checklist.id); }}
                    className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-[hsl(var(--muted-foreground))] hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Expanded Items */}
              {expandedId === checklist.id && (
                <div className="border-t border-[hsl(var(--border))] p-5 bg-[hsl(var(--muted))]/50">
                  <ul className="space-y-3">
                    {(checklist.items || []).map((item) => (
                      <li key={item.id} className="flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <span className="text-sm text-[hsl(var(--foreground))]">{item.text}</span>
                          {item.required && (
                            <span className="ml-2 text-xs text-red-500 font-medium">Required</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';
import { useState, useEffect, useCallback, lazy } from 'react';
import dynamic from 'next/dynamic';
import { TrendingUp, Plus, Pencil, Trash2, RefreshCw, DollarSign } from 'lucide-react';
import adminApi from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';

const FinancialBarChart = dynamic(
  () => import('./charts').then(m => ({ default: m.FinancialBarChart })),
  { ssr: false, loading: () => <div className="h-80 bg-muted/20 rounded-xl animate-pulse" /> }
);

function formatTZS(v: number) { return `TZS ${v.toLocaleString('en')}`; }

type Tab = 'income' | 'expenses' | 'chart' | 'categories';

function getCurrentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function PLRow({ label, value, negative, bold, large, variant, badge }: any) {
  const colorClass = variant === 'positive' ? 'text-green-600' : variant === 'negative' ? 'text-red-500' : '';
  return (
    <div className={`flex items-center justify-between py-3 px-4 ${bold ? 'bg-muted/20' : ''}`}>
      <span className={`text-sm ${bold ? 'font-semibold' : 'text-muted-foreground'} ${large ? 'text-base' : ''}`}>{label}</span>
      <div className="flex items-center gap-3">
        {badge && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{badge}</span>}
        <span className={`text-sm font-medium tabular-nums ${colorClass} ${negative ? 'text-red-500' : ''} ${bold ? 'font-bold' : ''}`}>
          {negative && value > 0 ? '-' : ''}{formatTZS(Math.abs(value))}
        </span>
      </div>
    </div>
  );
}

export default function FinancialsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<Tab>('income');

  // Income Statement
  const [period, setPeriod] = useState(getCurrentPeriod());
  const [statement, setStatement] = useState<any>(null);
  const [stmtLoading, setStmtLoading] = useState(false);

  // Expenses
  const [expenses, setExpenses] = useState<any>(null);
  const [expLoading, setExpLoading] = useState(false);
  const [expPeriod, setExpPeriod] = useState(getCurrentPeriod());
  const [categories, setCategories] = useState<any[]>([]);
  const [expModal, setExpModal] = useState<{ open: boolean; expense: any | null }>({ open: false, expense: null });
  const [expForm, setExpForm] = useState({ categoryId: '', amount: '', expenseDate: '', vendor: '', description: '', receiptUrl: '' });
  const [expSaving, setExpSaving] = useState(false);

  // Chart
  const [chartYear, setChartYear] = useState(new Date().getFullYear());
  const [chartData, setChartData] = useState<any[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  // Categories
  const [catList, setCatList] = useState<any[]>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [catModal, setCatModal] = useState<{ open: boolean; cat: any | null }>({ open: false, cat: null });
  const [catForm, setCatForm] = useState({ name: '', description: '', categoryType: 'OPERATING', sortOrder: '0' });
  const [catSaving, setCatSaving] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);

  // Load income statement
  useEffect(() => {
    if (activeTab !== 'income') return;
    setStmtLoading(true);
    adminApi.getIncomeStatement(period).then(setStatement).catch(() => toast.error('Failed to load income statement')).finally(() => setStmtLoading(false));
  }, [activeTab, period]);

  // Load expenses
  const loadExpenses = useCallback(async () => {
    setExpLoading(true);
    try {
      const [year, month] = expPeriod.split('-');
      const p: Record<string, string> = { period: expPeriod };
      const data = await adminApi.getExpenses(p);
      setExpenses(data);
      const cats = await adminApi.getExpenseCategories({ isActive: 'true' });
      setCategories(cats);
    } catch {
      toast.error('Failed to load expenses');
    } finally {
      setExpLoading(false);
    }
  }, [expPeriod]);

  useEffect(() => { if (activeTab === 'expenses') loadExpenses(); }, [activeTab, loadExpenses]);

  // Load chart
  useEffect(() => {
    if (activeTab !== 'chart') return;
    setChartLoading(true);
    adminApi.getFinancialSummary(chartYear).then(setChartData).catch(() => toast.error('Failed to load chart data')).finally(() => setChartLoading(false));
  }, [activeTab, chartYear]);

  // Load expense categories
  const loadCategories = useCallback(async () => {
    setCatLoading(true);
    try {
      const data = await adminApi.getExpenseCategories({ includeDeleted: showDeleted ? 'true' : 'false' });
      setCatList(data);
    } catch {
      toast.error('Failed to load categories');
    } finally {
      setCatLoading(false);
    }
  }, [showDeleted]);

  useEffect(() => { if (activeTab === 'categories') loadCategories(); }, [activeTab, loadCategories]);

  // Expense CRUD
  const openExpModal = (expense?: any) => {
    setExpForm(expense ? {
      categoryId: expense.categoryId, amount: String(expense.amount),
      expenseDate: expense.expenseDate?.split('T')[0] ?? '', vendor: expense.vendor ?? '',
      description: expense.description ?? '', receiptUrl: expense.receiptUrl ?? '',
    } : { categoryId: '', amount: '', expenseDate: new Date().toISOString().split('T')[0], vendor: '', description: '', receiptUrl: '' });
    setExpModal({ open: true, expense: expense ?? null });
  };

  const saveExpense = async () => {
    if (!expForm.categoryId || !expForm.amount || !expForm.expenseDate) return;
    setExpSaving(true);
    try {
      const data = { categoryId: expForm.categoryId, amount: Number(expForm.amount), expenseDate: expForm.expenseDate, vendor: expForm.vendor || undefined, description: expForm.description || undefined, receiptUrl: expForm.receiptUrl || undefined };
      if (expModal.expense) await adminApi.updateExpense(expModal.expense.id, data);
      else await adminApi.createExpense(data);
      toast.success(`Expense ${expModal.expense ? 'updated' : 'recorded'}`);
      setExpModal({ open: false, expense: null });
      loadExpenses();
    } catch {
      toast.error('Failed to save expense');
    } finally {
      setExpSaving(false);
    }
  };

  const deleteExpense = async (expense: any) => {
    const ok = await confirm({ title: 'Delete Expense', message: `Delete this ${formatTZS(Number(expense.amount))} expense?`, confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await adminApi.deleteExpense(expense.id);
      toast.success('Expense deleted');
      loadExpenses();
    } catch {
      toast.error('Failed to delete expense');
    }
  };

  // Category CRUD
  const openCatModal = (cat?: any) => {
    setCatForm(cat ? { name: cat.name, description: cat.description ?? '', categoryType: cat.categoryType, sortOrder: String(cat.sortOrder) } : { name: '', description: '', categoryType: 'OPERATING', sortOrder: '0' });
    setCatModal({ open: true, cat: cat ?? null });
  };

  const saveCat = async () => {
    if (!catForm.name) return;
    setCatSaving(true);
    try {
      if (catModal.cat) await adminApi.updateExpenseCategory(catModal.cat.id, { ...catForm, sortOrder: Number(catForm.sortOrder) });
      else await adminApi.createExpenseCategory({ ...catForm, sortOrder: Number(catForm.sortOrder) });
      toast.success(`Category ${catModal.cat ? 'updated' : 'created'}`);
      setCatModal({ open: false, cat: null });
      loadCategories();
    } catch (e: any) {
      const msg = e.message?.includes('409') || e.message?.includes('Conflict') ? 'A category with this name already exists' : 'Failed to save category';
      toast.error(msg);
    } finally {
      setCatSaving(false);
    }
  };

  const toggleCat = async (cat: any) => {
    try {
      await adminApi.toggleExpenseCategory(cat.id);
      toast.success(`Category ${cat.isActive ? 'deactivated' : 'activated'}`);
      loadCategories();
    } catch {
      toast.error('Failed to toggle category');
    }
  };

  const deleteCat = async (cat: any) => {
    const ok = await confirm({ title: 'Delete Category', message: `Delete "${cat.name}"?`, confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await adminApi.deleteExpenseCategory(cat.id);
      toast.success('Category deleted');
      loadCategories();
    } catch {
      toast.error('Failed to delete category');
    }
  };

  const restoreCat = async (cat: any) => {
    try {
      await adminApi.restoreExpenseCategory(cat.id);
      toast.success('Category restored');
      loadCategories();
    } catch {
      toast.error('Failed to restore category');
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'income', label: 'Income Statement' },
    { key: 'expenses', label: 'Expenses' },
    { key: 'chart', label: 'Revenue vs Expenses' },
    { key: 'categories', label: 'Expense Categories' },
  ];

  const periodYears = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);
  const periodMonths = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Financial Management"
        subtitle="Income statements, expenses, and financial analysis"
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Financials' }]}
      />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-border overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors ${activeTab === t.key ? 'text-brand-gold border-b-2 border-brand-gold' : 'text-muted-foreground hover:text-foreground'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Income Statement */}
        {activeTab === 'income' && (
          <div className="p-6 space-y-4">
            {/* Period selector */}
            <div className="flex items-center gap-3">
              <select value={period.split('-')[0]} onChange={e => setPeriod(`${e.target.value}-${period.split('-')[1]}`)}
                className="px-3 py-2 text-sm bg-background border border-border rounded-lg">
                {periodYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select value={period.split('-')[1]} onChange={e => setPeriod(`${period.split('-')[0]}-${e.target.value}`)}
                className="px-3 py-2 text-sm bg-background border border-border rounded-lg">
                {periodMonths.map((m, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
              </select>
              {statement && (
                <Badge variant={statement.periodStatus === 'OPEN' ? 'success' : statement.periodStatus === 'CLOSED' ? 'neutral' : 'warning'}>
                  {statement.periodStatus}
                </Badge>
              )}
            </div>

            {stmtLoading ? (
              <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-10 bg-muted/20 rounded animate-pulse" />)}</div>
            ) : statement ? (
              <div className="border border-border rounded-xl divide-y divide-border">
                {/* Revenue */}
                <div className="border-l-4 border-brand-gold">
                  <div className="px-4 py-2 bg-brand-gold/5"><p className="text-xs font-semibold text-brand-gold uppercase tracking-wide">Revenue</p></div>
                  <PLRow label="Sales Revenue" value={statement.salesRevenue} />
                  <PLRow label="Rental Revenue" value={statement.rentalRevenue} />
                  <PLRow label="Total Revenue" value={statement.totalRevenue} bold />
                </div>
                {/* COGS */}
                <div>
                  <PLRow label="Cost of Goods Sold (COGS)" value={statement.cogs} negative />
                  <PLRow label="Gross Profit" value={statement.grossProfit} bold badge={`Gross Margin: ${statement.grossMargin}`} />
                </div>
                {/* Expenses */}
                <div>
                  <div className="px-4 py-2 bg-muted/10"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Operating Expenses</p></div>
                  {(statement.expenses ?? []).map((e: any) => (
                    <PLRow key={e.category} label={e.category} value={e.amount} negative />
                  ))}
                  <PLRow label="Total Operating Expenses" value={statement.totalExpenses} negative bold />
                </div>
                {/* Net Profit */}
                <div className={statement.netProfit >= 0 ? 'bg-green-50 dark:bg-green-950/30' : 'bg-red-50 dark:bg-red-950/30'}>
                  <PLRow label="Net Profit / (Loss)" value={statement.netProfit} bold large
                    variant={statement.netProfit >= 0 ? 'positive' : 'negative'}
                    badge={`Net Margin: ${statement.netMargin}`} />
                </div>
              </div>
            ) : (
              <EmptyState icon={TrendingUp} title="No financial data for this period" />
            )}
          </div>
        )}

        {/* Expenses */}
        {activeTab === 'expenses' && (
          <div>
            <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
              <div className="flex gap-2">
                <select value={expPeriod.split('-')[0]} onChange={e => setExpPeriod(`${e.target.value}-${expPeriod.split('-')[1]}`)}
                  className="px-3 py-2 text-sm bg-background border border-border rounded-lg">
                  {periodYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select value={expPeriod.split('-')[1]} onChange={e => setExpPeriod(`${expPeriod.split('-')[0]}-${e.target.value}`)}
                  className="px-3 py-2 text-sm bg-background border border-border rounded-lg">
                  {periodMonths.map((m, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                {expenses && <span className="text-sm text-muted-foreground">Total: <strong>{formatTZS(expenses.data?.reduce((s: number, e: any) => s + Number(e.amount), 0) ?? 0)}</strong></span>}
                <button onClick={() => openExpModal()} className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors">
                  <Plus className="w-4 h-4" /> Add Expense
                </button>
              </div>
            </div>
            {expLoading ? <SkeletonTable rows={5} cols={6} /> : !expenses || expenses.data?.length === 0 ? (
              <EmptyState icon={DollarSign} title="No expenses recorded" description="Start tracking your business expenses." actionLabel="Record Expense" onAction={() => openExpModal()} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/30">
                    <tr>{['Date', 'Category', 'Vendor', 'Description', 'Amount', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {expenses.data.map((e: any) => (
                      <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground">{new Date(e.expenseDate).toLocaleDateString()}</td>
                        <td className="px-4 py-3"><Badge variant="neutral">{e.category?.name ?? '—'}</Badge></td>
                        <td className="px-4 py-3 text-muted-foreground">{e.vendor ?? '—'}</td>
                        <td className="px-4 py-3 max-w-[200px] truncate text-muted-foreground">{e.description ?? '—'}</td>
                        <td className="px-4 py-3 font-medium">{formatTZS(Number(e.amount))}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <button onClick={() => openExpModal(e)} className="p-1.5 rounded hover:bg-muted transition-colors"><Pencil className="w-4 h-4 text-muted-foreground" /></button>
                            <button onClick={() => deleteExpense(e)} className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900 transition-colors"><Trash2 className="w-4 h-4 text-red-500" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Revenue vs Expenses Chart */}
        {activeTab === 'chart' && (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <select value={chartYear} onChange={e => setChartYear(Number(e.target.value))}
                className="px-3 py-2 text-sm bg-background border border-border rounded-lg">
                {periodYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {chartLoading ? <div className="h-80 bg-muted/20 rounded-xl animate-pulse" /> : (
              <FinancialBarChart data={chartData} />
            )}
            {!chartLoading && chartData.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/30">
                    <tr>{['Month', 'Revenue', 'Expenses', 'Net Profit', 'Margin'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {chartData.map((row: any) => {
                      const margin = parseFloat(row.netMargin);
                      return (
                        <tr key={row.month} className="border-b border-border/50">
                          <td className="px-4 py-2 font-medium">{row.monthName}</td>
                          <td className="px-4 py-2">{formatTZS(row.revenue)}</td>
                          <td className="px-4 py-2 text-red-500">{formatTZS(row.expenses)}</td>
                          <td className={`px-4 py-2 font-medium ${row.netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>{formatTZS(row.netProfit)}</td>
                          <td className="px-4 py-2">
                            <span className={`text-xs font-medium ${margin > 20 ? 'text-green-600' : margin >= 5 ? 'text-amber-600' : 'text-red-500'}`}>{row.netMargin}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Expense Categories */}
        {activeTab === 'categories' && (
          <div>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={showDeleted} onChange={e => setShowDeleted(e.target.checked)} className="rounded" />
                  Show deleted
                </label>
              </div>
              <button onClick={() => openCatModal()} className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors">
                <Plus className="w-4 h-4" /> Add Category
              </button>
            </div>
            {catLoading ? <SkeletonTable rows={8} cols={5} /> : catList.length === 0 ? (
              <EmptyState title="No expense categories" actionLabel="Add Category" onAction={() => openCatModal()} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/30">
                    <tr>{['Name', 'Type', 'Sort Order', 'Status', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {catList.map((cat: any) => (
                      <tr key={cat.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${cat.deletedAt ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3 font-medium">{cat.name}</td>
                        <td className="px-4 py-3"><Badge variant={cat.categoryType === 'COGS' ? 'info' : cat.categoryType === 'TAX' ? 'warning' : cat.categoryType === 'OTHER' ? 'neutral' : 'gold'}>{cat.categoryType}</Badge></td>
                        <td className="px-4 py-3 text-muted-foreground">{cat.sortOrder}</td>
                        <td className="px-4 py-3"><Badge variant={cat.isActive ? 'success' : 'neutral'}>{cat.isActive ? 'Active' : 'Inactive'}</Badge></td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {!cat.deletedAt ? (
                              <>
                                <button onClick={() => openCatModal(cat)} className="p-1.5 rounded hover:bg-muted transition-colors"><Pencil className="w-4 h-4 text-muted-foreground" /></button>
                                <button onClick={() => toggleCat(cat)} className="p-1.5 rounded hover:bg-muted transition-colors"><RefreshCw className="w-4 h-4 text-muted-foreground" /></button>
                                <button onClick={() => deleteCat(cat)} className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900 transition-colors"><Trash2 className="w-4 h-4 text-red-500" /></button>
                              </>
                            ) : (
                              <button onClick={() => restoreCat(cat)} className="text-xs text-brand-gold hover:underline px-2 py-1">Restore</button>
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
        )}
      </div>

      {/* Expense Modal */}
      <Modal isOpen={expModal.open} onClose={() => setExpModal({ open: false, expense: null })} title={expModal.expense ? 'Edit Expense' : 'Record Expense'} size="md"
        footer={
          <>
            <button onClick={() => setExpModal({ open: false, expense: null })} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors">Cancel</button>
            <button onClick={saveExpense} disabled={expSaving} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors disabled:opacity-50">
              {expSaving ? 'Saving...' : 'Save Expense'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Category" required>
            <select value={expForm.categoryId} onChange={e => setExpForm(f => ({ ...f, categoryId: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50">
              <option value="">Select category...</option>
              {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Amount (TZS)" required>
              <input type="number" value={expForm.amount} onChange={e => setExpForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50" />
            </FormField>
            <FormField label="Date" required>
              <input type="date" value={expForm.expenseDate} onChange={e => setExpForm(f => ({ ...f, expenseDate: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50" />
            </FormField>
          </div>
          <FormField label="Vendor / Supplier">
            <input type="text" value={expForm.vendor} onChange={e => setExpForm(f => ({ ...f, vendor: e.target.value }))}
              placeholder="e.g. TANESCO, Vodacom"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50" />
          </FormField>
          <FormField label="Description">
            <textarea value={expForm.description} onChange={e => setExpForm(f => ({ ...f, description: e.target.value }))} rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50 resize-none" />
          </FormField>
          <FormField label="Receipt URL" hint="Optional: paste link to scanned receipt">
            <input type="url" value={expForm.receiptUrl} onChange={e => setExpForm(f => ({ ...f, receiptUrl: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50" />
          </FormField>
        </div>
      </Modal>

      {/* Category Modal */}
      <Modal isOpen={catModal.open} onClose={() => setCatModal({ open: false, cat: null })} title={catModal.cat ? 'Edit Category' : 'Add Expense Category'} size="sm"
        footer={
          <>
            <button onClick={() => setCatModal({ open: false, cat: null })} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors">Cancel</button>
            <button onClick={saveCat} disabled={catSaving} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors disabled:opacity-50">
              {catSaving ? 'Saving...' : catModal.cat ? 'Save Changes' : 'Create Category'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Category Name" required hint="Must be unique">
            <input type="text" value={catForm.name} onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50" />
          </FormField>
          <FormField label="Type">
            <select value={catForm.categoryType} onChange={e => setCatForm(f => ({ ...f, categoryType: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50">
              <option value="OPERATING">Operating</option>
              <option value="COGS">Cost of Goods Sold</option>
              <option value="TAX">Tax</option>
              <option value="OTHER">Other</option>
            </select>
          </FormField>
          <FormField label="Description">
            <input type="text" value={catForm.description} onChange={e => setCatForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50" />
          </FormField>
          <FormField label="Sort Order" hint="Lower number = appears first">
            <input type="number" value={catForm.sortOrder} onChange={e => setCatForm(f => ({ ...f, sortOrder: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50" />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}

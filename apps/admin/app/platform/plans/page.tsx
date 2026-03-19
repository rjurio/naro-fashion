'use client';

import { useState, useEffect } from 'react';
import { Plus, Edit2, CreditCard } from 'lucide-react';
import adminApi from '@/lib/api';

export default function PlansPage() {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editPlan, setEditPlan] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '', description: '', priceMonthly: '', priceYearly: '',
    maxProducts: '', maxAdminUsers: '', maxStorageGB: '5',
    enabledModules: [] as string[],
  });

  useEffect(() => {
    adminApi.getSubscriptionPlans().then(setPlans).catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      ...form,
      priceMonthly: parseFloat(form.priceMonthly),
      priceYearly: form.priceYearly ? parseFloat(form.priceYearly) : null,
      maxProducts: form.maxProducts ? parseInt(form.maxProducts) : null,
      maxAdminUsers: form.maxAdminUsers ? parseInt(form.maxAdminUsers) : null,
      maxStorageGB: parseInt(form.maxStorageGB),
    };
    if (editPlan) {
      await adminApi.updateSubscriptionPlan(editPlan.id, data);
    } else {
      await adminApi.createSubscriptionPlan(data);
    }
    setShowForm(false);
    setEditPlan(null);
    const updated = await adminApi.getSubscriptionPlans();
    setPlans(updated);
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Subscription Plans</h1>
        <button onClick={() => { setEditPlan(null); setForm({ name: '', description: '', priceMonthly: '', priceYearly: '', maxProducts: '', maxAdminUsers: '', maxStorageGB: '5', enabledModules: [] }); setShowForm(true); }} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <Plus className="h-4 w-4" /> New Plan
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div key={plan.id} className="bg-[hsl(var(--card-bg))] border border-[hsl(var(--card-border))] rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-blue-600" />
                <h3 className="text-lg font-bold text-[hsl(var(--foreground))]">{plan.name}</h3>
              </div>
              <button onClick={() => { setEditPlan(plan); setForm({ name: plan.name, description: plan.description || '', priceMonthly: String(plan.priceMonthly), priceYearly: plan.priceYearly ? String(plan.priceYearly) : '', maxProducts: plan.maxProducts ? String(plan.maxProducts) : '', maxAdminUsers: plan.maxAdminUsers ? String(plan.maxAdminUsers) : '', maxStorageGB: String(plan.maxStorageGB), enabledModules: plan.enabledModules || [] }); setShowForm(true); }}>
                <Edit2 className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
              </button>
            </div>
            <p className="text-2xl font-bold text-[hsl(var(--foreground))]">TZS {Number(plan.priceMonthly).toLocaleString()}<span className="text-sm font-normal text-[hsl(var(--muted-foreground))]">/mo</span></p>
            {plan.priceYearly && <p className="text-sm text-[hsl(var(--muted-foreground))]">TZS {Number(plan.priceYearly).toLocaleString()}/year</p>}
            <div className="mt-4 space-y-1 text-sm">
              <p className="text-[hsl(var(--foreground))]">Products: {plan.maxProducts ?? 'Unlimited'}</p>
              <p className="text-[hsl(var(--foreground))]">Admin Users: {plan.maxAdminUsers ?? 'Unlimited'}</p>
              <p className="text-[hsl(var(--foreground))]">Storage: {plan.maxStorageGB}GB</p>
              <p className="text-[hsl(var(--muted-foreground))]">{plan.enabledModules?.length || 0} modules</p>
            </div>
          </div>
        ))}
      </div>

      {/* Plan Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[hsl(var(--card-bg))] rounded-lg p-6 w-full max-w-md max-h-[80vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-[hsl(var(--foreground))] mb-4">{editPlan ? 'Edit' : 'Create'} Plan</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input type="text" placeholder="Plan Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]" required />
              <input type="text" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]" />
              <div className="grid grid-cols-2 gap-3">
                <input type="number" placeholder="Monthly Price (TZS)" value={form.priceMonthly} onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })} className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]" required />
                <input type="number" placeholder="Yearly Price (TZS)" value={form.priceYearly} onChange={(e) => setForm({ ...form, priceYearly: e.target.value })} className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input type="number" placeholder="Max Products" value={form.maxProducts} onChange={(e) => setForm({ ...form, maxProducts: e.target.value })} className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]" />
                <input type="number" placeholder="Max Admins" value={form.maxAdminUsers} onChange={(e) => setForm({ ...form, maxAdminUsers: e.target.value })} className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]" />
                <input type="number" placeholder="Storage GB" value={form.maxStorageGB} onChange={(e) => setForm({ ...form, maxStorageGB: e.target.value })} className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]" required />
              </div>
              <div className="flex gap-3 mt-4">
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border border-[hsl(var(--card-border))] rounded text-[hsl(var(--foreground))]">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

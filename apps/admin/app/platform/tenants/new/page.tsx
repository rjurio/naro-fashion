'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import adminApi from '@/lib/api';

export default function NewTenantPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    domain: '',
    adminEmail: '',
    adminFirstName: '',
    adminLastName: '',
    adminPassword: '',
    planId: '',
    billingCycle: 'MONTHLY',
    companyName: '',
    colorPrimary: '#D4AF37',
    colorSecondary: '#1A1A1A',
    status: 'ACTIVE',
  });
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.getSubscriptionPlans().then(setPlans).catch(console.error);
  }, []);

  const handleSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const tenant = await adminApi.createTenant({
        ...form,
        domain: form.domain || undefined,
      });
      router.push(`/platform/tenants/${tenant.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create tenant');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Create New Tenant</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>
        )}

        {/* Company Info */}
        <div className="bg-[hsl(var(--card-bg))] border border-[hsl(var(--card-border))] rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Company Info</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Business Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value, slug: handleSlug(e.target.value), companyName: e.target.value })}
                className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">URL Slug *</label>
              <input
                type="text"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: handleSlug(e.target.value) })}
                className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Custom Domain (optional)</label>
            <input
              type="text"
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
              placeholder="shop.example.co.tz"
              className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Primary Color</label>
              <input
                type="color"
                value={form.colorPrimary}
                onChange={(e) => setForm({ ...form, colorPrimary: e.target.value })}
                className="w-full h-10"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Secondary Color</label>
              <input
                type="color"
                value={form.colorSecondary}
                onChange={(e) => setForm({ ...form, colorSecondary: e.target.value })}
                className="w-full h-10"
              />
            </div>
          </div>
        </div>

        {/* Admin User */}
        <div className="bg-[hsl(var(--card-bg))] border border-[hsl(var(--card-border))] rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">First Admin User</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">First Name *</label>
              <input
                type="text"
                value={form.adminFirstName}
                onChange={(e) => setForm({ ...form, adminFirstName: e.target.value })}
                className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Last Name *</label>
              <input
                type="text"
                value={form.adminLastName}
                onChange={(e) => setForm({ ...form, adminLastName: e.target.value })}
                className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Email *</label>
            <input
              type="email"
              value={form.adminEmail}
              onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
              className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Password *</label>
            <input
              type="password"
              value={form.adminPassword}
              onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
              className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]"
              required
              minLength={6}
            />
          </div>
        </div>

        {/* Subscription */}
        <div className="bg-[hsl(var(--card-bg))] border border-[hsl(var(--card-border))] rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Subscription</h2>
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Plan *</label>
            <select
              value={form.planId}
              onChange={(e) => setForm({ ...form, planId: e.target.value })}
              className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]"
              required
            >
              <option value="">Select a plan</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} - TZS {Number(plan.priceMonthly).toLocaleString()}/month
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Billing Cycle</label>
              <select
                value={form.billingCycle}
                onChange={(e) => setForm({ ...form, billingCycle: e.target.value })}
                className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]"
              >
                <option value="MONTHLY">Monthly</option>
                <option value="YEARLY">Yearly</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded text-[hsl(var(--foreground))]"
              >
                <option value="ACTIVE">Active</option>
                <option value="TRIAL">Trial</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex gap-4">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Tenant'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2 bg-[hsl(var(--card-bg))] border border-[hsl(var(--card-border))] rounded-lg text-[hsl(var(--foreground))]"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

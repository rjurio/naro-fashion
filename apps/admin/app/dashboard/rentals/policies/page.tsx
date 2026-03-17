'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, RotateCcw, ShieldCheck, Info, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { adminApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface PolicyValues {
  bufferDays: number;
  downPaymentPercent: number;
  lateFeePerDay: number;
  maxRentalDuration: number;
  preparationReminder: number;
}

const defaultValues: PolicyValues = {
  bufferDays: 7,
  downPaymentPercent: 25,
  lateFeePerDay: 15000,
  maxRentalDuration: 30,
  preparationReminder: 8,
};

const fields: { key: keyof PolicyValues; label: string; description: string; suffix: string; defaultVal: number }[] = [
  { key: 'bufferDays', label: 'Buffer Days Between Rentals', description: 'Minimum number of days required between the return of one rental and the start of the next for the same item.', suffix: 'days', defaultVal: 7 },
  { key: 'downPaymentPercent', label: 'Down Payment Percentage', description: 'Percentage of the total rental amount that must be paid upfront to confirm a rental reservation.', suffix: '%', defaultVal: 25 },
  { key: 'lateFeePerDay', label: 'Late Return Fee Per Day', description: 'Daily fee charged when a rental item is returned after the agreed return date.', suffix: 'TZS / day', defaultVal: 15000 },
  { key: 'maxRentalDuration', label: 'Maximum Rental Duration', description: 'The longest period a customer can rent a single item in one transaction.', suffix: 'days', defaultVal: 30 },
  { key: 'preparationReminder', label: 'Advance Preparation Reminder', description: 'System will send daily reminders starting this many days before pickup.', suffix: 'days before pickup', defaultVal: 8 },
];

export default function RentalPoliciesPage() {
  const [values, setValues] = useState<PolicyValues>({ ...defaultValues });
  const [originalValues, setOriginalValues] = useState<PolicyValues>({ ...defaultValues });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const fetchPolicies = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminApi.getRentalPolicies();
      if (data) {
        const merged: PolicyValues = {
          bufferDays: data.bufferDays ?? defaultValues.bufferDays,
          downPaymentPercent: data.downPaymentPercent ?? defaultValues.downPaymentPercent,
          lateFeePerDay: data.lateFeePerDay ?? defaultValues.lateFeePerDay,
          maxRentalDuration: data.maxRentalDuration ?? defaultValues.maxRentalDuration,
          preparationReminder: data.preparationReminder ?? defaultValues.preparationReminder,
        };
        setValues(merged);
        setOriginalValues(merged);
      }
    } catch { toast.error('Failed to load rental policies'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  const isDirty = JSON.stringify(values) !== JSON.stringify(originalValues);

  const handleChange = (field: keyof PolicyValues, val: string) => {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 0) setValues({ ...values, [field]: num });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await adminApi.updateRentalPolicies(values);
      setOriginalValues({ ...values });
      toast.success('Rental policies saved');
    } catch { toast.error('Failed to save policies'); }
    finally { setSaving(false); }
  };

  const handleReset = () => { setValues({ ...defaultValues }); };

  const inputClass = 'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold';

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-brand-gold" /></div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Rental Policies</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">Configure global rental rules and pricing policies</p>
        </div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-brand-gold" />
          <span className="text-sm text-[hsl(var(--muted-foreground))]">Changes apply to all new rentals</span>
        </div>
      </div>

      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] divide-y divide-[hsl(var(--border))]">
        {fields.map((field) => (
          <div key={field.key} className="p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex-1">
                <label className="text-sm font-semibold text-[hsl(var(--foreground))]">{field.label}</label>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 max-w-lg">{field.description}</p>
              </div>
              <div className="flex items-center gap-2 sm:min-w-[200px]">
                <input type="number" value={values[field.key]} onChange={(e) => handleChange(field.key, e.target.value)} min={0} className={inputClass + ' sm:max-w-[120px]'} />
                <span className="text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">{field.suffix}</span>
              </div>
            </div>
            {values[field.key] !== field.defaultVal && (
              <div className="flex items-center gap-1.5 text-xs text-brand-gold">
                <Info className="w-3.5 h-3.5" /> Default: {field.defaultVal} {field.suffix}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-5">
        <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-3">Current Policy Summary</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div><p className="text-[hsl(var(--muted-foreground))]">Buffer</p><p className="font-medium text-[hsl(var(--foreground))]">{values.bufferDays} days</p></div>
          <div><p className="text-[hsl(var(--muted-foreground))]">Down Payment</p><p className="font-medium text-[hsl(var(--foreground))]">{values.downPaymentPercent}%</p></div>
          <div><p className="text-[hsl(var(--muted-foreground))]">Late Fee</p><p className="font-medium text-[hsl(var(--foreground))]">{formatCurrency(values.lateFeePerDay)}/day</p></div>
          <div><p className="text-[hsl(var(--muted-foreground))]">Max Duration</p><p className="font-medium text-[hsl(var(--foreground))]">{values.maxRentalDuration} days</p></div>
          <div><p className="text-[hsl(var(--muted-foreground))]">Prep Reminder</p><p className="font-medium text-[hsl(var(--foreground))]">{values.preparationReminder} days before</p></div>
        </div>
      </div>

      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pb-8">
        <Button variant="ghost" size="md" onClick={handleReset} className="gap-1.5"><RotateCcw className="w-4 h-4" /> Reset to Defaults</Button>
        <Button size="md" onClick={handleSave} disabled={!isDirty || saving} className="gap-1.5">
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Policies</>}
        </Button>
      </div>
    </div>
  );
}

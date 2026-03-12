'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, UserPlus, X, User } from 'lucide-react';
import adminApi from '../../../../lib/api';

interface Customer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

interface Props {
  selectedCustomer: Customer | null;
  customerName: string;
  customerPhone: string;
  onSelectCustomer: (customer: Customer | null) => void;
  onCustomerNameChange: (name: string) => void;
  onCustomerPhoneChange: (phone: string) => void;
}

export default function CustomerLookup({
  selectedCustomer,
  customerName,
  customerPhone,
  onSelectCustomer,
  onCustomerNameChange,
  onCustomerPhoneChange,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFirstName, setNewFirstName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchCustomers = async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    try {
      const data = await adminApi.posSearchCustomers(q);
      setResults(Array.isArray(data) ? data : []);
      setShowResults(true);
    } catch {
      setResults([]);
    }
  };

  const handleQueryChange = (q: string) => {
    setQuery(q);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => searchCustomers(q), 300);
  };

  const handleSelectCustomer = (customer: Customer) => {
    onSelectCustomer(customer);
    setQuery('');
    setShowResults(false);
  };

  const handleClearCustomer = () => {
    onSelectCustomer(null);
    onCustomerNameChange('');
    onCustomerPhoneChange('');
  };

  const handleCreateCustomer = async () => {
    if (!newFirstName || !newPhone) return;
    setCreating(true);
    try {
      const customer = await adminApi.posQuickCreateCustomer({
        firstName: newFirstName,
        phone: newPhone,
      });
      onSelectCustomer(customer);
      setShowCreateForm(false);
      setNewFirstName('');
      setNewPhone('');
    } catch (err: any) {
      alert(err.message || 'Failed to create customer');
    } finally {
      setCreating(false);
    }
  };

  if (selectedCustomer) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-brand-gold/10 rounded-lg border border-brand-gold/30">
        <User className="w-4 h-4 text-brand-gold" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[hsl(var(--foreground))] truncate">
            {selectedCustomer.firstName} {selectedCustomer.lastName}
          </p>
          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
            {selectedCustomer.phone || selectedCustomer.email}
          </p>
        </div>
        <button onClick={handleClearCustomer} className="text-[hsl(var(--muted-foreground))] hover:text-red-500">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={() => results.length > 0 && setShowResults(true)}
            placeholder="Search customer by phone/name..."
            className="w-full pl-8 pr-3 py-1.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-xs focus:outline-none focus:ring-1 focus:ring-brand-gold"
          />
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-2.5 py-1.5 rounded border border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] flex items-center gap-1"
        >
          <UserPlus className="w-3.5 h-3.5" />
          New
        </button>
      </div>

      {/* Walk-in fields */}
      {!showCreateForm && (
        <div className="flex gap-2">
          <input
            type="text"
            value={customerName}
            onChange={(e) => onCustomerNameChange(e.target.value)}
            placeholder="Walk-in name (optional)"
            className="flex-1 px-2.5 py-1.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-xs"
          />
          <input
            type="text"
            value={customerPhone}
            onChange={(e) => onCustomerPhoneChange(e.target.value)}
            placeholder="Phone (optional)"
            className="flex-1 px-2.5 py-1.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-xs"
          />
        </div>
      )}

      {/* Search Results Dropdown */}
      {showResults && results.length > 0 && (
        <div className="border border-[hsl(var(--border))] rounded-lg bg-[hsl(var(--card))] shadow-lg max-h-40 overflow-y-auto">
          {results.map((customer) => (
            <button
              key={customer.id}
              onClick={() => handleSelectCustomer(customer)}
              className="w-full text-left px-3 py-2 hover:bg-[hsl(var(--accent))] text-xs border-b border-[hsl(var(--border))] last:border-0"
            >
              <p className="font-medium text-[hsl(var(--foreground))]">
                {customer.firstName} {customer.lastName}
              </p>
              <p className="text-[hsl(var(--muted-foreground))]">
                {customer.phone} {customer.email ? `• ${customer.email}` : ''}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Quick Create Form */}
      {showCreateForm && (
        <div className="p-3 border border-brand-gold/30 rounded-lg bg-brand-gold/5 space-y-2">
          <p className="text-xs font-medium text-[hsl(var(--foreground))]">Quick Register Customer</p>
          <input
            type="text"
            value={newFirstName}
            onChange={(e) => setNewFirstName(e.target.value)}
            placeholder="First Name *"
            className="w-full px-2.5 py-1.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-xs"
          />
          <input
            type="text"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="Phone Number *"
            className="w-full px-2.5 py-1.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-xs"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreateCustomer}
              disabled={!newFirstName || !newPhone || creating}
              className="flex-1 py-1.5 rounded bg-brand-gold text-black text-xs font-medium disabled:opacity-40"
            >
              {creating ? 'Creating...' : 'Register'}
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-3 py-1.5 rounded border border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

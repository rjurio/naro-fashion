'use client';

import { useState } from 'react';
import {
  Split,
  X,
} from 'lucide-react';

interface PaymentEntry {
  method: string;
  amount: number;
  transactionRef?: string;
}

// Realistic brand logo SVGs for Tanzanian payment providers
const CashIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 40 28" className={className} fill="none">
    <rect width="40" height="28" rx="4" fill="#16A34A" />
    <rect x="2" y="2" width="36" height="24" rx="3" stroke="#15803D" strokeWidth="1" fill="none" />
    <circle cx="20" cy="14" r="7" fill="#15803D" />
    <text x="20" y="17.5" textAnchor="middle" fill="#BBF7D0" fontSize="10" fontWeight="bold" fontFamily="Arial">TZS</text>
    <line x1="6" y1="7" x2="12" y2="7" stroke="#BBF7D0" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="28" y1="21" x2="34" y2="21" stroke="#BBF7D0" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const MpesaIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 40 28" className={className} fill="none">
    <rect width="40" height="28" rx="4" fill="#E21B1B" />
    <rect x="3" y="5" width="14" height="18" rx="3" fill="white" />
    <rect x="5" y="7" width="10" height="12" rx="1" fill="#E21B1B" />
    <circle cx="8" cy="21" r="1" fill="#ccc" />
    <text x="29" y="12" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="bold" fontFamily="Arial">M-</text>
    <text x="29" y="20" textAnchor="middle" fill="#4ADE80" fontSize="7" fontWeight="bold" fontFamily="Arial">PESA</text>
  </svg>
);

const SelcomIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 40 28" className={className} fill="none">
    <rect width="40" height="28" rx="4" fill="#003B7B" />
    <circle cx="13" cy="14" r="8" fill="none" stroke="#00AEEF" strokeWidth="2.5" />
    <path d="M10 14 Q13 10 16 14 Q13 18 10 14" fill="#00AEEF" />
    <text x="29" y="17" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold" fontFamily="Arial">PAY</text>
  </svg>
);

const AirtelIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 40 28" className={className} fill="none">
    <rect width="40" height="28" rx="4" fill="#ED1C24" />
    <path d="M8 22 Q12 4 20 10 Q28 16 32 6" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" />
    <text x="20" y="25" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold" fontFamily="Arial">MONEY</text>
  </svg>
);

const MixYasIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 40 28" className={className} fill="none">
    <rect width="40" height="28" rx="4" fill="#6B21A8" />
    <text x="20" y="13" textAnchor="middle" fill="white" fontSize="8" fontWeight="900" fontFamily="Arial">MIX</text>
    <line x1="8" y1="16" x2="32" y2="16" stroke="#D4AF37" strokeWidth="1" />
    <text x="20" y="24" textAnchor="middle" fill="#D4AF37" fontSize="7" fontWeight="bold" fontFamily="Arial">by YAS</text>
  </svg>
);

const CardIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 40 28" className={className} fill="none">
    <rect width="40" height="28" rx="4" fill="#1E3A5F" />
    <rect x="0" y="6" width="40" height="5" fill="#0F172A" />
    <rect x="4" y="15" width="12" height="3" rx="1" fill="#94A3B8" />
    <rect x="4" y="20" width="8" height="2" rx="0.5" fill="#64748B" />
    <circle cx="30" cy="18" r="4" fill="#EF4444" opacity="0.8" />
    <circle cx="35" cy="18" r="4" fill="#F59E0B" opacity="0.8" />
  </svg>
);

const PAYMENT_METHODS = [
  { key: 'CASH', label: 'Cash', icon: CashIcon, requiresRef: false },
  { key: 'MPESA', label: 'M-Pesa', icon: MpesaIcon, requiresRef: true },
  { key: 'SELCOM_PESA', label: 'Selcom Pesa', icon: SelcomIcon, requiresRef: true },
  { key: 'AIRTEL_MONEY', label: 'Airtel Money', icon: AirtelIcon, requiresRef: true },
  { key: 'MIX_BY_YAS', label: 'MIX by YAS', icon: MixYasIcon, requiresRef: true },
  { key: 'CARD', label: 'Card', icon: CardIcon, requiresRef: true },
];

interface Props {
  total: number;
  onPaymentsConfirmed: (payments: PaymentEntry[]) => void;
  disabled?: boolean;
}

export default function PaymentPanel({ total, onPaymentsConfirmed, disabled }: Props) {
  const [mode, setMode] = useState<'single' | 'split'>('single');
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [transactionRef, setTransactionRef] = useState('');
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [splitPayments, setSplitPayments] = useState<PaymentEntry[]>([]);
  const [splitMethod, setSplitMethod] = useState<string | null>(null);
  const [splitAmount, setSplitAmount] = useState<number>(0);
  const [splitRef, setSplitRef] = useState('');

  const requiresRef = PAYMENT_METHODS.find((m) => m.key === selectedMethod)?.requiresRef;
  const changeDue = selectedMethod === 'CASH' ? Math.max(0, cashReceived - total) : 0;

  const splitTotal = splitPayments.reduce((s, p) => s + p.amount, 0);
  const splitRemaining = total - splitTotal;

  const handleSinglePay = () => {
    if (!selectedMethod || disabled) return;
    const amount = selectedMethod === 'CASH' ? cashReceived : total;
    if (amount < total) return;

    onPaymentsConfirmed([
      {
        method: selectedMethod,
        amount: selectedMethod === 'CASH' ? total : total,
        transactionRef: requiresRef ? transactionRef || undefined : undefined,
      },
    ]);

    // Reset
    setSelectedMethod(null);
    setTransactionRef('');
    setCashReceived(0);
  };

  const addSplitPayment = () => {
    if (!splitMethod || splitAmount <= 0) return;
    const methodInfo = PAYMENT_METHODS.find((m) => m.key === splitMethod);

    setSplitPayments([
      ...splitPayments,
      {
        method: splitMethod,
        amount: splitAmount,
        transactionRef: methodInfo?.requiresRef ? splitRef || undefined : undefined,
      },
    ]);
    setSplitMethod(null);
    setSplitAmount(0);
    setSplitRef('');
  };

  const removeSplitPayment = (index: number) => {
    setSplitPayments(splitPayments.filter((_, i) => i !== index));
  };

  const handleSplitPay = () => {
    if (splitRemaining > 0.01 || disabled) return;
    onPaymentsConfirmed(splitPayments);
    setSplitPayments([]);
    setMode('single');
  };

  return (
    <div className="space-y-3">
      {/* Mode Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode('single')}
          className={`flex-1 py-2 text-xs rounded-lg font-medium transition-colors ${
            mode === 'single'
              ? 'bg-brand-gold text-black'
              : 'bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))]'
          }`}
        >
          Single Payment
        </button>
        <button
          onClick={() => setMode('split')}
          className={`flex-1 py-2 text-xs rounded-lg font-medium transition-colors flex items-center justify-center gap-1 ${
            mode === 'split'
              ? 'bg-brand-gold text-black'
              : 'bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))]'
          }`}
        >
          <Split className="w-3 h-3" />
          Split Payment
        </button>
      </div>

      {mode === 'single' ? (
        <>
          {/* Payment Method Grid */}
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => {
                  setSelectedMethod(key);
                  if (key === 'CASH') setCashReceived(total);
                }}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                  selectedMethod === key
                    ? 'border-brand-gold bg-brand-gold/10 text-brand-gold'
                    : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-brand-gold/50'
                }`}
              >
                <Icon className="w-10 h-7 flex-shrink-0 rounded" />
                {label}
              </button>
            ))}
          </div>

          {/* Cash Input */}
          {selectedMethod === 'CASH' && (
            <div className="space-y-2">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Cash Received</label>
              <input
                type="number"
                value={cashReceived || ''}
                onChange={(e) => setCashReceived(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm"
                placeholder="Enter amount..."
                autoFocus
              />
              {changeDue > 0 && (
                <div className="flex justify-between px-3 py-2 bg-green-500/10 rounded-lg">
                  <span className="text-sm font-medium text-green-600">Change Due</span>
                  <span className="text-sm font-bold text-green-600">
                    {changeDue.toLocaleString()} TZS
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Transaction Ref Input */}
          {selectedMethod && requiresRef && (
            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">
                Transaction Reference
              </label>
              <input
                type="text"
                value={transactionRef}
                onChange={(e) => setTransactionRef(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm"
                placeholder="Enter transaction ref..."
              />
            </div>
          )}

          <button
            onClick={handleSinglePay}
            disabled={
              disabled ||
              !selectedMethod ||
              (selectedMethod === 'CASH' && cashReceived < total) ||
              total <= 0
            }
            className="w-full py-3 rounded-lg bg-brand-gold text-black font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-gold/90 transition-colors"
          >
            Complete Sale — {total.toLocaleString()} TZS
          </button>
        </>
      ) : (
        <>
          {/* Split Payments List */}
          {splitPayments.length > 0 && (
            <div className="space-y-1">
              {splitPayments.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-3 py-2 bg-[hsl(var(--accent))] rounded text-xs"
                >
                  <span className="text-[hsl(var(--foreground))]">
                    {PAYMENT_METHODS.find((m) => m.key === p.method)?.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.amount.toLocaleString()} TZS</span>
                    <button onClick={() => removeSplitPayment(i)} className="text-red-500">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex justify-between px-3 py-1 text-xs">
                <span className="text-[hsl(var(--muted-foreground))]">Remaining</span>
                <span className={splitRemaining > 0 ? 'text-amber-500 font-medium' : 'text-green-500 font-medium'}>
                  {splitRemaining > 0 ? `${splitRemaining.toLocaleString()} TZS` : 'Fully covered'}
                </span>
              </div>
            </div>
          )}

          {/* Add Split Payment */}
          <div className="space-y-2 p-3 border border-[hsl(var(--border))] rounded-lg">
            <div className="grid grid-cols-2 gap-1.5">
              {PAYMENT_METHODS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  disabled={splitRemaining <= 0}
                  onClick={() => {
                    setSplitMethod(key);
                    setSplitAmount(Math.max(0, splitRemaining));
                  }}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    splitMethod === key
                      ? 'border border-brand-gold bg-brand-gold/10 text-brand-gold'
                      : 'border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'
                  }`}
                >
                  <Icon className="w-8 h-6 flex-shrink-0 rounded-sm" />
                  {label}
                </button>
              ))}
            </div>

            {splitMethod && splitRemaining > 0 && (
              <>
                <div>
                  <input
                    type="number"
                    value={splitAmount || ''}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setSplitAmount(Math.min(val, splitRemaining));
                    }}
                    min={1}
                    max={splitRemaining}
                    className={`w-full px-3 py-2 rounded border bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm ${
                      splitAmount > splitRemaining
                        ? 'border-red-500 focus:ring-red-500'
                        : 'border-[hsl(var(--border))]'
                    }`}
                    placeholder="Amount..."
                  />
                  {splitAmount > splitRemaining && (
                    <p className="text-[10px] text-red-500 mt-1">
                      Amount cannot exceed remaining {splitRemaining.toLocaleString()} TZS
                    </p>
                  )}
                </div>
                {PAYMENT_METHODS.find((m) => m.key === splitMethod)?.requiresRef && (
                  <input
                    type="text"
                    value={splitRef}
                    onChange={(e) => setSplitRef(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm"
                    placeholder="Transaction ref..."
                  />
                )}
                <button
                  onClick={addSplitPayment}
                  disabled={splitAmount <= 0 || splitAmount > splitRemaining}
                  className="w-full py-2 rounded bg-[hsl(var(--accent))] text-[hsl(var(--foreground))] text-xs font-medium disabled:opacity-40"
                >
                  Add Payment
                </button>
              </>
            )}
          </div>

          <button
            onClick={handleSplitPay}
            disabled={disabled || splitRemaining > 0.01 || total <= 0}
            className="w-full py-3 rounded-lg bg-brand-gold text-black font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-gold/90 transition-colors"
          >
            Complete Sale — {total.toLocaleString()} TZS
          </button>
        </>
      )}
    </div>
  );
}

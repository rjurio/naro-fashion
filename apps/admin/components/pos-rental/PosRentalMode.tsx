'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, WifiOff } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';

/**
 * Walk-in POS rental mode (POS rental MVP, M4). Every action is an online API
 * call to /pos-rentals; the API enforces availability (units), the ID rule,
 * verified payments, the handover gate and permissions. Offline, the whole
 * mode is disabled: a rental is never created, paid or handed over offline.
 */
const fmt = (n: unknown) => `TZS ${Number(n ?? 0).toLocaleString('en-US')}`;
const newKey = () => `posr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const COMPONENT_LABEL: Record<string, string> = { RENTAL_FEE: 'Rental fee', DEPOSIT: 'Refundable deposit', LATE_FEE: 'Late fee' };
const METHODS = ['CASH', 'CARD', 'MPESA', 'MIX_BY_YAS', 'AIRTEL_MONEY', 'HALOPESA'];

function errMsg(e: any) {
  const missing = e?.body?.missing ?? e?.data?.missing;
  return `${e?.message || 'Request failed'}${Array.isArray(missing) ? ` (${missing.join(', ')})` : ''}`;
}

function Btn({ busy, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...p}
      disabled={busy || p.disabled}
      className={`inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-brand-gold text-white disabled:opacity-50 disabled:cursor-not-allowed ${p.className ?? ''}`}
    >
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
}
const inputCls = 'px-2 py-1.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-xs';
const card = 'rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 space-y-2';

export default function PosRentalMode({ sessionId, online }: { sessionId: string; online: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (tag: string, fn: () => Promise<void>) => {
    setBusy(tag);
    try {
      await fn();
    } catch (e: any) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  // ---------------- item + dates + quote
  const [q, setQ] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [product, setProduct] = useState<any>(null);
  const [variantId, setVariantId] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [pickupDate, setPickupDate] = useState(today);
  const [returnDate, setReturnDate] = useState('');
  const [quote, setQuote] = useState<any>(null);

  // ---------------- customer
  const [cq, setCq] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [customer, setCustomer] = useState<any>(null);
  const [showNew, setShowNew] = useState(false);
  const [nc, setNc] = useState({ firstName: '', lastName: '', phone: '', email: '', street: '', city: '', region: '' });
  const [terms, setTerms] = useState(false);
  const createKey = useRef(newKey());

  // ---------------- booking
  const [rental, setRental] = useState<any>(null);
  const [ref, setRef] = useState('');

  useEffect(() => {
    setQuote(null);
  }, [product, variantId, pickupDate, returnDate]);

  if (!online) {
    return (
      <div data-testid="rental-offline" className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
        <WifiOff className="w-6 h-6" />
        Rentals need internet: availability, ID and payments are checked online. Switch to Sale mode, or reconnect.
      </div>
    );
  }

  const refresh = async (id = rental?.id) => {
    if (id) setRental(await adminApi.posRentalDetail(id));
  };

  return (
    <div data-testid="rental-mode" className="flex-1 overflow-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* -------- left: new booking */}
      <div className="space-y-3">
        <div className={card}>
          <div className="text-sm font-semibold">1. Item, size and dates</div>
          <div className="flex gap-2">
            <input data-testid="rental-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, SKU, barcode or unit tag" className={`${inputCls} flex-1`} />
            <Btn data-testid="rental-search-go" busy={busy === 'search'} onClick={() => run('search', async () => setItems(await adminApi.posRentalCatalog(q)))}>
              <Search className="w-3.5 h-3.5" /> Find
            </Btn>
          </div>
          {items.length > 0 && (
            <ul className="max-h-40 overflow-auto text-xs divide-y divide-[hsl(var(--border))]">
              {items.map((p) => (
                <li key={p.id}>
                  <button
                    data-testid={`rental-item-${p.slug}`}
                    className={`w-full text-left px-2 py-1.5 ${product?.id === p.id ? 'bg-[hsl(var(--accent))]' : ''}`}
                    onClick={() => { setProduct(p); setVariantId(p.variants?.[0]?.id ?? ''); }}
                  >
                    {p.name} · {fmt(p.rentalPricePerDay)} {p.unitCount ? `· ${p.unitCount} unit(s)` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {product && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              <label className="flex flex-col gap-1">Size
                <select data-testid="rental-size" value={variantId} onChange={(e) => setVariantId(e.target.value)} className={inputCls}>
                  {product.variants.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">Collection date
                <input data-testid="rental-pickup" type="date" value={pickupDate} min={today} onChange={(e) => setPickupDate(e.target.value)} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">Return date
                <input data-testid="rental-return" type="date" value={returnDate} min={pickupDate} onChange={(e) => setReturnDate(e.target.value)} className={inputCls} />
              </label>
            </div>
          )}
          {product && (
            <Btn
              data-testid="rental-check"
              busy={busy === 'quote'}
              disabled={!variantId || !returnDate}
              onClick={() => run('quote', async () => setQuote(await adminApi.posRentalQuote({ productId: product.id, variantId, startDate: pickupDate, returnDate, pickupDate })))}
            >
              Check availability and amounts
            </Btn>
          )}
          {quote && (
            <div data-testid="rental-quote" className="text-xs space-y-0.5">
              <div className={quote.available ? 'text-green-700' : 'text-red-700'}>
                {quote.available ? 'Available' : `Not available (${quote.reason})`}{quote.unitManaged ? ' · by physical unit' : ''}
              </div>
              <div>Rental fee {fmt(quote.rentalFee)} · down payment {fmt(quote.downPayment)} · balance {fmt(quote.balanceAfterDownPayment)}</div>
              <div>Refundable deposit {fmt(quote.deposit)}</div>
              {/* LF-2026-11: the same sentence (incl. the cap) as the agreement and the storefront. */}
              <div data-testid="rental-quote-late-fee">{quote.lateFee?.text?.en ?? `Late fee ${fmt(quote.lateFeePerDay)} a day`}</div>
              <div className="font-semibold">Due before handover: {fmt(quote.dueBeforeHandover)}</div>
            </div>
          )}
        </div>

        <div className={card}>
          <div className="text-sm font-semibold">2. Customer</div>
          {customer ? (
            <div data-testid="rental-customer" className="text-xs flex justify-between">
              <span>{customer.firstName} {customer.lastName} · {customer.phone}{customer.email ? ` · ${customer.email}` : ''}</span>
              <button className="underline" onClick={() => setCustomer(null)}>Change</button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input data-testid="rental-customer-search" value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Phone, name or email" className={`${inputCls} flex-1`} />
                <Btn busy={busy === 'cust'} onClick={() => run('cust', async () => setCustomers(await adminApi.posRentalCustomers(cq)))}>Find</Btn>
                <button data-testid="rental-new-customer" className="text-xs underline" onClick={() => setShowNew((v) => !v)}>New customer</button>
              </div>
              {customers.map((c) => (
                <button key={c.id} className="block w-full text-left text-xs px-2 py-1 hover:bg-[hsl(var(--accent))]" onClick={() => setCustomer(c)}>
                  {c.firstName} {c.lastName} · {c.phone}
                </button>
              ))}
              {showNew && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {(['firstName', 'lastName', 'phone', 'email', 'street', 'city', 'region'] as const).map((k) => (
                    <input
                      key={k}
                      data-testid={`rental-nc-${k}`}
                      value={nc[k]}
                      onChange={(e) => setNc({ ...nc, [k]: e.target.value })}
                      placeholder={{ firstName: 'First name *', lastName: 'Last name *', phone: 'Phone *', email: 'Email (optional)', street: 'Street (needed before handover)', city: 'City', region: 'Region' }[k]}
                      className={inputCls}
                    />
                  ))}
                  <Btn
                    data-testid="rental-nc-save"
                    busy={busy === 'nc'}
                    disabled={!nc.firstName || !nc.lastName || !nc.phone}
                    onClick={() =>
                      run('nc', async () => {
                        const body = Object.fromEntries(Object.entries(nc).filter(([, v]) => v.trim()));
                        setCustomer(await adminApi.posRentalCreateCustomer(body));
                        setShowNew(false);
                      })
                    }
                  >
                    Save customer
                  </Btn>
                </div>
              )}
            </>
          )}
          <label className="flex items-start gap-2 text-xs">
            <input data-testid="rental-terms" type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <span>The customer read and accepted the rental agreement: confirmation after ID approval and any down payment; the whole fee and deposit before handover; deposit back after inspection; late fee per day; refunds reviewed and approved by the shop.</span>
          </label>
          <Btn
            data-testid="rental-book"
            busy={busy === 'book'}
            disabled={!customer || !quote?.available || !terms}
            onClick={() =>
              run('book', async () => {
                const r = await adminApi.posRentalCreate(
                  { customerId: customer.id, productId: product.id, variantId, startDate: pickupDate, returnDate, pickupDate, termsAccepted: true },
                  createKey.current,
                );
                setRental(r);
                createKey.current = newKey();
                toast(`Booking ${r.rentalNumber} created`, 'success');
              })
            }
          >
            3. Book (request; confirmed after ID + down payment)
          </Btn>
        </div>
      </div>

      {/* -------- right: the booking */}
      <div className="space-y-3">
        <div className={card}>
          <div className="flex gap-2">
            <input data-testid="rental-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Resume a booking: RNT-…" className={`${inputCls} flex-1`} />
            <Btn data-testid="rental-open" busy={busy === 'lookup'}disabled={!ref.trim()} onClick={() => run('lookup', async () => setRental(await adminApi.posRentalLookup(ref.trim())))}>Open</Btn>
          </div>
        </div>
        {rental && <BookingCard rental={rental} sessionId={sessionId} busy={busy} run={run} refresh={refresh} />}
      </div>
    </div>
  );
}

function BookingCard({ rental, sessionId, busy, run, refresh }: { rental: any; sessionId: string; busy: string | null; run: (t: string, fn: () => Promise<void>) => Promise<void>; refresh: (id?: string) => Promise<void> }) {
  const { toast } = useToast();
  const l = rental.ledger;
  const [idNumber, setIdNumber] = useState('');
  const [component, setComponent] = useState('RENTAL_FEE');
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [approval, setApproval] = useState('');
  const [addr, setAddr] = useState({ street: '', city: '', region: '' });
  const [unitCode, setUnitCode] = useState('');
  const [condition, setCondition] = useState('GOOD');
  const [retNotes, setRetNotes] = useState('');
  const [retained, setRetained] = useState('0');
  const [reason, setReason] = useState('');
  const payKey = useMemo(() => newKey(), [rental.id, l?.collected?.RENTAL_FEE, l?.collected?.DEPOSIT, l?.collected?.LATE_FEE]);
  const outWithCustomer = ['ITEM_DISPATCHED', 'ACTIVE'].includes(rental.status);
  const returned = ['RETURNED', 'INSPECTION', 'CLOSED'].includes(rental.status);

  const printAgreement = () =>
    run('agreement', async () => {
      const a = await adminApi.posRentalAgreement(rental.id);
      const w = window.open('', '_blank', 'width=720,height=900');
      if (!w) return;
      const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
      w.document.write(`<h2>${esc(a.title)} ${esc(a.rentalNumber)}</h2><p>${esc(a.agreementVersion)} · accepted ${esc(a.termsAcceptedAt)}</p>
        <p><b>${esc(a.customer.name)}</b> · ${esc(a.customer.phone)} · ${esc(a.customer.email ?? '')}<br>${esc(a.customer.address ?? 'Address: to be added before handover')}<br>National ID approved: ${a.customer.nationalIdApproved ? 'yes' : 'no'}</p>
        <p>${esc(a.item.product)} · size ${esc(a.item.size)} · unit ${esc(a.item.unit ?? '—')}</p>
        <p>Collect ${esc(String(a.dates.pickupDate).slice(0, 10))} · return ${esc(String(a.dates.returnDate).slice(0, 10))}</p>
        <p>Rental fee ${fmt(a.amounts.rentalFee)} · down payment ${fmt(a.amounts.downPayment)} · refundable deposit ${fmt(a.amounts.refundableDeposit)}</p>
        <p>${esc(a.amounts.lateFeeText?.en ?? (a.amounts.lateFeePercentPerDay != null ? `Late fee: ${a.amounts.lateFeePercentPerDay}% of the fee per day` : ''))}<br>${esc(a.amounts.lateFeeText?.sw ?? '')}</p>
        <ol>${a.terms.map((t: string) => `<li>${esc(t)}</li>`).join('')}</ol>
        <p style="margin-top:40px">Customer signature ____________________ &nbsp; Staff ____________________</p>`);
      w.document.close();
      w.print();
    });

  return (
    <div data-testid="rental-booking" className={card}>
      <div className="flex justify-between text-sm">
        <span className="font-semibold">{rental.rentalNumber}</span>
        <span data-testid="rental-status">{rental.status}</span>
      </div>
      <div className="text-xs">
        {rental.product?.name} · {rental.variant?.name} · unit {rental.rentalUnit?.code ?? '—'} · {String(rental.pickupDate).slice(0, 10)} → {String(rental.returnDate).slice(0, 10)}
      </div>
      <table className="w-full text-xs" data-testid="rental-ledger">
        <thead><tr className="text-left text-[hsl(var(--muted-foreground))]"><th></th><th>Due</th><th>Paid</th><th>Outstanding</th></tr></thead>
        <tbody>
          {['RENTAL_FEE', 'DEPOSIT', 'LATE_FEE'].map((k) => (
            <tr key={k}><td>{COMPONENT_LABEL[k]}</td><td>{fmt(l.due[k])}</td><td>{fmt(l.collected[k])}</td><td data-testid={`rental-out-${k}`}>{fmt(l.outstanding[k])}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="text-xs">National ID: <b data-testid="rental-id-state">{rental.idApproved ? 'approved' : 'not approved yet'}</b> · Address: {rental.user?.addresses?.length ? 'on file' : 'missing'}</div>

      {!rental.idApproved && (
        <div className="flex gap-2 text-xs">
          <input data-testid="rental-id-number" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="NIDA number (seen in person)" className={`${inputCls} flex-1`} />
          <Btn data-testid="rental-id-verify" busy={busy === 'id'} disabled={idNumber.length < 5} onClick={() => run('id', async () => { await adminApi.posRentalIdInPerson(rental.id, { idType: 'NATIONAL_ID', idNumber }); await refresh(); toast('ID verified in person', 'success'); })}>Verify ID in person</Btn>
        </div>
      )}

      {!['CANCELLED', 'CLOSED'].includes(rental.status) && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <select data-testid="rental-pay-component" value={component} onChange={(e) => setComponent(e.target.value)} className={inputCls}>
            {['RENTAL_FEE', 'DEPOSIT', 'LATE_FEE'].map((k) => <option key={k} value={k}>{COMPONENT_LABEL[k]}</option>)}
          </select>
          <select data-testid="rental-pay-method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
          <input data-testid="rental-pay-amount" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`max ${l.outstanding[component]}`} className={inputCls} />
          {method !== 'CASH' && (
            <>
              <input data-testid="rental-pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction / RRN reference *" className={inputCls} />
              {method === 'CARD' && <input data-testid="rental-pay-approval" value={approval} onChange={(e) => setApproval(e.target.value)} placeholder="Approval code *" className={inputCls} />}
            </>
          )}
          <Btn
            data-testid="rental-pay"
            busy={busy === 'pay'}
            disabled={!(Number(amount) > 0)}
            onClick={() =>
              run('pay', async () => {
                setAmount('');
                await adminApi.posRentalPay(
                  rental.id,
                  { component, sessionId, tenders: [{ method, amount: Number(amount), ...(method !== 'CASH' ? { transactionRef: reference, approvalCode: approval || undefined } : {}) }] },
                  payKey,
                );
                await refresh();
                toast(`${COMPONENT_LABEL[component]} payment recorded`, 'success');
              })
            }
          >
            Record payment
          </Btn>
        </div>
      )}

      {!rental.user?.addresses?.length && (
        <div className="grid grid-cols-4 gap-2 text-xs">
          {(['street', 'city', 'region'] as const).map((k) => (
            <input key={k} data-testid={`rental-addr-${k}`} value={addr[k]} onChange={(e) => setAddr({ ...addr, [k]: e.target.value })} placeholder={k} className={inputCls} />
          ))}
          <Btn data-testid="rental-addr-save" busy={busy === 'addr'} disabled={!addr.street || !addr.city || !addr.region} onClick={() => run('addr', async () => { await adminApi.posRentalAddAddress(rental.user.id, addr); await refresh(); })}>Save address</Btn>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs items-center">
        <Btn data-testid="rental-agreement" busy={busy === 'agreement'} onClick={printAgreement}>Print agreement</Btn>
        {['DOWN_PAYMENT_PAID', 'FULLY_PAID', 'READY_FOR_PICKUP'].includes(rental.status) && (
          <>
            <input data-testid="rental-unit-code" value={unitCode} onChange={(e) => setUnitCode(e.target.value)} placeholder={rental.rentalUnit ? 'Scan the unit tag' : 'Unit tag (if any)'} className={inputCls} />
            <Btn data-testid="rental-handover" busy={busy === 'handover'} onClick={() => run('handover', async () => { await adminApi.posRentalHandover(rental.id, { unitCode: unitCode || undefined }); await refresh(); toast('Handed over', 'success'); })}>Hand over</Btn>
          </>
        )}
      </div>

      {outWithCustomer && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <select data-testid="rental-return-condition" value={condition} onChange={(e) => setCondition(e.target.value)} className={inputCls}>
            {['GOOD', 'MINOR_DAMAGE', 'DAMAGED', 'MISSING_PARTS'].map((c) => <option key={c}>{c}</option>)}
          </select>
          <input value={retNotes} onChange={(e) => setRetNotes(e.target.value)} placeholder="Condition notes" className={inputCls} />
          <Btn data-testid="rental-record-return" busy={busy === 'return'} onClick={() => run('return', async () => { await adminApi.posRentalReturn(rental.id, { condition, notes: retNotes || undefined, unitStatus: condition === 'GOOD' ? 'ACTIVE' : 'MAINTENANCE' }); await refresh(); toast('Return recorded', 'success'); })}>Record return</Btn>
        </div>
      )}

      {returned && l.held.DEPOSIT > 0 && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <input data-testid="rental-dep-retained" type="number" min="0" value={retained} onChange={(e) => setRetained(e.target.value)} placeholder="Kept for damage" className={inputCls} />
          <input data-testid="rental-dep-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (inspection result) *" className={inputCls} />
          <Btn
            data-testid="rental-dep-request"
            busy={busy === 'dep'}
            disabled={!reason.trim()}
            onClick={() =>
              run('dep', async () => {
                const keep = Number(retained) || 0;
                await adminApi.rentalRefundRequest(rental.id, { kind: 'DEPOSIT_RETURN', component: 'DEPOSIT', amount: Math.max(0, l.held.DEPOSIT - keep), retainedAmount: keep, reason });
                await refresh();
                toast('Deposit return requested: a second person approves it, then finance pays it out', 'success');
              })
            }
          >
            Request deposit return
          </Btn>
        </div>
      )}
    </div>
  );
}

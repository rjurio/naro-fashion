"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  MapPin,
  Truck,
  CreditCard,
  ClipboardCheck,
  ChevronRight,
  Smartphone,
  Building2,
  Banknote,
  ArrowLeft,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { formatPrice } from "@/lib/utils";
import { cartApi, ordersApi } from "@/lib/api";

const steps = [
  { id: 1, label: "Shipping", icon: MapPin },
  { id: 2, label: "Delivery", icon: Truck },
  { id: 3, label: "Payment", icon: CreditCard },
  { id: 4, label: "Confirm", icon: ClipboardCheck },
];

const deliveryMethods = [
  { id: "standard", name: "Standard Delivery", desc: "5-7 business days", price: 5000, icon: Truck },
  { id: "express", name: "Express Delivery", desc: "1-2 business days", price: 15000, icon: Truck },
  { id: "pickup", name: "Pickup Point", desc: "Ready in 24 hours", price: 0, icon: MapPin },
];

const paymentMethods = [
  { id: "mobile", name: "Mobile Money", desc: "M-Pesa, Tigo Pesa, Airtel Money", icon: Smartphone },
  { id: "card", name: "Card Payment", desc: "Visa, Mastercard", icon: CreditCard },
  { id: "bank", name: "Bank Transfer", desc: "Direct bank transfer", icon: Building2 },
  { id: "cod", name: "Cash on Delivery", desc: "Pay when you receive", icon: Banknote },
];

export default function CheckoutPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [shipping, setShipping] = useState({
    name: "",
    phone: "",
    street: "",
    city: "",
    region: "",
  });
  const [deliveryMethod, setDeliveryMethod] = useState("standard");
  const [paymentMethod, setPaymentMethod] = useState("mobile");

  useEffect(() => {
    cartApi.get()
      .then((cart) => {
        const items = cart?.items || cart?.data?.items || [];
        setOrderItems(Array.isArray(items) ? items : []);
      })
      .catch(() => setOrderItems([]))
      .finally(() => setLoading(false));
  }, []);

  const selectedDelivery = deliveryMethods.find((d) => d.id === deliveryMethod)!;
  const subtotal = orderItems.reduce((sum, item) => {
    const price = item.product?.price || item.price || 0;
    const qty = item.quantity || 1;
    return sum + price * qty;
  }, 0);
  const shippingCost = selectedDelivery.price;
  const total = subtotal + shippingCost;

  const handleShippingChange = (field: string, value: string) => {
    setShipping((prev) => ({ ...prev, [field]: value }));
  };

  const canProceed = () => {
    if (currentStep === 1) {
      return shipping.name && shipping.phone && shipping.street && shipping.city && shipping.region;
    }
    return true;
  };

  const nextStep = () => {
    if (currentStep < 4) setCurrentStep(currentStep + 1);
  };

  const prevStep = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const handlePlaceOrder = async () => {
    setPlacing(true);
    try {
      const order = await ordersApi.create({
        addressId: "",
        paymentMethod,
        notes: `Delivery: ${deliveryMethod}. Address: ${shipping.name}, ${shipping.street}, ${shipping.city}, ${shipping.region}. Phone: ${shipping.phone}`,
      });
      router.push(`/orders/${order?.id || "confirmation"}?success=true`);
    } catch {
      alert("Failed to place order. Please try again.");
    } finally {
      setPlacing(false);
    }
  };

  const getItemName = (item: any) => item.product?.name || item.name || "Item";
  const getItemPrice = (item: any) => item.product?.price || item.price || 0;
  const getItemSize = (item: any) => item.variant?.name || item.size || "";
  const getItemImage = (item: any) => item.product?.images?.[0] || item.image || "";

  if (loading) {
    return (
      <div className="bg-background min-h-screen">
        <div className="border-b border-border">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
            <nav className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-gold-500 transition-colors">Home</Link>
              <span>/</span>
              <span className="text-foreground font-medium">Checkout</span>
            </nav>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
          <div className="animate-pulse">
            <div className="h-10 w-96 bg-muted rounded mx-auto mb-10" />
            <div className="grid lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2">
                <div className="h-64 bg-muted rounded-xl" />
              </div>
              <div className="h-80 bg-muted rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      {/* Breadcrumb */}
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">Home</Link>
            <span>/</span>
            <Link href="/cart" className="hover:text-gold-500 transition-colors">Cart</Link>
            <span>/</span>
            <span className="text-foreground font-medium">Checkout</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        {/* Step Indicator */}
        <div className="flex items-center justify-center mb-10">
          {steps.map((step, idx) => (
            <div key={step.id} className="flex items-center">
              <button
                onClick={() => step.id < currentStep && setCurrentStep(step.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  step.id === currentStep
                    ? "bg-gold-500 text-white"
                    : step.id < currentStep
                    ? "bg-gold-500/10 text-gold-500 cursor-pointer"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {step.id < currentStep ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <step.icon className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{step.label}</span>
              </button>
              {idx < steps.length - 1 && (
                <ChevronRight className="h-4 w-4 mx-1 sm:mx-2 text-muted-foreground" />
              )}
            </div>
          ))}
        </div>

        {orderItems.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground mb-4">Your cart is empty.</p>
            <Link href="/products">
              <Button>Continue Shopping</Button>
            </Link>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Main Content */}
            <div className="lg:col-span-2">
              {/* Step 1: Shipping */}
              {currentStep === 1 && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <h2 className="text-lg font-bold text-foreground mb-6">Shipping Address</h2>
                  <div className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Full Name</label>
                        <input
                          type="text"
                          value={shipping.name}
                          onChange={(e) => handleShippingChange("name", e.target.value)}
                          placeholder="Amina Hassan"
                          className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Phone Number</label>
                        <input
                          type="tel"
                          value={shipping.phone}
                          onChange={(e) => handleShippingChange("phone", e.target.value)}
                          placeholder="+255 7XX XXX XXX"
                          className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Street Address</label>
                      <input
                        type="text"
                        value={shipping.street}
                        onChange={(e) => handleShippingChange("street", e.target.value)}
                        placeholder="123 Samora Avenue"
                        className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                      />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">City</label>
                        <input
                          type="text"
                          value={shipping.city}
                          onChange={(e) => handleShippingChange("city", e.target.value)}
                          placeholder="Dar es Salaam"
                          className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Region</label>
                        <select
                          value={shipping.region}
                          onChange={(e) => handleShippingChange("region", e.target.value)}
                          className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                        >
                          <option value="">Select region</option>
                          <option value="dar-es-salaam">Dar es Salaam</option>
                          <option value="dodoma">Dodoma</option>
                          <option value="arusha">Arusha</option>
                          <option value="mwanza">Mwanza</option>
                          <option value="mbeya">Mbeya</option>
                          <option value="morogoro">Morogoro</option>
                          <option value="tanga">Tanga</option>
                          <option value="zanzibar">Zanzibar</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Delivery */}
              {currentStep === 2 && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <h2 className="text-lg font-bold text-foreground mb-6">Delivery Method</h2>
                  <div className="space-y-3">
                    {deliveryMethods.map((method) => (
                      <button
                        key={method.id}
                        onClick={() => setDeliveryMethod(method.id)}
                        className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-colors ${
                          deliveryMethod === method.id
                            ? "border-gold-500 bg-gold-500/5"
                            : "border-border hover:border-gold-500/50"
                        }`}
                      >
                        <method.icon className={`h-5 w-5 flex-shrink-0 ${deliveryMethod === method.id ? "text-gold-500" : "text-muted-foreground"}`} />
                        <div className="flex-1">
                          <p className="font-medium text-foreground">{method.name}</p>
                          <p className="text-sm text-muted-foreground">{method.desc}</p>
                        </div>
                        <span className="font-bold text-foreground">
                          {method.price === 0 ? "Free" : formatPrice(method.price)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: Payment */}
              {currentStep === 3 && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <h2 className="text-lg font-bold text-foreground mb-6">Payment Method</h2>
                  <div className="space-y-3">
                    {paymentMethods.map((method) => (
                      <button
                        key={method.id}
                        onClick={() => setPaymentMethod(method.id)}
                        className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-colors ${
                          paymentMethod === method.id
                            ? "border-gold-500 bg-gold-500/5"
                            : "border-border hover:border-gold-500/50"
                        }`}
                      >
                        <method.icon className={`h-5 w-5 flex-shrink-0 ${paymentMethod === method.id ? "text-gold-500" : "text-muted-foreground"}`} />
                        <div>
                          <p className="font-medium text-foreground">{method.name}</p>
                          <p className="text-sm text-muted-foreground">{method.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 4: Confirm */}
              {currentStep === 4 && (
                <div className="space-y-6">
                  <div className="rounded-xl border border-border bg-card p-6">
                    <h2 className="text-lg font-bold text-foreground mb-4">Order Review</h2>
                    <div className="space-y-4">
                      <div className="flex items-start gap-3 p-3 rounded-lg bg-muted">
                        <MapPin className="h-4 w-4 text-gold-500 mt-0.5" />
                        <div className="text-sm">
                          <p className="font-medium text-foreground">{shipping.name}</p>
                          <p className="text-muted-foreground">{shipping.street}, {shipping.city}</p>
                          <p className="text-muted-foreground">{shipping.phone}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                        <Truck className="h-4 w-4 text-gold-500" />
                        <span className="text-sm text-foreground">{selectedDelivery.name} - {selectedDelivery.desc}</span>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                        <CreditCard className="h-4 w-4 text-gold-500" />
                        <span className="text-sm text-foreground">
                          {paymentMethods.find((p) => p.id === paymentMethod)?.name}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-6">
                    <h3 className="font-bold text-foreground mb-4">Items ({orderItems.length})</h3>
                    <div className="space-y-3">
                      {orderItems.map((item) => (
                        <div key={item.id} className="flex items-center gap-3">
                          <div className="w-12 h-14 rounded-lg bg-muted flex-shrink-0" style={getItemImage(item) ? { backgroundImage: `url(${getItemImage(item)})`, backgroundSize: "cover", backgroundPosition: "center" } : {}} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{getItemName(item)}</p>
                            <p className="text-xs text-muted-foreground">{getItemSize(item) ? `Size: ${getItemSize(item)} ` : ""}x {item.quantity || 1}</p>
                          </div>
                          <span className="text-sm font-bold text-foreground">{formatPrice(getItemPrice(item) * (item.quantity || 1))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Navigation */}
              <div className="flex items-center justify-between mt-6">
                <button
                  onClick={prevStep}
                  className={`inline-flex items-center gap-2 text-sm font-medium transition-colors ${
                    currentStep === 1 ? "text-muted-foreground cursor-not-allowed" : "text-gold-500 hover:text-gold-600"
                  }`}
                  disabled={currentStep === 1}
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>

                {currentStep < 4 ? (
                  <Button onClick={nextStep} disabled={!canProceed()}>
                    Continue <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                ) : (
                  <Button onClick={handlePlaceOrder} disabled={placing}>
                    {placing ? "Placing Order..." : `Place Order - ${formatPrice(total)}`}
                  </Button>
                )}
              </div>
            </div>

            {/* Order Summary Sidebar */}
            <div>
              <div className="rounded-xl border border-border bg-card p-6 sticky top-24">
                <h2 className="text-lg font-bold text-foreground mb-4">Order Summary</h2>
                <div className="space-y-3 mb-4">
                  {orderItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-3">
                      <div className="w-10 h-12 rounded-lg bg-muted flex-shrink-0" style={getItemImage(item) ? { backgroundImage: `url(${getItemImage(item)})`, backgroundSize: "cover", backgroundPosition: "center" } : {}} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{getItemName(item)}</p>
                        <p className="text-xs text-muted-foreground">x{item.quantity || 1}</p>
                      </div>
                      <span className="text-xs font-bold text-foreground">{formatPrice(getItemPrice(item) * (item.quantity || 1))}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border pt-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium text-foreground">{formatPrice(subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Shipping</span>
                    <span className="font-medium text-foreground">
                      {shippingCost === 0 ? <span className="text-green-600">Free</span> : formatPrice(shippingCost)}
                    </span>
                  </div>
                  <div className="border-t border-border pt-2 flex justify-between">
                    <span className="text-base font-bold text-foreground">Total</span>
                    <span className="text-base font-bold text-gold-500">{formatPrice(total)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

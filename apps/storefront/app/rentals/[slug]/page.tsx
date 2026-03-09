"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Crown,
  Star,
  Calendar,
  Shield,
  CreditCard,
  AlertTriangle,
  ChevronRight,
  Check,
  Info,
  ArrowRight,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { formatPrice } from "@/lib/utils";
import { productsApi, rentalsApi } from "@/lib/api";

export default function RentalDetailPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedSize, setSelectedSize] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [booking, setBooking] = useState(false);

  useEffect(() => {
    setLoading(true);
    productsApi.getBySlug(slug)
      .then((data) => setProduct(data))
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [slug]);

  // Check availability when dates change
  useEffect(() => {
    if (!product?.id || !startDate || !endDate) {
      setAvailable(null);
      return;
    }
    setChecking(true);
    rentalsApi.checkAvailability(product.id, startDate, endDate)
      .then((res) => setAvailable(res.available))
      .catch(() => setAvailable(null))
      .finally(() => setChecking(false));
  }, [product?.id, startDate, endDate]);

  const handleBookNow = async () => {
    if (!product || !selectedSize || !startDate || !endDate) return;
    setBooking(true);
    try {
      await rentalsApi.create({
        productId: product.id,
        size: selectedSize,
        startDate,
        endDate,
      });
      alert("Rental booked successfully!");
    } catch {
      alert("Failed to book rental. Please try again.");
    } finally {
      setBooking(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-background min-h-screen">
        <div className="border-b border-border">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
            <nav className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-gold-500 transition-colors">Home</Link>
              <ChevronRight className="h-3 w-3" />
              <Link href="/rentals" className="hover:text-gold-500 transition-colors">Rentals</Link>
            </nav>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 animate-pulse">
            <div className="aspect-[3/4] rounded-2xl bg-muted" />
            <div>
              <div className="h-6 w-32 bg-muted rounded mb-3" />
              <div className="h-8 w-64 bg-muted rounded mb-4" />
              <div className="h-20 w-full bg-muted rounded mb-6" />
              <div className="h-4 w-full bg-muted rounded mb-2" />
              <div className="h-4 w-3/4 bg-muted rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Product Not Found</h1>
          <p className="text-muted-foreground mb-4">The rental product you are looking for does not exist.</p>
          <Link href="/rentals">
            <Button>Browse Rentals</Button>
          </Link>
        </div>
      </div>
    );
  }

  const images = product.images || [];
  const productSizes = product.sizes || [];
  const features = product.features || [];
  const rentalIncludes = product.rentalIncludes || [];
  const rentalPricePerDay = product.rentalPricePerDay || product.rentPrice || 0;
  const depositAmount = product.depositAmount || 0;
  const downPaymentPercent = product.downPaymentPercent || 25;
  const maxRentalDays = product.maxRentalDays || 7;
  const bufferDays = product.bufferDays || 7;
  const rating = product.rating || 0;
  const reviewCount = product.reviewCount || 0;

  const rentalDays =
    startDate && endDate
      ? Math.max(
          1,
          Math.ceil(
            (new Date(endDate).getTime() - new Date(startDate).getTime()) /
              (1000 * 60 * 60 * 24)
          ) + 1
        )
      : 0;

  const rentalFee = rentalDays * rentalPricePerDay;
  const downPayment = Math.round(rentalFee * (downPaymentPercent / 100));
  const totalCost = rentalFee + depositAmount;
  const remainingPayment = totalCost - downPayment;

  return (
    <div className="bg-background min-h-screen">
      {/* Breadcrumb */}
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">Home</Link>
            <ChevronRight className="h-3 w-3" />
            <Link href="/rentals" className="hover:text-gold-500 transition-colors">Rentals</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">{product.name}</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Image Gallery */}
          <div>
            <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-muted mb-4">
              <div
                className="h-full w-full bg-muted flex items-center justify-center text-muted-foreground"
                style={{
                  backgroundImage: images[selectedImage] ? `url(${images[selectedImage]})` : undefined,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              >
                {!images[selectedImage] && "Product Image"}
              </div>
              <div className="absolute top-4 left-4">
                <Badge variant="rent">Rental Only</Badge>
              </div>
            </div>

            {images.length > 0 && (
              <div className="flex gap-3">
                {images.map((image: string, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedImage(idx)}
                    className={`relative w-20 h-24 rounded-lg overflow-hidden border-2 transition-all ${
                      selectedImage === idx
                        ? "border-gold-500 ring-2 ring-gold-500/30"
                        : "border-border hover:border-gold-300"
                    }`}
                  >
                    <div
                      className="h-full w-full bg-muted"
                      style={{
                        backgroundImage: `url(${image})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Rental Info */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Crown className="h-5 w-5 text-gold-500" />
              <span className="text-sm font-medium text-gold-600">Premium Rental</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">
              {product.name}
            </h1>

            {/* Rating */}
            <div className="flex items-center gap-2 mt-3">
              <div className="flex">
                {Array.from({ length: 5 }, (_, i) => (
                  <Star
                    key={i}
                    className={`h-4 w-4 ${
                      i < Math.floor(rating)
                        ? "text-gold-500 fill-gold-500"
                        : "text-gray-300"
                    }`}
                  />
                ))}
              </div>
              <span className="text-sm text-muted-foreground">
                {rating} ({reviewCount} reviews)
              </span>
            </div>

            {/* Rental Price */}
            <div className="mt-6 p-4 rounded-xl bg-gold-500/10 border border-gold-500/30">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground">
                  {formatPrice(rentalPricePerDay)}
                </span>
                <span className="text-muted-foreground">/ day</span>
              </div>
              {product.price && (
                <p className="text-sm text-muted-foreground mt-1">
                  Retail price: {formatPrice(product.price)}
                </p>
              )}
            </div>

            {product.description && (
              <p className="mt-6 text-muted-foreground leading-relaxed">
                {product.description}
              </p>
            )}

            {/* Size Selection */}
            {productSizes.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-foreground mb-3">Select Size</h3>
                <div className="flex flex-wrap gap-2">
                  {productSizes.map((size: string) => (
                    <button
                      key={size}
                      onClick={() => setSelectedSize(size)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                        selectedSize === size
                          ? "border-gold-500 bg-gold-500 text-[#1A1A1A]"
                          : "border-border text-foreground hover:border-gold-500"
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Date Picker */}
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gold-500" />
                Select Rental Period
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    Pickup Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    Return Date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    min={startDate || new Date().toISOString().split("T")[0]}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <Info className="h-3 w-3" />
                {bufferDays}-day buffer between rentals. Max {maxRentalDays} days.
              </p>
              {checking && (
                <p className="text-xs text-gold-500 mt-1">Checking availability...</p>
              )}
              {available === false && (
                <p className="text-xs text-red-500 mt-1">Not available for selected dates. Please choose different dates.</p>
              )}
              {available === true && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <Check className="h-3 w-3" /> Available for selected dates
                </p>
              )}
            </div>

            {/* Price Breakdown */}
            {rentalDays > 0 && (
              <div className="mt-6 p-4 rounded-xl border border-border bg-card">
                <h3 className="text-sm font-semibold text-foreground mb-4">
                  Price Breakdown
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Rental fee ({rentalDays} {rentalDays === 1 ? "day" : "days"} x{" "}
                      {formatPrice(rentalPricePerDay)})
                    </span>
                    <span className="font-medium text-foreground">
                      {formatPrice(rentalFee)}
                    </span>
                  </div>
                  {depositAmount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Security deposit (refundable)
                      </span>
                      <span className="font-medium text-foreground">
                        {formatPrice(depositAmount)}
                      </span>
                    </div>
                  )}
                  <div className="border-t border-border pt-2 flex justify-between">
                    <span className="font-semibold text-foreground">Total</span>
                    <span className="font-bold text-foreground">
                      {formatPrice(totalCost)}
                    </span>
                  </div>
                  <div className="border-t border-border pt-2">
                    <div className="flex justify-between text-gold-600">
                      <span className="font-medium">
                        Down payment ({downPaymentPercent}% - pay now)
                      </span>
                      <span className="font-bold">{formatPrice(downPayment)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground mt-1">
                      <span>Remaining (pay before dispatch)</span>
                      <span>{formatPrice(remainingPayment)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ID Verification Notice */}
            <div className="mt-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    National ID Verification Required
                  </h4>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                    For security purposes, you will need to provide a valid
                    National ID (NIDA) for verification before the rental is
                    confirmed. This is a one-time process.
                  </p>
                </div>
              </div>
            </div>

            {/* Book Now Button */}
            <div className="mt-8">
              <Button
                variant="secondary"
                size="lg"
                className="w-full gap-2"
                disabled={!selectedSize || !startDate || !endDate || available === false || booking}
                onClick={handleBookNow}
              >
                <Crown className="h-5 w-5" />
                {booking ? "Booking..." : `Book Now ${rentalDays > 0 ? `- Pay ${formatPrice(downPayment)}` : ""}`}
              </Button>
              {(!selectedSize || !startDate || !endDate) && (
                <p className="text-xs text-muted-foreground text-center mt-2">
                  Please select a size and rental dates to continue
                </p>
              )}
            </div>

            {/* What's Included */}
            {rentalIncludes.length > 0 && (
              <div className="mt-8">
                <h3 className="text-sm font-semibold text-foreground mb-3">
                  Rental Includes
                </h3>
                <ul className="space-y-2">
                  {rentalIncludes.map((item: string) => (
                    <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="h-4 w-4 text-gold-500 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Features */}
            {features.length > 0 && (
              <div className="mt-8">
                <h3 className="text-sm font-semibold text-foreground mb-3">
                  Product Details
                </h3>
                <ul className="space-y-2">
                  {features.map((feature: string) => (
                    <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="h-4 w-4 text-gold-500 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

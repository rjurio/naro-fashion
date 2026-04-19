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
import { useToast } from "@/contexts/ToastContext";
import { useTranslation } from "@/lib/i18n";

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

function resolveImg(url?: string): string {
  if (!url) return '';
  if (url.startsWith('/uploads')) return `${API_ORIGIN}${url}`;
  return url;
}

export default function RentalDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const toast = useToast();
  const { t } = useTranslation();

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
      toast.success(t('rentals.rentalBookedSuccess'));
    } catch {
      toast.error(t('rentals.rentalBookFailed'));
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
              <Link href="/" className="hover:text-gold-500 transition-colors">{t('common.home')}</Link>
              <ChevronRight className="h-3 w-3" />
              <Link href="/rentals" className="hover:text-gold-500 transition-colors">{t('common.rentals')}</Link>
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
          <h1 className="text-2xl font-bold text-foreground mb-2">{t('rentals.productNotFound')}</h1>
          <p className="text-muted-foreground mb-4">{t('rentals.productNotFoundDesc')}</p>
          <Link href="/rentals">
            <Button>{t('rentals.browseRentals')}</Button>
          </Link>
        </div>
      </div>
    );
  }

  const images = (product.images || []).map((img: any) => resolveImg(typeof img === 'string' ? img : img.url));
  const variants = (product.variants || []).filter((v: any) => v.isActive !== false);
  const uniqueSizes = [...new Set(variants.map((v: any) => v.size).filter(Boolean))] as string[];
  const features: string[] = Array.isArray(product.specifications) ? product.specifications : [];
  const rentalPricePerDay = Number(product.rentalPricePerDay) || 0;
  const depositAmount = Number(product.rentalDepositAmount) || 0;
  const downPaymentPercent = product.rentalDownPaymentPct || 25;
  const maxRentalDays = product.maxRentalDays || 7;
  const bufferDays = product.bufferDaysOverride || 7;
  const rating = product.avgRating || 0;
  const reviewCount = product.reviewCount || 0;
  const retailPrice = Number(product.basePrice) || 0;

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
            <Link href="/" className="hover:text-gold-500 transition-colors">{t('common.home')}</Link>
            <ChevronRight className="h-3 w-3" />
            <Link href="/rentals" className="hover:text-gold-500 transition-colors">{t('common.rentals')}</Link>
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
              {images[selectedImage] ? (
                <img
                  src={images[selectedImage]}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  {t('rentals.noImage')}
                </div>
              )}
              <div className="absolute top-4 left-4">
                <Badge variant="rent">
                  {product.availabilityMode === 'RENTAL_ONLY' ? t('rentals.rentalOnly') : t('rentals.rentAvailable')}
                </Badge>
              </div>
            </div>

            {images.length > 1 && (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {images.map((image: string, idx: number) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedImage(idx)}
                    className={`relative w-20 h-24 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 ${
                      selectedImage === idx
                        ? "border-gold-500 ring-2 ring-gold-500/30"
                        : "border-border hover:border-gold-300"
                    }`}
                  >
                    <img src={image} alt={`${product.name} ${idx + 1}`} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Rental Info */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Crown className="h-5 w-5 text-gold-500" />
              <span className="text-sm font-medium text-gold-600">{t('rentals.premiumRental')}</span>
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
                {rating} ({reviewCount} {t('product.reviews').toLowerCase()})
              </span>
            </div>

            {/* Rental Price */}
            <div className="mt-6 p-4 rounded-xl bg-gold-500/10 border border-gold-500/30">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground">
                  {formatPrice(rentalPricePerDay)}
                </span>
                <span className="text-muted-foreground">{t('rentals.perDay')}</span>
              </div>
              {retailPrice > 0 && (
                <p className="text-sm text-muted-foreground mt-1">
                  {t('rentals.retailPrice')} {formatPrice(retailPrice)}
                </p>
              )}
            </div>

            {product.description && (
              <p className="mt-6 text-muted-foreground leading-relaxed">
                {product.description}
              </p>
            )}

            {/* Size Selection */}
            {uniqueSizes.length > 0 ? (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-foreground mb-3">{t('rentals.selectSize')}</h3>
                <div className="flex flex-wrap gap-2">
                  {uniqueSizes.map((size) => (
                    <button
                      key={size}
                      type="button"
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
            ) : variants.length > 0 ? (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-foreground mb-3">{t('rentals.selectVariant')}</h3>
                <div className="flex flex-wrap gap-2">
                  {variants.map((v: any) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedSize(v.name || v.id)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                        selectedSize === (v.name || v.id)
                          ? "border-gold-500 bg-gold-500 text-[#1A1A1A]"
                          : "border-border text-foreground hover:border-gold-500"
                      }`}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Date Picker */}
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gold-500" />
                {t('rentals.selectRentalPeriod')}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    {t('rentals.pickupDate')}
                  </label>
                  <input
                    type="date"
                    title={t('rentals.pickupDate')}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    {t('rentals.returnDate')}
                  </label>
                  <input
                    type="date"
                    title={t('rentals.returnDate')}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    min={startDate || new Date().toISOString().split("T")[0]}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <Info className="h-3 w-3" />
                {t('rentals.bufferDaysNote').replace('{buffer}', String(bufferDays)).replace('{max}', String(maxRentalDays))}
              </p>
              {checking && (
                <p className="text-xs text-gold-500 mt-1">{t('rentals.checkingAvailability')}</p>
              )}
              {available === false && (
                <p className="text-xs text-red-500 mt-1">{t('rentals.notAvailable')}</p>
              )}
              {available === true && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <Check className="h-3 w-3" /> {t('rentals.availableForDates')}
                </p>
              )}
            </div>

            {/* Price Breakdown */}
            {rentalDays > 0 && (
              <div className="mt-6 p-4 rounded-xl border border-border bg-card">
                <h3 className="text-sm font-semibold text-foreground mb-4">
                  {t('rentals.priceBreakdown')}
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t('rentals.rentalFeeLine')
                        .replace('{days}', String(rentalDays))
                        .replace('{unit}', rentalDays === 1 ? t('rentals.day') : t('rentals.daysLong'))
                        .replace('{rate}', formatPrice(rentalPricePerDay))}
                    </span>
                    <span className="font-medium text-foreground">
                      {formatPrice(rentalFee)}
                    </span>
                  </div>
                  {depositAmount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t('rentals.securityDeposit')}
                      </span>
                      <span className="font-medium text-foreground">
                        {formatPrice(depositAmount)}
                      </span>
                    </div>
                  )}
                  <div className="border-t border-border pt-2 flex justify-between">
                    <span className="font-semibold text-foreground">{t('rentals.totalLabel')}</span>
                    <span className="font-bold text-foreground">
                      {formatPrice(totalCost)}
                    </span>
                  </div>
                  <div className="border-t border-border pt-2">
                    <div className="flex justify-between text-gold-600">
                      <span className="font-medium">
                        {t('rentals.downPaymentLine').replace('{pct}', String(downPaymentPercent))}
                      </span>
                      <span className="font-bold">{formatPrice(downPayment)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground mt-1">
                      <span>{t('rentals.remainingBeforeDispatch')}</span>
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
                    {t('rentals.idVerificationRequired')}
                  </h4>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                    {t('rentals.idVerificationRequiredDesc')}
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
                {booking
                  ? t('rentals.booking')
                  : `${t('rentals.bookNowWithPay')}${rentalDays > 0 ? ` - ${t('rentals.payAmount').replace('{amount}', formatPrice(downPayment))}` : ""}`}
              </Button>
              {(!selectedSize || !startDate || !endDate) && (
                <p className="text-xs text-muted-foreground text-center mt-2">
                  {t('rentals.selectSizeAndDates')}
                </p>
              )}
            </div>

            {/* Features */}
            {features.length > 0 && (
              <div className="mt-8">
                <h3 className="text-sm font-semibold text-foreground mb-3">
                  {t('rentals.productDetails')}
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

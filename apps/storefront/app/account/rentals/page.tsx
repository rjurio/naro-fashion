"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Upload, CheckCircle2, Clock, AlertTriangle, Loader2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { formatPrice } from "@/lib/utils";
import { rentalsApi, idVerificationApi } from "@/lib/api";

interface Rental {
  id: string;
  itemName: string;
  image: string;
  rentalStart: string;
  rentalEnd: string;
  returnDate: string;
  status: string;
  paymentStatus: string;
  totalCost: number;
  depositPaid: number;
  [key: string]: any;
}

const rentalStatusColors: Record<string, string> = {
  Active: "bg-green-100 text-green-700",
  Upcoming: "bg-blue-100 text-blue-700",
  Returned: "bg-gray-100 text-gray-700",
  "Returned Late": "bg-red-100 text-red-700",
  Overdue: "bg-red-100 text-red-700",
  ACTIVE: "bg-green-100 text-green-700",
  UPCOMING: "bg-blue-100 text-blue-700",
  RETURNED: "bg-gray-100 text-gray-700",
  RETURNED_LATE: "bg-red-100 text-red-700",
  OVERDUE: "bg-red-100 text-red-700",
  COMPLETED: "bg-gray-100 text-gray-700",
};

const paymentStatusColors: Record<string, string> = {
  "Fully Paid": "bg-green-100 text-green-700",
  "Deposit Paid": "bg-yellow-100 text-yellow-700",
  "Pending Payment": "bg-red-100 text-red-700",
  FULLY_PAID: "bg-green-100 text-green-700",
  DEPOSIT_PAID: "bg-yellow-100 text-yellow-700",
  PENDING: "bg-red-100 text-red-700",
};

function normalizeRental(r: any): Rental {
  return {
    id: r.rentalNumber || r.id,
    itemName: r.itemName || r.product?.name || r.productName || "Rental Item",
    image: r.image || r.product?.image || r.product?.images?.[0] || "/images/products/placeholder.jpg",
    rentalStart: r.rentalStart || r.startDate || r.rentalStartDate || "",
    rentalEnd: r.rentalEnd || r.endDate || r.rentalEndDate || "",
    returnDate: r.returnDate || r.expectedReturnDate || r.rentalEnd || r.endDate || "",
    status: r.status || "Active",
    paymentStatus: r.paymentStatus || "Pending Payment",
    totalCost: r.totalCost ?? r.total ?? r.totalAmount ?? 0,
    depositPaid: r.depositPaid ?? r.deposit ?? 0,
    ...r,
  };
}

function formatRentalDate(dateStr: string): string {
  if (!dateStr) return "-";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function RentalCard({ rental }: { rental: Rental }) {
  return (
    <div className="flex gap-4 p-4 rounded-xl border border-border bg-card">
      <div
        className="w-20 h-24 sm:w-24 sm:h-28 rounded-lg bg-muted flex-shrink-0"
        style={{ backgroundImage: `url(${rental.image})`, backgroundSize: "cover", backgroundPosition: "center" }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-foreground">{rental.itemName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{rental.id}</p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${rentalStatusColors[rental.status] || "bg-gray-100 text-gray-700"}`}>
              {rental.status}
            </span>
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${paymentStatusColors[rental.paymentStatus] || "bg-gray-100 text-gray-700"}`}>
              {rental.paymentStatus}
            </span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <CalendarDays className="h-3 w-3" />
            <span>{formatRentalDate(rental.rentalStart)} - {formatRentalDate(rental.rentalEnd)}</span>
          </div>
          <div className="text-right">
            <span className="text-muted-foreground">Return: </span>
            <span className="font-medium text-foreground">{formatRentalDate(rental.returnDate)}</span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm font-bold text-foreground">{formatPrice(rental.totalCost)}</span>
          {["Deposit Paid", "DEPOSIT_PAID"].includes(rental.paymentStatus) && (
            <span className="text-xs text-muted-foreground">
              Deposit: {formatPrice(rental.depositPaid)} (25%)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RentalsPage() {
  const [loading, setLoading] = useState(true);
  const [activeRentals, setActiveRentals] = useState<Rental[]>([]);
  const [pastRentals, setPastRentals] = useState<Rental[]>([]);
  const [idVerified, setIdVerified] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const [rentalsRes, idRes] = await Promise.allSettled([
          rentalsApi.getAll(),
          idVerificationApi.getStatus(),
        ]);

        if (rentalsRes.status === "fulfilled") {
          const raw = Array.isArray(rentalsRes.value) ? rentalsRes.value : (rentalsRes.value?.data || []);
          const all = raw.map(normalizeRental);

          const activeStatuses = ["Active", "Upcoming", "ACTIVE", "UPCOMING"];
          setActiveRentals(all.filter((r) => activeStatuses.includes(r.status)));
          setPastRentals(all.filter((r) => !activeStatuses.includes(r.status)));
        }

        if (idRes.status === "fulfilled") {
          const status = idRes.value;
          setIdVerified(status?.verified === true || status?.status === "VERIFIED" || status?.status === "verified");
        }
      } catch {
        // handled via allSettled
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">Home</Link>
            <span>/</span>
            <Link href="/account" className="hover:text-gold-500 transition-colors">Account</Link>
            <span>/</span>
            <span className="text-foreground font-medium">My Rentals</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">My Rentals</h1>
          <Link href="/account">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> Account
            </Button>
          </Link>
        </div>

        {/* ID Verification Banner */}
        {!idVerified ? (
          <div className="flex items-center gap-3 p-4 rounded-xl border border-yellow-300 bg-yellow-50 mb-6">
            <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-800">National ID not verified</p>
              <p className="text-xs text-yellow-700">You need to verify your ID to rent items.</p>
            </div>
            <Button size="sm" variant="outline">
              <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload ID
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 mb-6">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="text-sm text-green-700 font-medium">National ID verified</span>
          </div>
        )}

        {/* Active Rentals */}
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-5 w-5 text-gold-500" />
            <h2 className="text-lg font-bold text-foreground">Active & Upcoming</h2>
          </div>
          {activeRentals.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 rounded-xl border border-border bg-card">No active rentals.</p>
          ) : (
            <div className="space-y-4">
              {activeRentals.map((rental) => (
                <RentalCard key={rental.id} rental={rental} />
              ))}
            </div>
          )}
        </section>

        {/* Past Rentals */}
        <section>
          <h2 className="text-lg font-bold text-foreground mb-4">Past Rentals</h2>
          {pastRentals.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 rounded-xl border border-border bg-card">No past rentals.</p>
          ) : (
            <div className="space-y-4">
              {pastRentals.map((rental) => (
                <RentalCard key={rental.id} rental={rental} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

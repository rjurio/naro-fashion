// Shared types, constants, and utilities for Naro Fashion

// ============================================================
// ENUMS
// ============================================================

export enum ProductAvailabilityMode {
  PURCHASE_ONLY = 'PURCHASE_ONLY',
  RENTAL_ONLY = 'RENTAL_ONLY',
  BOTH = 'BOTH',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export enum PaymentMethod {
  MOBILE_MONEY = 'MOBILE_MONEY',
  CARD = 'CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  COD = 'COD',
  CASH = 'CASH',
  MPESA = 'MPESA',
  TIGO_PESA = 'TIGO_PESA',
  AIRTEL_MONEY = 'AIRTEL_MONEY',
  MIX_BY_YAS = 'MIX_BY_YAS',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export enum RentalStatus {
  PENDING_ID_VERIFICATION = 'PENDING_ID_VERIFICATION',
  ID_VERIFIED = 'ID_VERIFIED',
  DOWN_PAYMENT_PAID = 'DOWN_PAYMENT_PAID',
  FULLY_PAID = 'FULLY_PAID',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  ITEM_DISPATCHED = 'ITEM_DISPATCHED',
  ACTIVE = 'ACTIVE',
  RETURNED = 'RETURNED',
  INSPECTION = 'INSPECTION',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export enum RentalPaymentType {
  DOWN_PAYMENT = 'DOWN_PAYMENT',
  BALANCE = 'BALANCE',
  DEPOSIT_REFUND = 'DEPOSIT_REFUND',
  LATE_FEE = 'LATE_FEE',
  DAMAGE_DEDUCTION = 'DAMAGE_DEDUCTION',
}

export enum ChecklistItemType {
  DISPATCH = 'DISPATCH',
  RETURN = 'RETURN',
}

export enum IDVerificationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum AdminRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  MANAGER = 'MANAGER',
  STAFF = 'STAFF',
}

export enum Theme {
  LIGHT = 'light',
  DARK = 'dark',
  STANDARD = 'standard',
}

export enum EventStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum EventMediaType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
}

// POS Enums
export enum OrderChannel {
  ONLINE = 'ONLINE',
  POS = 'POS',
}

export enum PosSessionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum DiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED = 'FIXED',
}

export enum LayawayStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

// POS payment method display labels (Tanzania)
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  MPESA: 'M-Pesa',
  TIGO_PESA: 'Tigo Pesa',
  AIRTEL_MONEY: 'Airtel Money',
  MIX_BY_YAS: 'MIX by YAS',
  CARD: 'Card',
  MOBILE_MONEY: 'Mobile Money',
  BANK_TRANSFER: 'Bank Transfer',
  COD: 'Cash on Delivery',
} as const;

// ============================================================
// CONSTANTS
// ============================================================

export const BRAND_COLORS = {
  black: '#1A1A1A',
  gold: '#D4AF37',
  white: '#FFFFFF',
  goldLight: '#FEF9E7',
} as const;

export const DEFAULT_RENTAL_POLICIES = {
  bufferDaysBetweenRentals: 7,
  defaultDownPaymentPct: 25,
  lateFeePerDay: 10000, // TZS
  maxRentalDurationDays: 30,
  advancePreparationReminderDays: 2,
} as const;

export const SUPPORTED_LOCALES = ['en', 'sw'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const PAGINATION_DEFAULTS = {
  page: 1,
  limit: 20,
  maxLimit: 100,
} as const;

// ============================================================
// UTILITY TYPES
// ============================================================

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

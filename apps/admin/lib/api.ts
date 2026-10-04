const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ===== Order refunds (POST/GET /orders/:id/refunds) =====
export type OrderRefundMethod = 'MOBILE_MONEY' | 'BANK_TRANSFER' | 'CASH' | 'GATEWAY';

export interface CreateOrderRefundInput {
  amount: number;
  method: OrderRefundMethod;
  reference?: string;
  note?: string;
}

export interface OrderRefundRow {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  providerCode: string | null;
  note: string | null;
  refundedBy: string | null;
  refundedByName: string | null;
  kind: string | null;
  createdAt: string;
}

export interface OrderRefundSummary {
  orderId: string;
  orderNumber: string;
  paymentStatus: string;
  totalCollected: number;
  totalRefunded: number;
  refundable: number;
  canRefund: boolean;
  refunds: OrderRefundRow[];
}

// ===== Instagram connection (GET /cms/instagram/token-status, POST /cms/instagram/connect) =====
export interface InstagramTokenStatus {
  connected: boolean;
  tokenType: 'PAGE' | 'USER' | string | null;
  pageName: string | null;
  igUsername: string | null;
  /** ISO date, 'never', or null when unknown. */
  expiresAt: string | null;
  dataAccessExpiresAt: string | null;
  checkedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  valid: boolean;
  scopes: string[];
}

export interface InstagramConnectResult {
  pageName: string;
  igUsername: string | null;
  tokenType: 'PAGE';
  expiresAt: string;
  scopes: string[];
  synced: number;
  syncErrors: number;
}

// ============================================================
// Token storage helpers — the single source of truth for where the
// admin SPA keeps its JWTs. "Remember me" → localStorage, otherwise
// sessionStorage. Every caller (pages, components, the API client)
// must go through these instead of touching storage directly.
// ============================================================

const ACCESS_TOKEN_KEY = 'token';
const REFRESH_TOKEN_KEY = 'refreshToken';

function safeStorage(kind: 'local' | 'session'): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Current access token from localStorage (remember-me) or sessionStorage. */
export function getAuthToken(): string | null {
  return safeStorage('local')?.getItem(ACCESS_TOKEN_KEY) || safeStorage('session')?.getItem(ACCESS_TOKEN_KEY) || null;
}

/** Current refresh token from localStorage (remember-me) or sessionStorage. */
export function getRefreshToken(): string | null {
  return safeStorage('local')?.getItem(REFRESH_TOKEN_KEY) || safeStorage('session')?.getItem(REFRESH_TOKEN_KEY) || null;
}

/** Persist a token pair. `remember` picks localStorage vs sessionStorage; the other store is cleared. */
export function storeAuthTokens(accessToken: string, refreshToken: string | undefined | null, remember: boolean) {
  const target = safeStorage(remember ? 'local' : 'session');
  const other = safeStorage(remember ? 'session' : 'local');
  other?.removeItem(ACCESS_TOKEN_KEY);
  other?.removeItem(REFRESH_TOKEN_KEY);
  target?.setItem(ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) target?.setItem(REFRESH_TOKEN_KEY, refreshToken);
  else target?.removeItem(REFRESH_TOKEN_KEY);
}

/** Remove access + refresh tokens from BOTH storages. */
export function clearAuthTokens() {
  for (const s of [safeStorage('local'), safeStorage('session')]) {
    s?.removeItem(ACCESS_TOKEN_KEY);
    s?.removeItem(REFRESH_TOKEN_KEY);
  }
}

/** Event fired on `window` whenever the API answers 403 (RBAC / module gate). */
export const API_FORBIDDEN_EVENT = 'naro:api-forbidden';

/** Turn the API's 403 message into something an operator understands. */
function friendlyForbiddenMessage(raw: string): string {
  const missing = /^Missing required permission:\s*(.+)$/i.exec(raw);
  if (missing) return `You don't have permission to perform this action (requires ${missing[1]}).`;
  if (!raw || /^(Forbidden( resource)?|API Error: 403.*)$/i.test(raw)) {
    return "You don't have permission to perform this action.";
  }
  return raw;
}

type RefreshResult =
  | { token: string }
  // 'rejected'  → the API definitively refused the refresh token (or there is none)
  // 'transient' → network failure / 5xx; tokens may still be valid, keep them
  | { token: null; reason: 'rejected' | 'transient' };

/** Auth endpoints that must never trigger a refresh-and-retry (would loop or make no sense). */
const NO_REFRESH_ENDPOINTS = new Set([
  '/auth/login',
  '/auth/platform-login',
  '/auth/2fa/verify',
  '/auth/refresh',
  // Logout is @Public on the API and identifies the principal from the
  // (possibly expired) access token OR the refresh token in the body, so a
  // refresh round-trip first would be pointless.
  '/auth/logout',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

class AdminApiClient {
  private baseUrl: string;
  // In-memory fallback only. Storage is the source of truth (see getAuthToken).
  private token: string | null = null;
  // Single in-flight refresh promise — multiple parallel 401s share it so we
  // never trigger more than one /auth/refresh round-trip at a time.
  private refreshPromise: Promise<RefreshResult> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async handleError(response: Response): Promise<never> {
    let message = `API Error: ${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.message) {
        message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
      } else if (body?.error?.message) {
        // AI envelope shape: { success:false, error:{ code, message } }
        message = body.error.message;
      }
    } catch {
      // Response body isn't JSON, use default message
    }
    if (response.status === 403) {
      message = friendlyForbiddenMessage(message);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(API_FORBIDDEN_EVENT, { detail: { message } }));
      }
    }
    throw new ApiError(response.status, message);
  }

  setToken(token: string) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  private buildUrl(endpoint: string, params?: Record<string, string>): string {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        url.searchParams.append(key, value);
      });
    }
    return url.toString();
  }

  private getStoredToken(): string | null {
    return getAuthToken() || this.token;
  }

  /**
   * Exchange the stored refreshToken for a new access token.
   * Concurrent calls share a single in-flight promise.
   */
  private async tryRefreshToken(): Promise<RefreshResult> {
    if (this.refreshPromise) return this.refreshPromise;
    const refreshToken = getRefreshToken();
    if (!refreshToken) return { token: null, reason: 'rejected' };

    this.refreshPromise = (async (): Promise<RefreshResult> => {
      try {
        const res = await fetch(this.buildUrl('/auth/refresh'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          const transient = res.status >= 500 || res.status === 408 || res.status === 429;
          return { token: null, reason: transient ? 'transient' : 'rejected' };
        }
        const data = await res.json();
        const newAccess: string | undefined = data?.accessToken;
        const newRefresh: string | undefined = data?.refreshToken;
        if (!newAccess) return { token: null, reason: 'rejected' };
        // Persist to whichever storage held the previous tokens
        const remember = !!safeStorage('local')?.getItem(REFRESH_TOKEN_KEY) || !!safeStorage('local')?.getItem(ACCESS_TOKEN_KEY);
        storeAuthTokens(newAccess, newRefresh || refreshToken, remember);
        this.token = newAccess;
        return { token: newAccess };
      } catch {
        return { token: null, reason: 'transient' };
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  /**
   * fetch() with the bearer token injected and automatic refresh-on-401.
   * On a 401 it performs the shared single-flight refresh and replays the
   * request once. Stored tokens are purged ONLY when the refresh is
   * definitively rejected — network errors / 5xx keep them so a flaky
   * connection doesn't log the operator out.
   *
   * Use this for every raw request (multipart uploads, blob downloads) so
   * they get the same refresh behaviour as JSON calls.
   */
  async authorizedFetch(url: string, init: RequestInit = {}, opts: { skipRefresh?: boolean } = {}): Promise<Response> {
    let usedToken: string | null = null;
    const doFetch = () => {
      const headers = new Headers(init.headers);
      usedToken = this.getStoredToken();
      if (usedToken) headers.set('Authorization', `Bearer ${usedToken}`);
      return fetch(url, { ...init, headers });
    };

    let response = await doFetch();
    if (response.status === 401 && !opts.skipRefresh) {
      // A parallel request may already have refreshed while this one was in
      // flight — just replay with the newer token instead of refreshing again.
      const current = this.getStoredToken();
      if (current && current !== usedToken) {
        response = await doFetch();
        if (response.status !== 401) return response;
      }
      const result = await this.tryRefreshToken();
      if (result.token !== null) {
        response = await doFetch();
      } else if ('reason' in result && result.reason === 'rejected') {
        clearAuthTokens();
        this.token = null;
      } else {
        // Refresh couldn't reach the server (network / 5xx). The 401 is not
        // definitive — surface it as a transient error so callers (notably
        // AuthContext on page load) keep the stored tokens.
        throw new ApiError(503, "Couldn't reach the server to renew your session. Check your connection and try again.");
      }
    }
    return response;
  }

  /** authorizedFetch + JSON error handling for multipart uploads. */
  private async uploadMultipart<T>(endpoint: string, file: File, fallbackError = 'Upload failed'): Promise<T> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await this.authorizedFetch(`${this.baseUrl}${endpoint}`, { method: 'POST', body: formData });
    if (!res.ok) {
      if (res.status === 403) await this.handleError(res);
      const err = await res.json().catch(() => ({ message: fallbackError }));
      const msg = Array.isArray(err?.message) ? err.message.join(', ') : err?.message;
      throw new ApiError(res.status, msg || fallbackError);
    }
    return res.json();
  }

  /**
   * Centralized JSON request wrapper. Delegates auth + refresh-on-401 to
   * authorizedFetch. `/auth/me` and every other non-credential endpoint
   * is eligible for refresh; only login/refresh/logout & friends skip it.
   */
  private async request<T>(method: string, endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    const { params, headers: extraHeaders, ...fetchOptions } = options || {};
    const url = this.buildUrl(endpoint, params);
    const body = data !== undefined ? JSON.stringify(data) : undefined;
    const headers = new Headers(extraHeaders);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const response = await this.authorizedFetch(
      url,
      { method, body, ...fetchOptions, headers },
      { skipRefresh: NO_REFRESH_ENDPOINTS.has(endpoint) },
    );

    if (!response.ok) {
      await this.handleError(response);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', endpoint, undefined, options);
  }

  async post<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', endpoint, data, options);
  }

  async put<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', endpoint, data, options);
  }

  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', endpoint, undefined, options);
  }

  async patch<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', endpoint, data, options);
  }

  // ===== Auth =====
  /**
   * Password step. Returns tokens, OR `{ requires2FA: true, challengeToken }`
   * when the admin has TOTP enabled — then call verify2FA().
   */
  login(email: string, password: string) {
    return this.post<any>('/auth/login', { email, password });
  }

  /**
   * Login step 2 for admins / platform admins with TOTP: exchanges the challenge
   * + a 6-digit code OR a recovery code for normal login tokens.
   */
  verify2FA(challengeToken: string, code: string) {
    return this.post<{ message: string; accessToken: string; refreshToken?: string; user: any }>(
      '/auth/2fa/verify',
      { challengeToken, code },
    );
  }

  /** Persist a fresh token pair the API issued after a tokenVersion bump, into the storage holding the session. */
  private persistFreshTokens(res: { accessToken?: string; refreshToken?: string } | null | undefined) {
    if (!res?.accessToken) return;
    const remember = !!safeStorage('local')?.getItem(ACCESS_TOKEN_KEY) || !!safeStorage('local')?.getItem(REFRESH_TOKEN_KEY);
    storeAuthTokens(res.accessToken, res.refreshToken || getRefreshToken(), remember);
    this.token = res.accessToken;
  }

  /** TOTP enrolment step 1 (re-auth with password) → secret + otpauth:// URI. Nothing is enabled yet. */
  setup2FA(currentPassword: string) {
    return this.post<{ otpauthUrl: string; secret: string; issuer: string }>('/auth/2fa/setup', { currentPassword });
  }

  /**
   * TOTP enrolment step 2. The API bumps tokenVersion (other sessions are
   * signed out) and returns fresh tokens for this session — persisted here —
   * plus 10 one-time recovery codes (show them once).
   */
  async enable2FA(code: string) {
    const res = await this.post<{ message: string; is2FAEnabled: boolean; recoveryCodes: string[]; accessToken?: string; refreshToken?: string }>(
      '/auth/2fa/enable',
      { code },
    );
    this.persistFreshTokens(res);
    return res;
  }

  /** Replace all recovery codes (password + TOTP/recovery code). Returns the new plaintext set — show it once. */
  regenerateRecoveryCodes(currentPassword: string, code: string) {
    return this.post<{ message: string; recoveryCodes: string[] }>('/auth/2fa/recovery-codes/regenerate', { currentPassword, code });
  }

  /** Turn TOTP off (password + current code). Fresh tokens are returned and persisted, like enable2FA. */
  async disable2FA(currentPassword: string, code: string) {
    const res = await this.post<{ message: string; is2FAEnabled: boolean; accessToken?: string; refreshToken?: string }>(
      '/auth/2fa/disable',
      { currentPassword, code },
    );
    this.persistFreshTokens(res);
    return res;
  }

  getProfile() {
    return this.get<any>('/auth/me');
  }

  /**
   * Best-effort server-side logout (revokes tokens via token-version bump).
   * Sends the refresh token too so revocation works even when the access
   * token has already expired.
   */
  logout() {
    const refreshToken = getRefreshToken();
    return this.post<{ message: string }>('/auth/logout', refreshToken ? { refreshToken } : {});
  }

  /**
   * Change own password. The API bumps tokenVersion (revoking every other
   * session) and returns fresh tokens for THIS session — persist them into
   * whichever storage currently holds the session, or the next request 401s.
   */
  async changePassword(currentPassword: string, newPassword: string) {
    const res = await this.post<{ message: string; accessToken?: string; refreshToken?: string }>(
      '/auth/change-password',
      { currentPassword, newPassword },
    );
    this.persistFreshTokens(res);
    return res;
  }

  /**
   * Legacy toggle. Only useful to clear a stale `is2FAEnabled` flag that has
   * no real enrolment behind it; use setup2FA/enable2FA/disable2FA otherwise.
   */
  toggle2FA(enabled: boolean, currentPassword?: string) {
    return this.patch<any>('/auth/2fa', currentPassword ? { enabled, currentPassword } : { enabled });
  }

  updateProfile(data: { firstName?: string; lastName?: string; phone?: string }) {
    return this.patch<any>('/auth/me', data);
  }

  forgotPassword(email: string) {
    return this.post<{ message: string }>('/auth/forgot-password', { email });
  }

  resetPassword(token: string, newPassword: string) {
    return this.post<{ message: string }>('/auth/reset-password', { token, newPassword });
  }

  // ===== AI Assistant =====
  aiAssistantStatus() {
    return this.get<{ configured: boolean; message: string }>('/ai-assistant/status');
  }
  aiAssistantChat(messages: Array<{ role: 'user' | 'assistant'; content: string }>) {
    return this.post<{
      reply: string;
      toolCalls: Array<{ tool: string; input: any; ok: boolean; error?: string }>;
      iterations: number;
      inputTokens: number;
      outputTokens: number;
    }>('/ai-assistant/chat', { messages });
  }

  // ===== Dashboard / Analytics =====
  getDashboardStats() {
    return this.get<any>('/analytics/dashboard');
  }
  getRevenueChart(period: string) {
    return this.get<any[]>('/analytics/revenue', { params: { period } });
  }
  getAnalyticsSales() {
    return this.get<any>('/analytics/sales');
  }
  getAnalyticsRentals() {
    return this.get<any>('/analytics/rentals');
  }
  getAnalyticsInventory() {
    return this.get<any>('/analytics/inventory');
  }
  getAnalyticsCustomers() {
    return this.get<any>('/analytics/customers');
  }
  getAnalyticsProducts() {
    return this.get<any>('/analytics/products');
  }

  // ===== Visitor Analytics =====
  getVisitorOverview(params?: Record<string, string>) {
    return this.get<any>('/analytics/visitors/overview', { params });
  }
  getVisitorTimeseries(params?: Record<string, string>) {
    return this.get<any[]>('/analytics/visitors/timeseries', { params });
  }
  getVisitorTopPages(params?: Record<string, string>) {
    return this.get<any[]>('/analytics/visitors/top-pages', { params });
  }
  getVisitorCountries(params?: Record<string, string>) {
    return this.get<any[]>('/analytics/visitors/countries', { params });
  }
  getVisitorDevices(params?: Record<string, string>) {
    return this.get<any>('/analytics/visitors/devices', { params });
  }
  getVisitorReferrers(params?: Record<string, string>) {
    return this.get<any[]>('/analytics/visitors/referrers', { params });
  }
  getVisitorHourly(params?: Record<string, string>) {
    return this.get<any[]>('/analytics/visitors/hourly', { params });
  }

  // ===== Products =====
  getProducts(params?: Record<string, string>) {
    return this.get<any>('/products/admin', { params });
  }
  getProduct(slug: string) {
    return this.get<any>(`/products/${slug}`);
  }
  getProductById(id: string) {
    return this.get<any>(`/products/by-id/${id}`);
  }
  uploadImage(file: File): Promise<{ url: string; filename: string }> {
    return this.uploadMultipart('/upload/image', file);
  }
  upload3dModel(file: File): Promise<{ url: string; filename: string }> {
    return this.uploadMultipart('/upload/3d-model', file);
  }
  bulkImportProducts(file: File): Promise<{ created: number; failed: number; total: number; errors: { row: number; field?: string; message: string }[] }> {
    return this.uploadMultipart('/products/bulk-import', file, 'Import failed');
  }
  createProduct(data: any) {
    return this.post<any>('/products', data);
  }
  updateProduct(id: string, data: any) {
    return this.patch<any>(`/products/${id}`, data);
  }
  toggleProduct(id: string) {
    return this.patch<any>(`/products/${id}/toggle-active`, {});
  }
  deleteProduct(id: string) {
    return this.delete<any>(`/products/${id}`);
  }
  getDeletedProducts() {
    return this.get<any[]>('/products/deleted');
  }
  restoreProduct(id: string) {
    return this.patch<any>(`/products/${id}/restore`, {});
  }

  // ===== Categories =====
  getCategories() {
    return this.get<any[]>('/categories');
  }
  createCategory(data: any) {
    return this.post<any>('/categories', data);
  }
  updateCategory(id: string, data: any) {
    return this.patch<any>(`/categories/${id}`, data);
  }
  deleteCategory(id: string) {
    return this.delete<any>(`/categories/${id}`);
  }
  getDeletedCategories() {
    return this.get<any[]>('/categories/deleted');
  }
  restoreCategory(id: string) {
    return this.patch<any>(`/categories/${id}/restore`, {});
  }

  // ===== Product Sizes =====
  getProductSizes() {
    return this.get<any[]>('/product-sizes/admin');
  }
  getProductSizesActive() {
    return this.get<any[]>('/product-sizes');
  }
  createProductSize(data: any) {
    return this.post<any>('/product-sizes', data);
  }
  updateProductSize(id: string, data: any) {
    return this.patch<any>(`/product-sizes/${id}`, data);
  }
  toggleProductSize(id: string) {
    return this.patch<any>(`/product-sizes/${id}/toggle-active`, {});
  }
  deleteProductSize(id: string) {
    return this.delete<any>(`/product-sizes/${id}`);
  }
  restoreProductSize(id: string) {
    return this.patch<any>(`/product-sizes/${id}/restore`, {});
  }

  // ===== Orders =====
  getOrders(params?: Record<string, string>) {
    return this.get<any>('/orders/admin', { params });
  }
  getOrder(id: string) {
    return this.get<any>(`/orders/${id}`);
  }
  updateOrderStatus(id: string, status: string) {
    return this.patch<any>(`/orders/${id}/status`, { status });
  }
  getOrderStats() {
    return this.get<any>('/orders/stats');
  }
  /** Refund history + balances (`orders:refund`). */
  getOrderRefunds(orderId: string) {
    return this.get<OrderRefundSummary>(`/orders/${orderId}/refunds`);
  }
  /** Record (or, for GATEWAY, execute) a refund on an online order (`orders:refund`). */
  createOrderRefund(orderId: string, data: CreateOrderRefundInput) {
    return this.post<any>(`/orders/${orderId}/refunds`, data);
  }
  getRecentOrders() {
    // No `sort` param: AdminQueryOrdersDto doesn't declare one (forbidNonWhitelisted
    // → 400) and the API already orders by createdAt desc.
    return this.get<any>('/orders/admin', { params: { limit: '5', page: '1' } });
  }

  // ===== Rentals =====
  getRentals(params?: Record<string, string>) {
    return this.get<any>('/rentals/admin', { params });
  }
  getRental(id: string) {
    return this.get<any>(`/rentals/${id}`);
  }
  updateRentalStatus(id: string, status: string) {
    return this.patch<any>(`/rentals/${id}/status`, { status });
  }
  markRentalReady(id: string) {
    return this.patch<any>(`/rentals/${id}/ready`, {});
  }
  getActiveRentals() {
    return this.get<any>('/rentals/admin', { params: { status: 'ACTIVE' } });
  }
  getUpcomingPickups(days?: number) {
    return this.get<any[]>('/rentals/upcoming-pickups', { params: days ? { days: String(days) } : undefined });
  }
  getOverdueRentals() {
    return this.get<any[]>('/rentals/overdue');
  }
  getPendingReturns() {
    return this.get<any[]>('/rentals/pending-returns');
  }
  updateRental(id: string, data: any) {
    return this.patch<any>(`/rentals/${id}`, data);
  }
  uploadTransportReceipt(rentalId: string, file: File) {
    return this.uploadMultipart<any>(`/rentals/${rentalId}/transport-receipt`, file);
  }

  // ===== Rental Checklists =====
  getChecklistTemplates() {
    return this.get<any[]>('/rental-checklists/templates');
  }
  createChecklistTemplate(data: any) {
    return this.post<any>('/rental-checklists/templates', data);
  }
  updateChecklistTemplate(id: string, data: any) {
    return this.put<any>(`/rental-checklists/templates/${id}`, data);
  }
  deleteChecklistTemplate(id: string) {
    return this.delete<any>(`/rental-checklists/templates/${id}`);
  }
  getDeletedChecklistTemplates() {
    return this.get<any[]>('/rental-checklists/templates-deleted');
  }
  restoreChecklistTemplate(id: string) {
    return this.patch<any>(`/rental-checklists/templates/${id}/restore`, {});
  }
  toggleChecklistTemplate(id: string) {
    return this.patch<any>(`/rental-checklists/templates/${id}/toggle-active`, {});
  }
  getActiveChecklistTemplates() {
    return this.get<any[]>('/rental-checklists/templates/active');
  }
  assignChecklist(rentalOrderId: string, templateId: string) {
    return this.post<any>('/rental-checklists/assign', { rentalOrderId, templateId });
  }
  getRentalChecklist(rentalOrderId: string) {
    return this.get<any[]>(`/rental-checklists/rental/${rentalOrderId}`);
  }
  checkItem(entryId: string, notes?: string) {
    return this.patch<any>(`/rental-checklists/entries/${entryId}/check`, { notes });
  }
  uncheckItem(entryId: string) {
    return this.patch<any>(`/rental-checklists/entries/${entryId}/uncheck`, {});
  }

  // ===== Rental Policies =====
  async getRentalPolicies() {
    const raw = await this.get<any>('/rental-policies');
    return {
      bufferDays: raw.bufferDaysBetweenRentals,
      downPaymentPercent: raw.defaultDownPaymentPct,
      lateFeePerDay: raw.lateFeePerDay != null ? Number(raw.lateFeePerDay) : undefined,
      maxRentalDuration: raw.maxRentalDurationDays,
      preparationReminder: raw.advancePreparationReminderDays,
    };
  }
  updateRentalPolicies(data: any) {
    return this.patch<any>('/rental-policies', {
      bufferDaysBetweenRentals: data.bufferDays,
      defaultDownPaymentPct: data.downPaymentPercent,
      lateFeePerDay: data.lateFeePerDay,
      maxRentalDurationDays: data.maxRentalDuration,
      advancePreparationReminderDays: data.preparationReminder,
    });
  }

  // ===== Reviews =====
  getReviews(params?: Record<string, string>) {
    return this.get<any>('/reviews', { params });
  }
  approveReview(id: string) {
    return this.patch<any>(`/reviews/${id}/approve`, {}); // requires `reviews:moderate`
  }
  /** Moderation reject (requires `reviews:moderate`). `DELETE /reviews/:id` is author-only and 403s for admins. */
  rejectReview(id: string) {
    return this.patch<{ message: string }>(`/reviews/${id}/reject`, {});
  }
  /** @deprecated use rejectReview — kept so older call sites keep working. */
  deleteReview(id: string) {
    return this.rejectReview(id);
  }

  // ===== Flash Sales =====
  getFlashSales() {
    return this.get<any[]>('/flash-sales');
  }
  createFlashSale(data: any) {
    return this.post<any>('/flash-sales', data);
  }
  updateFlashSale(id: string, data: any) {
    return this.patch<any>(`/flash-sales/${id}`, data);
  }
  deleteFlashSale(id: string) {
    return this.delete<any>(`/flash-sales/${id}`);
  }
  getDeletedFlashSales() {
    return this.get<any[]>('/flash-sales/deleted');
  }
  restoreFlashSale(id: string) {
    return this.patch<any>(`/flash-sales/${id}/restore`, {});
  }

  // ===== Payment Methods =====
  getPaymentMethods() {
    return this.get<any[]>('/payment-methods/admin');
  }
  createPaymentMethod(data: any) {
    return this.post<any>('/payment-methods', data);
  }
  updatePaymentMethod(id: string, data: any) {
    return this.patch<any>(`/payment-methods/${id}`, data);
  }
  togglePaymentMethod(id: string) {
    return this.patch<any>(`/payment-methods/${id}/toggle-active`, {});
  }
  deletePaymentMethod(id: string) {
    return this.delete<any>(`/payment-methods/${id}`);
  }
  restorePaymentMethod(id: string) {
    return this.patch<any>(`/payment-methods/${id}/restore`, {});
  }
  uploadPaymentIcon(file: File) {
    return this.uploadMultipart<{ url: string }>('/upload/payment-icon', file);
  }

  // ===== Customers =====
  getCustomers(params?: Record<string, string>) {
    return this.get<any>('/users', { params });
  }
  getCustomer(id: string) {
    return this.get<any>(`/users/${id}`);
  }

  /**
   * Fetch a privately-stored ID document (`private://id-documents/<tenantId>/<file>`)
   * with the bearer token. A plain <img src> can't authenticate, so callers
   * turn the Blob into an object URL. 404 → ApiError(404).
   */
  async fetchPrivateIdDocument(ref: string): Promise<Blob> {
    const key = ref.replace(/^private:\/\/id-documents\//, '');
    const res = await this.authorizedFetch(`${this.baseUrl}/upload/id-document/${encodeURIComponent(key)}`);
    if (!res.ok) {
      if (res.status === 403) await this.handleError(res);
      throw new ApiError(res.status, res.status === 404 ? 'Document unavailable' : 'Failed to load document');
    }
    return res.blob();
  }

  // ===== ID Verification =====
  getPendingVerifications() {
    return this.get<any[]>('/id-verification/pending');
  }
  approveVerification(id: string) {
    return this.patch<any>(`/id-verification/${id}/approve`, {});
  }
  rejectVerification(id: string, reason: string) {
    return this.patch<any>(`/id-verification/${id}/reject`, { reason });
  }

  // ===== Shipping =====
  getShippingZones() {
    return this.get<any[]>('/shipping/zones');
  }
  createShippingZone(data: any) {
    return this.post<any>('/shipping/zones', data);
  }
  updateShippingZone(id: string, data: any) {
    return this.put<any>(`/shipping/zones/${id}`, data);
  }
  deleteShippingZone(id: string) {
    return this.delete<any>(`/shipping/zones/${id}`);
  }

  // ===== CMS =====
  getBanners() {
    return this.get<any[]>('/cms/banners/admin');
  }
  createBanner(data: any) {
    return this.post<any>('/cms/banners', data);
  }
  updateBanner(id: string, data: any) {
    return this.patch<any>(`/cms/banners/${id}`, data);
  }
  deleteBanner(id: string) {
    return this.delete<any>(`/cms/banners/${id}`);
  }
  getDeletedBanners() {
    return this.get<any[]>('/cms/banners/deleted');
  }
  restoreBanner(id: string) {
    return this.patch<any>(`/cms/banners/${id}/restore`, {});
  }
  getPages() {
    return this.get<any[]>('/cms/pages');
  }
  getPage(slug: string) {
    return this.get<any>(`/cms/pages/${slug}`);
  }
  createPage(data: any) {
    return this.post<any>('/cms/pages', data);
  }
  updatePage(id: string, data: any) {
    return this.patch<any>(`/cms/pages/${id}`, data);
  }
  deletePage(id: string) {
    return this.delete<any>(`/cms/pages/${id}`);
  }
  getDeletedPages() {
    return this.get<any[]>('/cms/pages/deleted');
  }
  restorePage(id: string) {
    return this.patch<any>(`/cms/pages/${id}/restore`, {});
  }
  getSettings() {
    return this.get<any[]>('/cms/settings');
  }
  updateSetting(key: string, data: { value: string; type?: string }) {
    return this.patch<any>(`/cms/settings/${key}`, data);
  }
  getBusinessProfile() {
    return this.get<any>('/cms/settings/business-profile');
  }
  uploadBranding(file: File): Promise<{ url: string; filename: string }> {
    return this.uploadMultipart('/upload/branding', file);
  }

  // ===== Hero Slides =====
  getHeroSlides() {
    return this.get<any[]>('/cms/hero-slides/admin');
  }
  createHeroSlide(data: any) {
    return this.post<any>('/cms/hero-slides', data);
  }
  updateHeroSlide(id: string, data: any) {
    return this.patch<any>(`/cms/hero-slides/${id}`, data);
  }
  deleteHeroSlide(id: string) {
    return this.delete<any>(`/cms/hero-slides/${id}`);
  }
  restoreHeroSlide(id: string) {
    return this.patch<any>(`/cms/hero-slides/${id}/restore`, {});
  }
  getDeletedHeroSlides() {
    return this.get<any[]>('/cms/hero-slides/deleted');
  }

  // ===== Parallax Sections =====
  getParallaxSections() {
    return this.get<any[]>('/cms/parallax-sections/admin');
  }
  getDeletedParallaxSections() {
    return this.get<any[]>('/cms/parallax-sections/deleted');
  }
  createParallaxSection(data: any) {
    return this.post<any>('/cms/parallax-sections', data);
  }
  updateParallaxSection(id: string, data: any) {
    return this.patch<any>(`/cms/parallax-sections/${id}`, data);
  }
  deleteParallaxSection(id: string) {
    return this.delete<any>(`/cms/parallax-sections/${id}`);
  }
  restoreParallaxSection(id: string) {
    return this.patch<any>(`/cms/parallax-sections/${id}/restore`, {});
  }
  toggleParallaxSection(id: string) {
    return this.patch<any>(`/cms/parallax-sections/${id}/toggle-active`, {});
  }
  uploadDocument(file: File): Promise<{ url: string; filename: string; format: string }> {
    return this.uploadMultipart('/upload/document', file);
  }
  uploadHeroSlide(file: File): Promise<{ url: string; filename: string }> {
    return this.uploadMultipart('/upload/hero-slide', file);
  }
  uploadCategoryImage(file: File): Promise<{ url: string; filename: string }> {
    return this.uploadMultipart('/upload/category', file);
  }
  uploadBanner(file: File): Promise<{ url: string; filename: string }> {
    return this.uploadMultipart('/upload/banner', file);
  }
  uploadInstagramPost(file: File): Promise<{ url: string; filename: string }> {
    return this.uploadMultipart('/upload/instagram-post', file);
  }
  uploadEventImage(file: File): Promise<{ url: string; filename: string }> {
    return this.uploadMultipart('/upload/event', file);
  }

  // ===== Instagram Posts =====
  getInstagramPosts() {
    return this.get<any[]>('/cms/instagram-posts/admin');
  }
  createInstagramPost(data: any) {
    return this.post<any>('/cms/instagram-posts', data);
  }
  updateInstagramPost(id: string, data: any) {
    return this.patch<any>(`/cms/instagram-posts/${id}`, data);
  }
  deleteInstagramPost(id: string) {
    return this.delete<any>(`/cms/instagram-posts/${id}`);
  }
  restoreInstagramPost(id: string) {
    return this.patch<any>(`/cms/instagram-posts/${id}/restore`, {});
  }
  getDeletedInstagramPosts() {
    return this.get<any[]>('/cms/instagram-posts/deleted');
  }
  syncInstagramPosts() {
    return this.post<any>('/cms/instagram-posts/sync', {});
  }
  pinInstagramPost(id: string) {
    return this.patch<any>(`/cms/instagram-posts/${id}/pin`, {});
  }
  getInstagramSyncConfig() {
    return this.get<{ interval: string; options: string[] }>('/cms/instagram-sync-config');
  }
  updateInstagramSyncConfig(interval: string) {
    return this.patch<{ interval: string; message: string }>('/cms/instagram-sync-config', { interval });
  }
  /** Connection status of the tenant's Instagram token (never returns the token). */
  getInstagramTokenStatus(refresh = false) {
    return this.get<InstagramTokenStatus>(
      '/cms/instagram/token-status',
      refresh ? { params: { refresh: 'true' } } : undefined,
    );
  }
  /** Exchange a Graph API Explorer user token for a non-expiring Page token (server-side). */
  connectInstagram(userAccessToken: string) {
    return this.post<InstagramConnectResult>('/cms/instagram/connect', { userAccessToken });
  }

  // ===== Newsletter =====
  getNewsletterDashboard() {
    return this.get<any>('/newsletter/dashboard');
  }
  getNewsletters(params?: Record<string, string>) {
    return this.get<any>('/newsletter', { params });
  }
  getNewsletter(id: string) {
    return this.get<any>(`/newsletter/${id}`);
  }
  createNewsletter(data: any) {
    return this.post<any>('/newsletter', data);
  }
  updateNewsletter(id: string, data: any) {
    return this.patch<any>(`/newsletter/${id}`, data);
  }
  deleteNewsletter(id: string) {
    return this.delete<any>(`/newsletter/${id}`);
  }
  sendNewsletter(id: string) {
    return this.post<any>(`/newsletter/${id}/send`, {});
  }
  getNewsletterDeliveries(id: string) {
    return this.get<any>(`/newsletter/${id}/deliveries`);
  }
  getNewsletterFailed(id: string) {
    return this.get<any[]>(`/newsletter/${id}/failed`);
  }
  resendFailedNewsletter(id: string) {
    return this.post<any>(`/newsletter/${id}/resend-failed`, {});
  }
  getSubscribers(params?: Record<string, string>) {
    return this.get<any>('/newsletter/subscribers', { params });
  }
  getSubscriberStats() {
    return this.get<any>('/newsletter/subscribers/stats');
  }
  getNewArrivalsPreview() {
    return this.get<any[]>('/newsletter/new-arrivals-preview');
  }

  // ===== Referrals =====
  getReferralStats() {
    return this.get<any>('/referrals/stats');
  }

  // ===== Inventory =====
  getInventoryList(params?: Record<string, string>) {
    return this.get<any>('/inventory', { params });
  }
  getLowStockAlerts() {
    return this.get<any[]>('/inventory/low-stock');
  }
  getInventoryValuation() {
    return this.get<any>('/inventory/valuation');
  }
  getInventoryTransactions(productId: string, params?: Record<string, string>) {
    return this.get<any>(`/inventory/${productId}/transactions`, { params });
  }
  updateInventorySettings(productId: string, data: any) {
    return this.patch<any>(`/inventory/${productId}/settings`, data);
  }
  adjustStock(data: any) {
    return this.post<any>('/inventory/adjust', data);
  }

  // ===== Expense Categories =====
  getExpenseCategories(params?: Record<string, string>) {
    return this.get<any[]>('/expense-categories', { params });
  }
  getExpenseCategory(id: string) {
    return this.get<any>(`/expense-categories/${id}`);
  }
  createExpenseCategory(data: any) {
    return this.post<any>('/expense-categories', data);
  }
  updateExpenseCategory(id: string, data: any) {
    return this.patch<any>(`/expense-categories/${id}`, data);
  }
  toggleExpenseCategory(id: string) {
    return this.patch<any>(`/expense-categories/${id}/toggle`, {});
  }
  deleteExpenseCategory(id: string) {
    return this.delete<any>(`/expense-categories/${id}`);
  }
  restoreExpenseCategory(id: string) {
    return this.patch<any>(`/expense-categories/${id}/restore`, {});
  }

  // ===== Expenses =====
  getExpenses(params?: Record<string, string>) {
    return this.get<any>('/expenses', { params });
  }
  getExpenseSummary(period: string) {
    return this.get<any>('/expenses/summary', { params: { period } });
  }
  getExpense(id: string) {
    return this.get<any>(`/expenses/${id}`);
  }
  createExpense(data: any) {
    return this.post<any>('/expenses', data);
  }
  updateExpense(id: string, data: any) {
    return this.patch<any>(`/expenses/${id}`, data);
  }
  deleteExpense(id: string) {
    return this.delete<any>(`/expenses/${id}`);
  }

  // ===== Reports =====
  getRentalReportByProduct(params?: Record<string, string>) {
    return this.get<any>('/reports/rentals/by-product', { params });
  }
  getRentalHistoryForProduct(productId: string, params?: Record<string, string>) {
    return this.get<any>(`/reports/rentals/by-product/${productId}`, { params });
  }
  getIncomeStatement(period: string) {
    return this.get<any>('/reports/financials/income-statement', { params: { period } });
  }
  getFinancialSummary(year: number) {
    return this.get<any[]>('/reports/financials/summary', { params: { year: String(year) } });
  }
  getExpenseBreakdown(period: string) {
    return this.get<any[]>('/reports/financials/expense-breakdown', { params: { period } });
  }
  getFinancialPeriods() {
    return this.get<any[]>('/reports/financials/periods');
  }
  /** Only `periodKey` ('YYYY-MM') is accepted; the API derives the EAT month bounds. */
  createFinancialPeriod(data: { periodKey: string }) {
    return this.post<any>('/reports/financials/periods', { periodKey: data.periodKey });
  }
  closeFinancialPeriod(id: string) {
    return this.patch<any>(`/reports/financials/periods/${id}/close`, {});
  }

  // ===== Admin Users =====
  getAdminUsers(params?: Record<string, string>) {
    return this.get<any[]>('/admin-users', { params });
  }
  getAdminUser(id: string) {
    return this.get<any>(`/admin-users/${id}`);
  }
  createAdminUser(data: any) {
    return this.post<any>('/admin-users', data);
  }
  updateAdminUser(id: string, data: any) {
    return this.patch<any>(`/admin-users/${id}`, data);
  }
  deleteAdminUser(id: string) {
    return this.delete<any>(`/admin-users/${id}`);
  }
  toggleAdminUser(id: string) {
    return this.patch<any>(`/admin-users/${id}/toggle`, {});
  }
  unlockAdminUser(id: string) {
    return this.patch<any>(`/admin-users/${id}/unlock`, {});
  }
  assignAdminUserRole(userId: string, roleId: string) {
    return this.post<any>(`/admin-users/${userId}/roles`, { roleId });
  }
  removeAdminUserRole(userId: string, roleId: string) {
    return this.delete<any>(`/admin-users/${userId}/roles/${roleId}`);
  }
  getAdminUserActivity(id: string) {
    return this.get<any[]>(`/admin-users/${id}/activity`);
  }

  // ===== Roles =====
  getRoles(params?: Record<string, string>) {
    return this.get<any[]>('/roles', { params });
  }
  getRole(id: string) {
    return this.get<any>(`/roles/${id}`);
  }
  createRole(data: any) {
    return this.post<any>('/roles', data);
  }
  updateRole(id: string, data: any) {
    return this.patch<any>(`/roles/${id}`, data);
  }
  deleteRole(id: string) {
    return this.delete<any>(`/roles/${id}`);
  }
  restoreRole(id: string) {
    return this.patch<any>(`/roles/${id}/restore`, {});
  }
  getRolePermissions(id: string) {
    return this.get<any[]>(`/roles/${id}/permissions`);
  }
  addRolePermissions(id: string, permissionIds: string[]) {
    return this.post<any>(`/roles/${id}/permissions`, { permissionIds });
  }
  removeRolePermission(roleId: string, permissionId: string) {
    return this.delete<any>(`/roles/${roleId}/permissions/${permissionId}`);
  }

  // ===== Permissions =====
  getPermissions(params?: Record<string, string>) {
    return this.get<any[]>('/permissions', { params });
  }
  getPermissionModules() {
    return this.get<string[]>('/permissions/modules');
  }

  // ===== Events =====
  getEvents(params?: Record<string, string>) {
    return this.get<any>('/events/admin', { params });
  }
  getEvent(id: string) {
    return this.get<any>(`/events/${id}`);
  }
  getPendingEvents() {
    return this.get<any[]>('/events/pending');
  }
  createEvent(data: any) {
    return this.post<any>('/events', data);
  }
  updateEvent(id: string, data: any) {
    return this.patch<any>(`/events/${id}`, data);
  }
  deleteEvent(id: string) {
    return this.delete<any>(`/events/${id}`);
  }
  approveEvent(id: string) {
    return this.patch<any>(`/events/${id}/approve`, {});
  }
  rejectEvent(id: string, reason: string) {
    return this.patch<any>(`/events/${id}/reject`, { reason });
  }
  restoreEvent(id: string) {
    return this.patch<any>(`/events/${id}/restore`, {});
  }
  getDeletedEvents() {
    return this.get<any[]>('/events/deleted');
  }
  addEventMedia(eventId: string, data: any) {
    return this.post<any>(`/events/${eventId}/media`, data);
  }
  deleteEventMedia(eventId: string, mediaId: string) {
    return this.delete<any>(`/events/${eventId}/media/${mediaId}`);
  }
  reorderEventMedia(eventId: string, mediaIds: string[]) {
    return this.patch<any>(`/events/${eventId}/media/reorder`, { mediaIds });
  }

  // ===== Users (suspend/activate) =====
  suspendUser(id: string) {
    return this.patch<any>(`/users/${id}/suspend`, {});
  }
  activateUser(id: string) {
    return this.patch<any>(`/users/${id}/activate`, {});
  }

  // ===== POS - Sessions =====
  posOpenSession(data: { openingCash: number }) {
    return this.post<any>('/pos/sessions/open', data);
  }
  posCloseSession(data: { closingCash: number; notes?: string }) {
    return this.post<any>('/pos/sessions/close', data);
  }
  posGetCurrentSession() {
    return this.get<any>('/pos/sessions/current');
  }
  posGetSessions(params?: Record<string, string>) {
    return this.get<any>('/pos/sessions', { params });
  }
  posGetSessionSummary(id: string) {
    return this.get<any>(`/pos/sessions/${id}/summary`);
  }

  // ===== POS - Product & Customer Search =====
  posSearchProducts(q: string) {
    return this.get<any[]>('/pos/products/search', { params: { q } });
  }
  posLookupBarcode(code: string) {
    return this.get<any>(`/pos/products/barcode/${code}`);
  }
  posUpdateBarcode(variantId: string, barcode: string) {
    return this.patch<any>(`/pos/products/${variantId}/barcode`, { barcode });
  }
  posSearchCustomers(q: string) {
    return this.get<any[]>('/pos/customers/search', { params: { q } });
  }
  posQuickCreateCustomer(data: { firstName: string; phone: string; lastName?: string; email?: string }) {
    return this.post<any>('/pos/customers/quick', data);
  }

  // ===== POS - Sales =====
  posCreateSale(data: any) {
    return this.post<any>('/pos/sales', data);
  }
  posGetSales(params?: Record<string, string>) {
    return this.get<any>('/pos/sales', { params });
  }
  posGetSale(id: string) {
    return this.get<any>(`/pos/sales/${id}`);
  }
  posGetReceipt(id: string) {
    return this.get<any>(`/pos/sales/${id}/receipt`);
  }
  posRefundSale(id: string, data: any) {
    return this.post<any>(`/pos/sales/${id}/refund`, data);
  }

  // ===== POS - Hold/Park =====
  posHoldSale(data: any) {
    return this.post<any>('/pos/held', data);
  }
  posGetHeldSales() {
    return this.get<any[]>('/pos/held');
  }
  posResumeHeldSale(id: string) {
    return this.post<any>(`/pos/held/${id}/resume`, {});
  }
  posDiscardHeldSale(id: string) {
    return this.delete<any>(`/pos/held/${id}`);
  }

  // ===== POS - Layaway =====
  posCreateLayaway(data: any) {
    return this.post<any>('/pos/layaways', data);
  }
  posGetLayaways(params?: Record<string, string>) {
    return this.get<any>('/pos/layaways', { params });
  }
  posGetLayaway(id: string) {
    return this.get<any>(`/pos/layaways/${id}`);
  }
  posLayawayPayment(id: string, data: any) {
    return this.post<any>(`/pos/layaways/${id}/payment`, data);
  }
  posCompleteLayaway(id: string) {
    return this.post<any>(`/pos/layaways/${id}/complete`, {});
  }
  posCancelLayaway(id: string) {
    return this.post<any>(`/pos/layaways/${id}/cancel`, {});
  }

  // ===== POS - Exchange =====
  posCreateExchange(data: any) {
    return this.post<any>('/pos/exchanges', data);
  }
  posGetExchanges(params?: Record<string, string>) {
    return this.get<any>('/pos/exchanges', { params });
  }
  posGetExchange(id: string) {
    return this.get<any>(`/pos/exchanges/${id}`);
  }

  // ===== POS - Daily Summary =====
  posGetDailySummary(date?: string) {
    return this.get<any>('/pos/daily-summary', { params: date ? { date } : undefined });
  }

  // ===== Contact Submissions =====
  getContactSubmissions(status?: string) {
    return this.get<any[]>('/cms/contact-submissions', { params: status ? { status } : undefined });
  }
  getContactSubmission(id: string) {
    return this.get<any>(`/cms/contact-submissions/${id}`);
  }
  getContactSubmissionStats() {
    return this.get<any>('/cms/contact-submissions/stats');
  }
  updateContactStatus(id: string, status: string) {
    return this.patch<any>(`/cms/contact-submissions/${id}/status`, { status });
  }
  replyToContact(id: string, reply: string) {
    return this.post<any>(`/cms/contact-submissions/${id}/reply`, { reply });
  }
  deleteContactSubmission(id: string) {
    return this.delete<any>(`/cms/contact-submissions/${id}`);
  }

  // ===== Size Guides =====
  getSizeGuides() {
    return this.get<any[]>('/size-guides/admin');
  }
  getSizeGuide(id: string) {
    return this.get<any>(`/size-guides/${id}`);
  }
  createSizeGuide(data: any) {
    return this.post<any>('/size-guides', data);
  }
  updateSizeGuide(id: string, data: any) {
    return this.patch<any>(`/size-guides/${id}`, data);
  }
  deleteSizeGuide(id: string) {
    return this.delete<any>(`/size-guides/${id}`);
  }
  restoreSizeGuide(id: string) {
    return this.patch<any>(`/size-guides/${id}/restore`, {});
  }
  setDefaultSizeGuide(id: string) {
    return this.patch<any>(`/size-guides/${id}/set-default`, {});
  }
  toggleSizeGuideActive(id: string) {
    return this.patch<any>(`/size-guides/${id}/toggle-active`, {});
  }
  getDeletedSizeGuides() {
    return this.get<any[]>('/size-guides/deleted');
  }

  // ===== Audit Log =====
  getAuditLog(params?: Record<string, string>) {
    return this.get<{ data: any[]; meta: { total: number; page: number; limit: number; totalPages: number } }>('/audit', { params });
  }
  getAuditFilters() {
    return this.get<{ entities: string[]; actions: string[]; adminUsers: { id: string; firstName: string; lastName: string }[] }>('/audit/filters');
  }
  // ============================================================
  // AI APPROVALS (admin UI for Phase 3 four-eyes workflow)
  //
  // Wraps the existing /api/v1/ai/approvals/* surface. The raw
  // approvalToken returned by approve() is ONLY exposed in the
  // direct response — it is never persisted to localStorage /
  // sessionStorage / URL / any other client storage. Callers MUST
  // hold it in transient React state and clear it on modal close.
  // ============================================================

  /**
   * List approval requests. Server-side filter via `?status=`.
   * The wrapping envelope is `{ success, tool, data, ... }` — we
   * extract `.data` so the caller gets the rows directly.
   */
  async listApprovals(params?: { status?: string; limit?: number }) {
    const qs: Record<string, string> = {};
    if (params?.status) qs.status = params.status;
    if (params?.limit) qs.limit = String(params.limit);
    const env = await this.get<{ data: any[] }>('/ai/approvals', { params: qs });
    return env?.data ?? [];
  }

  async getApproval(id: string) {
    const env = await this.get<{ data: any }>(`/ai/approvals/${id}`);
    return env?.data ?? null;
  }

  /**
   * Issue the four-eyes approval and receive the raw token EXACTLY ONCE.
   * The server returns `{ ..., data: { ..., approvalToken: '<64 hex>' } }`.
   * The caller MUST NOT persist this anywhere; the UI shows it in a
   * one-shot modal and clears it on close.
   */
  async approveApproval(id: string): Promise<{ approvalToken: string; summary: any }> {
    const env = await this.post<{ data: any }>(`/ai/approvals/${id}/approve`, {});
    const summary = env?.data ?? {};
    return { approvalToken: summary.approvalToken, summary };
  }

  async rejectApproval(id: string, reason: string) {
    const env = await this.post<{ data: any }>(`/ai/approvals/${id}/reject`, { reason });
    return env?.data ?? null;
  }

  async revokeApproval(id: string, reason?: string) {
    const env = await this.post<{ data: any }>(
      `/ai/approvals/${id}/revoke`,
      reason ? { reason } : {},
    );
    return env?.data ?? null;
  }

  async cancelApproval(id: string) {
    const env = await this.post<{ data: any }>(`/ai/approvals/${id}/cancel`, {});
    return env?.data ?? null;
  }

  async executeApproval(id: string, approvalToken: string) {
    const env = await this.post<{ data: any }>(`/ai/approvals/${id}/execute`, {
      approvalToken,
    });
    return env?.data ?? null;
  }

  async exportAuditLog(params?: Record<string, string>): Promise<Blob> {
    const url = new URL(`${this.baseUrl}/audit/export`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.append(k, v); });
    const res = await this.authorizedFetch(url.toString());
    if (!res.ok) {
      if (res.status === 403) await this.handleError(res);
      throw new ApiError(res.status, 'Export failed');
    }
    return res.blob();
  }

  // ============================================================
  // PLATFORM ADMIN (Tenant Management)
  // ============================================================

  getPlatformStats() {
    return this.get<any>('/tenants/platform/stats');
  }
  getTenants(params?: Record<string, string>) {
    return this.get<any[]>('/tenants', { params });
  }
  getTenant(id: string) {
    return this.get<any>(`/tenants/${id}`);
  }
  createTenant(data: any) {
    return this.post<any>('/tenants', data);
  }
  updateTenant(id: string, data: any) {
    return this.patch<any>(`/tenants/${id}`, data);
  }
  updateTenantStatus(id: string, status: string) {
    return this.patch<any>(`/tenants/${id}/status`, { status });
  }
  getTenantModules(id: string) {
    return this.get<any[]>(`/tenants/${id}/modules`);
  }
  toggleTenantModule(id: string, moduleCode: string, isEnabled: boolean) {
    return this.patch<any>(`/tenants/${id}/modules`, { moduleCode, isEnabled });
  }
  getTenantBranding(id: string) {
    return this.get<any>(`/tenants/${id}/branding`);
  }
  updateTenantBranding(id: string, data: any) {
    return this.patch<any>(`/tenants/${id}/branding`, data);
  }
  subscribeTenant(id: string, planId: string, billingCycle?: string) {
    return this.post<any>(`/tenants/${id}/subscribe`, { planId, billingCycle });
  }
  recordTenantPayment(id: string, data: any) {
    return this.post<any>(`/tenants/${id}/payments`, data);
  }
  getTenantPayments(id: string) {
    return this.get<any[]>(`/tenants/${id}/payments`);
  }
  getSubscriptionPlans() {
    return this.get<any[]>('/tenants/plans');
  }
  createSubscriptionPlan(data: any) {
    return this.post<any>('/tenants/plans', data);
  }
  updateSubscriptionPlan(id: string, data: any) {
    return this.patch<any>(`/tenants/plans/${id}`, data);
  }
  getAllTenantPayments(params?: Record<string, string>) {
    return this.get<any[]>('/tenants/payments', { params });
  }
}

export const adminApi = new AdminApiClient(API_BASE_URL);
export default adminApi;

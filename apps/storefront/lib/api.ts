const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  cache?: RequestCache;
  tags?: string[];
};

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ===== Token storage =====
// "Remember me" → localStorage (persists); otherwise sessionStorage (cleared on
// browser close). Access + refresh token always live in the SAME storage.
// Readers check both so either choice works transparently.

function safeStorage(kind: "local" | "session"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export const tokenStore = {
  getAccess(): string | null {
    return safeStorage("local")?.getItem("token") || safeStorage("session")?.getItem("token") || null;
  },
  getRefresh(): string | null {
    return (
      safeStorage("local")?.getItem("refreshToken") ||
      safeStorage("session")?.getItem("refreshToken") ||
      null
    );
  },
  /** Persist tokens. `remember` picks the storage; omitted → keep whichever holds the current token. */
  set(accessToken: string, refreshToken?: string | null, remember?: boolean) {
    const local = safeStorage("local");
    const session = safeStorage("session");
    const useLocal =
      remember !== undefined ? remember : !!local?.getItem("token") || !session?.getItem("token");
    const target = useLocal ? local : session;
    const other = useLocal ? session : local;
    target?.setItem("token", accessToken);
    if (refreshToken) target?.setItem("refreshToken", refreshToken);
    other?.removeItem("token");
    other?.removeItem("refreshToken");
  },
  clear() {
    for (const s of [safeStorage("local"), safeStorage("session")]) {
      s?.removeItem("token");
      s?.removeItem("refreshToken");
    }
  },
};

/** Read the tenantId cookie set by middleware.ts (browser only). */
export function getClientTenantId(): string | null {
  if (typeof document === "undefined") return null;
  const fromCookie = document.cookie.match(/(?:^|;\s*)tenantId=([^;]*)/)?.[1];
  if (fromCookie) return decodeURIComponent(fromCookie);
  try {
    return localStorage.getItem("tenantId");
  } catch {
    return null;
  }
}

/** Headers for raw fetches that bypass `request()` (multipart uploads, beacons). */
export function clientAuthHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const token = tokenStore.getAccess();
  if (token) h["Authorization"] = `Bearer ${token}`;
  const tenantId = getClientTenantId();
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

// Single in-flight refresh shared by every parallel 401.
// Resolves to the new access token, `null` when the refresh was definitively
// rejected (4xx — revoked/expired → caller purges tokens), or "transient" for
// network/5xx/429 failures (tokens are kept; the user isn't logged out by a
// flaky connection).
type RefreshResult = string | null | "transient";
let refreshPromise: Promise<RefreshResult> | null = null;

async function tryRefreshToken(): Promise<RefreshResult> {
  if (refreshPromise) return refreshPromise;
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) return null;

  refreshPromise = (async () => {
    try {
      const tenantId = getClientTenantId();
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tenantId ? { "X-Tenant-Id": tenantId } : {}),
        },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        return res.status >= 400 && res.status < 500 && res.status !== 429 ? null : "transient";
      }
      const data = await res.json().catch(() => null);
      const newAccess: string | undefined = data?.accessToken || data?.access_token;
      if (!newAccess) return null;
      tokenStore.set(newAccess, data?.refreshToken || data?.refresh_token || null);
      return newAccess;
    } catch {
      return "transient";
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, headers = {}, cache, tags } = options;

  const buildConfig = (): RequestInit & { next?: { tags?: string[] } } => {
    // Auto-inject auth token and tenant context when running in the browser
    const authHeaders = typeof window !== "undefined" ? clientAuthHeaders() : {};
    const config: RequestInit & { next?: { tags?: string[] } } = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
        ...headers,
      },
    };
    if (body !== undefined && body !== null) config.body = JSON.stringify(body);
    if (cache) config.cache = cache;
    if (tags) config.next = { tags };
    return config;
  };

  let response = await fetch(`${BASE_URL}${endpoint}`, buildConfig());

  // One transparent refresh + replay on 401. Skip /auth/* (login failures,
  // refresh itself) to avoid loops.
  if (
    response.status === 401 &&
    typeof window !== "undefined" &&
    !endpoint.startsWith("/auth/login") &&
    !endpoint.startsWith("/auth/refresh") &&
    !endpoint.startsWith("/auth/register")
  ) {
    const hadSession = !!(tokenStore.getAccess() || tokenStore.getRefresh());
    if (hadSession) {
      const result = await tryRefreshToken();
      if (typeof result === "string" && result !== "transient") {
        response = await fetch(`${BASE_URL}${endpoint}`, buildConfig());
      } else if (result === null) {
        // Refresh definitively rejected (revoked / expired) — purge stale auth.
        tokenStore.clear();
        window.dispatchEvent(new CustomEvent("auth:expired"));
      } else {
        throw new ApiError(503, "Network error while refreshing session");
      }
    }
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      errorData?.message || `Request failed with status ${response.status}`,
      errorData,
    );
  }

  // 204 / empty bodies (e.g. DELETE) shouldn't throw on JSON parse.
  const text = await response.text();
  return (text ? JSON.parse(text) : (undefined as unknown)) as T;
}

export const api = {
  get: <T>(endpoint: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(endpoint, { ...options, method: "GET" }),

  post: <T>(endpoint: string, body: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(endpoint, { ...options, method: "POST", body }),

  put: <T>(endpoint: string, body: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(endpoint, { ...options, method: "PUT", body }),

  patch: <T>(endpoint: string, body: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(endpoint, { ...options, method: "PATCH", body }),

  delete: <T>(endpoint: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(endpoint, { ...options, method: "DELETE" }),
};

// ===== Domain APIs =====

export const productsApi = {
  getAll: (params?: Record<string, string | number>) =>
    api.get<{ data: any[]; total: number; page: number; limit: number; meta?: { total: number; page: number; limit: number; totalPages: number } }>(`/products${toQuery(params)}`),
  getBySlug: (slug: string) => api.get<any>(`/products/${slug}`),
};

export const categoriesApi = {
  getAll: () => api.get<any[]>('/categories'),
  getBySlug: (slug: string) => api.get<any>(`/categories/${slug}`),
};

// Broadcast so the Header badge (and anything else subscribed) refreshes
// without waiting for a route change. Centralized here so every cart
// mutation fires it — callers don't need to remember.
function notifyCartUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cart:updated'));
  }
}

export const cartApi = {
  get: () => api.get<any>('/cart'),
  addItem: async (data: { productId: string; variantId: string; quantity: number }) => {
    const res = await api.post<any>('/cart/items', data);
    notifyCartUpdated();
    return res;
  },
  updateItem: async (itemId: string, data: { quantity: number }) => {
    const res = await api.patch<any>(`/cart/items/${itemId}`, data);
    notifyCartUpdated();
    return res;
  },
  removeItem: async (itemId: string) => {
    const res = await api.delete<any>(`/cart/items/${itemId}`);
    notifyCartUpdated();
    return res;
  },
  clear: async () => {
    const res = await api.delete<any>('/cart');
    notifyCartUpdated();
    return res;
  },
};

export const wishlistApi = {
  get: () => api.get<any>('/wishlist'),
  toggle: (productId: string) => api.post<any>(`/wishlist/${productId}`, {}),
  remove: (productId: string) => api.delete<any>(`/wishlist/${productId}`),
  check: (productId: string) => api.get<{ inWishlist: boolean }>(`/wishlist/check/${productId}`),
};

/** POST /orders response — totals are computed server-side. */
export interface CreatedOrder {
  id: string;
  orderNumber?: string;
  subtotal: number | string;
  discount?: number | string;
  shippingCost?: number | string;
  shippingFee?: number | string; // alias of shippingCost
  total: number | string;
  promoCodeId?: string | null;
  items?: any[];
  address?: any;
  [key: string]: any;
}

export const ordersApi = {
  // Server computes subtotal / discount / shippingFee / total from the cart,
  // the delivery method and the promo code. Read totals from the response.
  create: (data: {
    paymentMethod: string;
    deliveryMethod: 'standard' | 'express' | 'pickup';
    shippingAddress: { name: string; phone: string; street: string; city: string; region: string };
    promoCode?: string;
    addressId?: string;
    notes?: string;
  }) => api.post<CreatedOrder>('/orders', data),
  getAll: (params?: Record<string, string | number>) =>
    api.get<any>(`/orders${toQuery(params)}`),
  getOne: (id: string) => api.get<any>(`/orders/${id}`),
};

export const rentalsApi = {
  create: (data: any) => api.post<any>('/rentals', data),
  getAll: () => api.get<any[]>('/rentals'),
  getOne: (id: string) => api.get<any>(`/rentals/${id}`),
  checkAvailability: (productId: string, startDate: string, endDate: string) =>
    api.get<{ available: boolean }>(`/rentals/availability/${productId}?startDate=${startDate}&endDate=${endDate}`),
};

export const reviewsApi = {
  getByProduct: (productId: string, params?: Record<string, string | number>) =>
    api.get<any>(`/reviews/product/${productId}${toQuery(params)}`),
  create: (productId: string, data: { rating: number; title?: string; comment?: string }) =>
    api.post<any>(`/reviews/${productId}`, data),
};

export const flashSalesApi = {
  getActive: () => api.get<any[]>('/flash-sales'),
  getOne: (id: string) => api.get<any>(`/flash-sales/${id}`),
};

export const cmsApi = {
  getBanners: () => api.get<any[]>('/cms/banners'),
  getHeroSlides: () => api.get<any[]>('/cms/hero-slides'),
  getPage: (slug: string) => api.get<any>(`/cms/pages/${slug}`),
  getSettings: () => api.get<any[]>('/cms/settings'),
  getInstagramPosts: () => api.get<any[]>('/cms/instagram-posts'),
  getBusinessProfile: () => api.get<any>('/cms/settings/business-profile'),
  getStorefrontStats: () => api.get<{ productCount: number; rentalCount: number; customerCount: number }>('/cms/storefront-stats'),
  getParallaxSections: () => api.get<any[]>('/cms/parallax-sections'),
};

export const sizeGuidesApi = {
  getAll: () => api.get<any[]>('/size-guides'),
  getDefault: () => api.get<any>('/size-guides/default'),
  getBySlug: (slug: string) => api.get<any>(`/size-guides/by-slug/${slug}`),
};

export const newsletterApi = {
  subscribe: (data: { email: string; name?: string }) =>
    api.post<{ message: string }>('/newsletter/subscribe', data),
};

export const authApi = {
  login: (data: { email: string; password: string }) =>
    api.post<any>('/auth/login', data),
  register: (data: { email: string; password: string; firstName: string; lastName: string; phone?: string }) =>
    api.post<any>('/auth/register', data),
  getProfile: () => api.get<any>('/auth/me'),
  updateProfile: (data: { firstName?: string; lastName?: string; phone?: string }) =>
    api.patch<any>('/auth/me', data),
  // Bumps the server-side token version and RETURNS fresh tokens — callers must
  // store them (tokenStore.set) or the next request is rejected as revoked.
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.post<{ accessToken?: string; refreshToken?: string; message?: string }>('/auth/change-password', data),
  forgotPassword: (data: { email: string }) =>
    api.post<any>('/auth/forgot-password', data),
  resetPassword: (data: { token: string; newPassword: string }) =>
    api.post<any>('/auth/reset-password', data),
  // Revokes the customer's token version server-side. The refresh token is
  // sent too so the API can revoke it if it supports per-token revocation.
  logout: (refreshToken?: string | null) =>
    api.post<any>('/auth/logout', refreshToken ? { refreshToken } : {}),
};

export const usersApi = {
  /** GDPR-style data export (JSON). */
  exportMyData: () => api.get<any>('/users/me/export'),
  /** Permanently delete the account. Requires the current password. */
  deleteMyAccount: (currentPassword: string) =>
    request<any>('/users/me', { method: 'DELETE', body: { currentPassword } }),
};

export const idVerificationApi = {
  getStatus: () => api.get<any>('/id-verification/status'),
  /** Only accepts the `private://id-documents/...` refs returned by uploadApi.uploadIdDocument. */
  submit: (data: { frontImageUrl: string; backImageUrl: string; [key: string]: unknown }) =>
    api.post<any>('/id-verification/submit', data),
};

/**
 * Multipart POST with the same auth behaviour as `request()`: Bearer +
 * X-Tenant-Id injected, one transparent refresh + replay on 401. The browser
 * sets the multipart Content-Type boundary itself, so none is passed here.
 */
async function uploadMultipart<T>(endpoint: string, formData: FormData): Promise<T> {
  const send = () =>
    fetch(`${BASE_URL}${endpoint}`, { method: 'POST', headers: clientAuthHeaders(), body: formData });
  let response = await send();
  if (response.status === 401 && (tokenStore.getAccess() || tokenStore.getRefresh())) {
    const result = await tryRefreshToken();
    if (typeof result === 'string' && result !== 'transient') {
      response = await send();
    } else if (result === null) {
      tokenStore.clear();
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('auth:expired'));
    }
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    const msg = Array.isArray(errorData?.message) ? errorData.message.join(', ') : errorData?.message;
    throw new ApiError(response.status, msg || `Upload failed with status ${response.status}`, errorData);
  }
  return response.json();
}

/** Mirrors the API's id-document limits (upload.controller.ts). */
export const ID_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
export const ID_DOCUMENT_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export const uploadApi = {
  /**
   * Customer ID document upload (rental verification). Stored privately —
   * the returned `url` is a `private://id-documents/<tenantId>/<file>` ref the
   * customer can NOT read back; render previews from the local File instead.
   */
  uploadIdDocument: (file: File, side: 'front' | 'back') => {
    const formData = new FormData();
    formData.append('file', file);
    return uploadMultipart<{ url: string; side: 'front' | 'back'; format?: string }>(
      `/upload/id-document?side=${side}`,
      formData,
    );
  },
};

export const paymentsApi = {
  initiate: (data: {
    orderId?: string;
    rentalOrderId?: string;
    amount: number;
    method: 'MOBILE_MONEY' | 'CARD';
    phoneNumber?: string;
    buyerEmail?: string;
    buyerName?: string;
  }) => api.post<{
    paymentId: string;
    transactionRef: string;
    status: string;
    gatewaySuccess: boolean;
    gatewayUrl?: string;
    message?: string;
    method: string;
  }>('/payments/initiate', data),

  checkStatus: (transactionRef: string) =>
    api.get<{
      paymentId: string;
      transactionRef: string;
      status: string;
      amount: number;
      method: string;
      orderId?: string;
      rentalOrderId?: string;
    }>(`/payments/status/${transactionRef}`),
};

export const shippingApi = {
  getZones: () => api.get<any[]>('/shipping/zones'),
  calculateRate: (zoneId: string, orderAmount: number) =>
    api.post<any>('/shipping/calculate', { zoneId, orderAmount }),
};

function toQuery(params?: Record<string, string | number>): string {
  if (!params) return '';
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const eventsApi = {
  getAll: (params?: Record<string, string | number>) =>
    api.get<{ data: any[]; meta: { total: number; page: number; limit: number; totalPages: number } }>(`/events${toQuery(params)}`),
  getBySlug: (slug: string) => api.get<any>(`/events/by-slug/${slug}`),
  getMyEvent: () => api.get<any>('/events/my-event'),
  submit: (data: any) => api.post<any>('/events/customer', data),
  addMedia: (eventId: string, data: { url: string; type?: string; caption?: string }) =>
    api.post<any>(`/events/${eventId}/media`, data),
};

export const promoCodesApi = {
  // Contract: POST /promo-codes/validate { code, subtotal } ALWAYS returns 200 —
  // check `valid`. Invalid → { valid: false, discount: 0, message }.
  validate: (code: string, subtotal: number) =>
    api.post<{
      valid: boolean;
      discount: number;
      discountAmount?: number;
      message?: string;
      promoCodeId?: string;
      code?: string;
      discountType?: string;
      discountValue?: number;
    }>('/promo-codes/validate', { code, subtotal }),
};

export const addressesApi = {
  getAll: () => api.get<any[]>('/users/addresses'),
  create: (data: { street: string; city: string; state: string; zipCode: string; country: string; label?: string; isDefault?: boolean }) =>
    api.post<any>('/users/addresses', data),
  update: (id: string, data: Partial<{ street: string; city: string; state: string; zipCode: string; country: string; label?: string; isDefault?: boolean }>) =>
    api.patch<any>(`/users/addresses/${id}`, data),
  delete: (id: string) => api.delete<any>(`/users/addresses/${id}`),
};

export { ApiError };
export default api;

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

async function request<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, headers = {}, cache, tags } = options;

  // Auto-inject auth token and tenant context when running in the browser
  const authHeaders: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      authHeaders["Authorization"] = `Bearer ${token}`;
    }
    // Read tenantId from cookie (set by storefront middleware)
    const tenantId =
      document.cookie.match(/(?:^|;\s*)tenantId=([^;]*)/)?.[1] ||
      localStorage.getItem("tenantId");
    if (tenantId) {
      authHeaders["X-Tenant-Id"] = tenantId;
    }
  }

  const config: RequestInit & { next?: { tags?: string[] } } = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...headers,
    },
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  if (cache) {
    config.cache = cache;
  }

  if (tags) {
    config.next = { tags };
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, config);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      errorData?.message || `Request failed with status ${response.status}`,
      errorData,
    );
  }

  return response.json();
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

export const cartApi = {
  get: () => api.get<any>('/cart'),
  addItem: (data: { productId: string; variantId: string; quantity: number }) =>
    api.post<any>('/cart/items', data),
  updateItem: (itemId: string, data: { quantity: number }) =>
    api.patch<any>(`/cart/items/${itemId}`, data),
  removeItem: (itemId: string) => api.delete<any>(`/cart/items/${itemId}`),
  clear: () => api.delete<any>('/cart'),
};

export const wishlistApi = {
  get: () => api.get<any>('/wishlist'),
  toggle: (productId: string) => api.post<any>(`/wishlist/${productId}`, {}),
  remove: (productId: string) => api.delete<any>(`/wishlist/${productId}`),
  check: (productId: string) => api.get<{ inWishlist: boolean }>(`/wishlist/check/${productId}`),
};

export const ordersApi = {
  create: (data: { addressId: string; paymentMethod: string; notes?: string }) =>
    api.post<any>('/orders', data),
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
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.post<any>('/auth/change-password', data),
  forgotPassword: (data: { email: string }) =>
    api.post<any>('/auth/forgot-password', data),
  resetPassword: (data: { token: string; newPassword: string }) =>
    api.post<any>('/auth/reset-password', data),
  logout: () => api.post<any>('/auth/logout', {}),
};

export const idVerificationApi = {
  getStatus: () => api.get<any>('/id-verification/status'),
  submit: (data: any) => api.post<any>('/id-verification/submit', data),
};

export const uploadApi = {
  uploadFile: async (file: File, folder: string = 'products'): Promise<{ url: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);

    const authHeaders: Record<string, string> = {};
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) authHeaders['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    });

    if (!response.ok) throw new ApiError(response.status, 'Upload failed');
    return response.json();
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
  validate: (code: string, orderAmount: number) =>
    api.post<{
      valid: boolean;
      promoCodeId: string;
      code: string;
      discountType: string;
      discountValue: number;
      discountAmount: number;
      description?: string;
    }>('/promo-codes/validate', { code, orderAmount }),
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

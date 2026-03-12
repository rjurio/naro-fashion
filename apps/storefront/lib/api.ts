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

  // Auto-inject auth token from localStorage when running in the browser
  const authHeaders: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      authHeaders["Authorization"] = `Bearer ${token}`;
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
    api.get<{ data: any[]; total: number; page: number; limit: number }>(`/products${toQuery(params)}`),
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
  getPage: (slug: string) => api.get<any>(`/cms/pages/${slug}`),
  getSettings: () => api.get<any[]>('/cms/settings'),
};

export const authApi = {
  login: (data: { email: string; password: string }) =>
    api.post<any>('/auth/login', data),
  register: (data: { email: string; password: string; firstName: string; lastName: string; phone?: string }) =>
    api.post<any>('/auth/register', data),
  getProfile: () => api.get<any>('/auth/profile'),
  logout: () => api.post<any>('/auth/logout', {}),
};

export const idVerificationApi = {
  getStatus: () => api.get<any>('/id-verification/status'),
  submit: (data: any) => api.post<any>('/id-verification/submit', data),
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

export { ApiError };
export default api;

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

class AdminApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
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
        url.searchParams.append(key, value);
      });
    }
    return url.toString();
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    const { params, ...fetchOptions } = options || {};
    const response = await fetch(this.buildUrl(endpoint, params), {
      method: 'GET',
      headers: this.getHeaders(),
      ...fetchOptions,
    });
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async post<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    const { params, ...fetchOptions } = options || {};
    const response = await fetch(this.buildUrl(endpoint, params), {
      method: 'POST',
      headers: this.getHeaders(),
      body: data ? JSON.stringify(data) : undefined,
      ...fetchOptions,
    });
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async put<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    const { params, ...fetchOptions } = options || {};
    const response = await fetch(this.buildUrl(endpoint, params), {
      method: 'PUT',
      headers: this.getHeaders(),
      body: data ? JSON.stringify(data) : undefined,
      ...fetchOptions,
    });
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    const { params, ...fetchOptions } = options || {};
    const response = await fetch(this.buildUrl(endpoint, params), {
      method: 'DELETE',
      headers: this.getHeaders(),
      ...fetchOptions,
    });
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async patch<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    const { params, ...fetchOptions } = options || {};
    const response = await fetch(this.buildUrl(endpoint, params), {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: data ? JSON.stringify(data) : undefined,
      ...fetchOptions,
    });
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  // ===== Auth =====
  login(email: string, password: string) {
    return this.post<any>('/auth/login', { email, password });
  }

  // ===== Dashboard / Analytics =====
  getDashboardStats() {
    return this.get<any>('/analytics/dashboard');
  }
  getRevenueChart(period: string) {
    return this.get<any[]>('/analytics/revenue', { params: { period } });
  }

  // ===== Products =====
  getProducts(params?: Record<string, string>) {
    return this.get<any>('/products', { params });
  }
  getProduct(slug: string) {
    return this.get<any>(`/products/${slug}`);
  }
  createProduct(data: any) {
    return this.post<any>('/products', data);
  }
  updateProduct(id: string, data: any) {
    return this.patch<any>(`/products/${id}`, data);
  }
  deleteProduct(id: string) {
    return this.delete<any>(`/products/${id}`);
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
  getRecentOrders() {
    return this.get<any>('/orders/admin', { params: { limit: '5', sort: 'newest' } });
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
    return this.get<any>('/rentals/admin', { params: { status: 'OVERDUE' } });
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
  getRentalPolicies() {
    return this.get<any>('/rental-policies');
  }
  updateRentalPolicies(data: any) {
    return this.patch<any>('/rental-policies', data);
  }

  // ===== Reviews =====
  getReviews(params?: Record<string, string>) {
    return this.get<any>('/reviews', { params });
  }
  approveReview(id: string) {
    return this.patch<any>(`/reviews/${id}/approve`, {});
  }
  deleteReview(id: string) {
    return this.delete<any>(`/reviews/${id}`);
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

  // ===== Customers =====
  getCustomers(params?: Record<string, string>) {
    return this.get<any>('/users', { params });
  }
  getCustomer(id: string) {
    return this.get<any>(`/users/${id}`);
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
    return this.get<any[]>('/cms/banners');
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
  getSettings() {
    return this.get<any[]>('/cms/settings');
  }
  updateSetting(key: string, value: string) {
    return this.post<any>('/cms/settings', { key, value });
  }

  // ===== Referrals =====
  getReferralStats() {
    return this.get<any>('/referrals/stats');
  }

  // ===== Inventory =====
  getLowStockAlerts() {
    return this.get<any>('/products', { params: { lowStock: 'true', limit: '20' } });
  }
}

export const adminApi = new AdminApiClient(API_BASE_URL);
export default adminApi;

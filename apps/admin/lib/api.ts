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
    const token = this.token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
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

  getProfile() {
    return this.get<any>('/auth/me');
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
  async uploadImage(file: File): Promise<{ url: string; filename: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const token = this.token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);
    const res = await fetch(`${this.baseUrl}/upload/image`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Upload failed' }));
      throw new Error(err.message || 'Upload failed');
    }
    return res.json();
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
  getDeletedFlashSales() {
    return this.get<any[]>('/flash-sales/deleted');
  }
  restoreFlashSale(id: string) {
    return this.patch<any>(`/flash-sales/${id}/restore`, {});
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
  updateSetting(key: string, value: string) {
    return this.post<any>('/cms/settings', { key, value });
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
  createFinancialPeriod(data: any) {
    return this.post<any>('/reports/financials/periods', data);
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
}

export const adminApi = new AdminApiClient(API_BASE_URL);
export default adminApi;

/** Default page size for server-paginated admin lists. */
export const ADMIN_PAGE_SIZE = 25;

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Normalise the API's list responses into one shape. Handles:
 *  - `{ data, meta: { total, page, limit, totalPages } }` (orders/products)
 *  - `{ data|items|<key>, total, page, limit }` (flat metadata)
 *  - a bare array (endpoint doesn't paginate yet) — sliced client-side so
 *    the page still shows at most `limit` rows.
 */
export function normalizePaginated<T = any>(
  res: any,
  page: number,
  limit: number,
  listKeys: string[] = ['data', 'items', 'results'],
): PaginatedResult<T> {
  if (Array.isArray(res)) {
    const total = res.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(Math.max(1, page), totalPages);
    return {
      items: res.slice((safePage - 1) * limit, safePage * limit),
      total,
      page: safePage,
      limit,
      totalPages,
    };
  }

  let items: T[] = [];
  for (const k of listKeys) {
    if (Array.isArray(res?.[k])) {
      items = res[k];
      break;
    }
  }
  const meta = res?.meta ?? res?.pagination ?? res ?? {};
  const total = Number(meta.total ?? meta.totalCount ?? items.length) || 0;
  const effLimit = Number(meta.limit ?? meta.pageSize ?? limit) || limit;
  const totalPages = Math.max(1, Number(meta.totalPages ?? Math.ceil(total / effLimit)) || 1);
  return {
    items,
    total,
    page: Number(meta.page ?? page) || page,
    limit: effLimit,
    totalPages,
  };
}

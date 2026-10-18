// In-memory catalog freshness marker: the sell screen does not refetch the catalog every time
// the tab opens while the data is still fresh. Cleared when the catalog changes (admin.ts),
// when stock changes because of a sale (checkout), and on logout.
const CATALOG_TTL_MS = 60 * 1000;
const fetchedAt = new Map<string, number>();

export const markCatalogFresh = (outletId: string) => {
  fetchedAt.set(outletId, Date.now());
};
export const isCatalogFresh = (outletId: string) => Date.now() - (fetchedAt.get(outletId) ?? 0) < CATALOG_TTL_MS;
export const invalidateCatalogFreshness = (outletId?: string) => {
  outletId ? fetchedAt.delete(outletId) : fetchedAt.clear();
};

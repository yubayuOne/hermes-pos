// Products sell with or without stock tracking. Older data (cache, held bills) has no trackStock and counts as tracked.
export const isTracked = (x: { trackStock?: boolean | null }) => x.trackStock !== false;

/** Maximum quantity allowed in the cart. Untracked products have no limit. */
export const maxQty = (x: { stock: number; trackStock?: boolean | null }) => (isTracked(x) ? x.stock : Number.POSITIVE_INFINITY);

export const isSoldOut = (x: { stock: number; trackStock?: boolean | null }) => isTracked(x) && x.stock <= 0;

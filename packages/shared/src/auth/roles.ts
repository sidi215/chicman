/** Application roles (feature 03). A user holds a set of roles. */
export const ROLES = ["CUSTOMER", "SELLER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** Authoritative shop approval state (`Shop.status`). */
export const SHOP_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

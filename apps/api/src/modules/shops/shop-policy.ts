import type { Role, ShopStatus } from "@chicman/shared";

import { forbidden } from "../../lib/http-error.js";

/**
 * Owner operations that depend on the shop status (spec 06, Authorization
 * rules). Viewing (rule 5) is allowed in every status and resubmission
 * (rule 2) is a status transition (`409` outside `REJECTED`), so neither is
 * listed here.
 *
 * - `edit` (rules 3, 4, 8): `PENDING` or `REJECTED`; `APPROVED` also needs
 *   `SELLER` (`requireApprovedSeller`).
 * - `changeRequest` (rule 8): `APPROVED` and `SELLER`.
 * - `logo` (rule 9): as `edit`.
 *
 * A `SUSPENDED` shop is denied every one of them.
 */
export type ShopOwnerOperation = "edit" | "changeRequest" | "logo";

export function isShopOperationAllowed(operation: ShopOwnerOperation, status: ShopStatus, roles: readonly Role[]): boolean {
  const approvedSeller = status === "APPROVED" && roles.includes("SELLER");
  switch (operation) {
    case "edit":
    case "logo":
      return status === "PENDING" || status === "REJECTED" || approvedSeller;
    case "changeRequest":
      return approvedSeller;
  }
}

/** `403` unless the operation is allowed. */
export function assertShopOperationAllowed(operation: ShopOwnerOperation, status: ShopStatus, roles: readonly Role[]): void {
  if (!isShopOperationAllowed(operation, status, roles)) throw forbidden();
}
